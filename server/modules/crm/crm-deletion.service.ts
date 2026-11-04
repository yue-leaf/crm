import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { CapabilityService, DRIZZLE_DATABASE, type PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import type { DeleteKind, DeletionPreview } from '@shared/api.interface';
import { linkIds } from '@shared/crm';
import { crmDeletion as jobs } from '../../database/schema';
import { CrmService } from './crm.service';
import { deletionPlan, deletionView, itemKey, type DeletionPlan, type DeletionSource } from './crm-deletion-plan';

@Injectable()
export class CrmDeletionService {
  constructor(@Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
    private readonly crm: CrmService, @Inject(CapabilityService) private readonly capability: CapabilityService) {}
  async exclusive<T>(work: () => Promise<T>): Promise<T> {
    return this.db.transaction(async tx => {
      const result = await tx.execute(sql`select pg_try_advisory_xact_lock(hashtext(current_schema()), 9417) as locked`);
      if (!result[0]?.locked) throw new ConflictException('其他记录正在保存或删除，请稍后重试');
      return work();
    });
  }
  private async source(): Promise<DeletionSource> {
    const [customer, project, contact, followup] = await Promise.all(['customer','project','contact','followup'].map(kind => this.crm.allBusiness(kind as keyof DeletionSource)));
    return {customer, project, contact, followup};
  }
  private validate(kind: string, id: string): asserts kind is DeleteKind {
    if (!['customer','project','followup'].includes(kind) || !/^rec[A-Za-z0-9]+$/.test(id)) throw new BadRequestException('删除对象无效');
  }
  async preview(kind: string, id: string, actor: string): Promise<DeletionPreview> {
    this.validate(kind,id);
    return this.exclusive(async () => {
      const [existing] = await this.db.select().from(jobs).where(and(eq(jobs.rootKey,`${kind}:${id}`), inArray(jobs.status,['running','paused']))).limit(1);
      if (existing) return this.inspect(existing.id);
      const plan = deletionPlan(await this.source(),kind,id);
      const [job] = await this.db.insert(jobs).values({rootKey:`${kind}:${id}`, payload:plan, createdBy:actor}).returning();
      return deletionView(job.id,plan,'preview');
    });
  }
  async pending(): Promise<DeletionPreview[]> {
    const rows = await this.db.select().from(jobs).where(inArray(jobs.status,['running','paused'])).orderBy(desc(jobs.createdAt));
    return Promise.all(rows.map(row => this.inspect(row.id)));
  }
  private async job(id: string) {
    if (!/^[a-f0-9-]{36}$/i.test(id)) throw new BadRequestException('删除请求无效');
    const [row] = await this.db.select().from(jobs).where(eq(jobs.id,id)).limit(1);
    if (!row) throw new NotFoundException('删除请求不存在，请重新预览');
    return row;
  }
  async inspect(id: string): Promise<DeletionPreview> {
    const row = await this.job(id), plan = row.payload as DeletionPlan;
    if (row.status === 'complete') return deletionView(id,plan,'complete',plan.items.length);
    const data = await this.source();
    const deleted = plan.items.filter(item => !data[item.kind].some(record => record.id === item.id)).length;
    return deletionView(id,plan,row.status as DeletionPreview['status'],deleted);
  }
  async guardMutation(body: unknown, id?: string): Promise<void> {
    const rows = await this.db.select().from(jobs).where(inArray(jobs.status,['running','paused']));
    const values = JSON.stringify({id,body});
    for (const job of rows) {
      const plan = job.payload as DeletionPlan;
      if ([...plan.items.map(item=>item.id), ...plan.repairs.map(item=>item.id), ...plan.repairs.flatMap(item=>item.after)].some(key=>values.includes(key)))
        throw new ConflictException('相关数据正在删除，请由管理员完成“未完成删除”后再操作');
    }
  }
  async step(id: string): Promise<DeletionPreview> {
    return this.exclusive(async () => {
      const row = await this.job(id), plan = row.payload as DeletionPlan;
      if (row.status === 'complete') return deletionView(id,plan,'complete',plan.items.length);
      let data = await this.source();
      if (row.status === 'preview') {
        if (Date.now()-row.createdAt.getTime()>15*60000 || deletionPlan(data,plan.kind,plan.rootId).signature!==plan.signature)
          throw new ConflictException('数据已变化或预览已过期，请关闭弹框后重新确认删除范围');
        const active = await this.db.select().from(jobs).where(inArray(jobs.status,['running','paused'])).limit(1);
        if (active.length) throw new ConflictException('请先完成已有的未完成删除');
        await this.db.update(jobs).set({status:'running',updatedAt:new Date()}).where(eq(jobs.id,id));
      }
      try {
        // A concurrent edit in Base must never silently expand the approved deletion set.
        if (data[plan.kind].some(record=>record.id===plan.rootId)) {
          const current = deletionPlan(data,plan.kind,plan.rootId);
          const approved = new Set(plan.items.map(itemKey));
          const currentKeys = new Set(current.items.map(itemKey));
          if (current.items.some(item=>!approved.has(itemKey(item))) || plan.items.some(item=>data[item.kind].some(record=>record.id===item.id)&&!currentKeys.has(itemKey(item))) || current.repairs.some(repair=>!plan.repairs.some(old=>old.id===repair.id&&JSON.stringify(old.after)===JSON.stringify(repair.after))))
            throw new ConflictException('关联范围发生变化，已暂停；请先在原表核对新增关联后继续');
        }
        for (const repair of plan.repairs) {
          const child = data.followup.find(record=>record.id===repair.id);
          if (!child) continue;
          const links = linkIds(child.record['上次跟进']);
          if (JSON.stringify(links)===JSON.stringify(repair.after)) continue;
          if (JSON.stringify(links)!==JSON.stringify(repair.before)) throw new ConflictException('后续跟进关联已变化，已暂停，请核对后继续');
          await this.capability.load('crm-followup').call('batchUpdateRecords',{records:[{id:repair.id, record:{上次跟进:repair.after}}]});
          const check = await this.crm.get('followup',repair.id);
          if (JSON.stringify(linkIds(check.record['上次跟进']))!==JSON.stringify(repair.after)) throw new ConflictException('前后跟进关联尚未确认，请重试核对');
        }
        const pending = plan.items.filter(item=>data[item.kind].some(record=>record.id===item.id));
        if (pending.length) {
          const kind = pending[0].kind;
          const batch = pending.filter(item=>item.kind===kind).slice(0,20);
          await this.capability.load(`crm-${kind}`).call('deleteRecords',{recordIDs:batch.map(item=>item.id)});
          data = await this.source();
          if (batch.some(item=>data[kind].some(record=>record.id===item.id))) throw new ConflictException('删除结果尚未全部回读，请继续核对');
        }
        const deleted = plan.items.filter(item=>!data[item.kind].some(record=>record.id===item.id)).length;
        const status = deleted===plan.items.length ? 'complete' : 'running';
        await this.db.update(jobs).set({status,updatedAt:new Date()}).where(eq(jobs.id,id));
        return deletionView(id,plan,status,deleted);
      } catch (error: unknown) {
        await this.db.update(jobs).set({status:'paused',updatedAt:new Date()}).where(eq(jobs.id,id));
        const view = await this.inspect(id);
        return {...view,message:error instanceof ConflictException ? error.message : '删除中断，请点击继续删除，系统会先核对已完成的记录'};
      }
    });
  }
}
