import { BadGatewayException, ConflictException, Inject, Injectable } from '@nestjs/common';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { and, eq, lt, or } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { crmFollowupWrite as writes } from '../../database/schema';
import { textValue } from '@shared/crm';

type Claim = typeof writes.$inferSelect;
export type FollowupClaim = Pick<Claim, 'recordKey' | 'ownerToken' | 'operation' | 'phase' | 'leaseUntil' | 'continuedId'>;
export interface FollowupWriteStore {
  claim(key: string, operation: string, token: string): Promise<FollowupClaim | undefined>;
  find(key: string): Promise<FollowupClaim | undefined>;
  change(row: FollowupClaim, patch: Partial<FollowupClaim>): Promise<FollowupClaim | undefined>;
}
export interface FollowupWritePermit {
  beforeWrite(fields: Record<string, unknown>): Promise<void>;
  created(id: string): void;
}
export const writeMarker = (token: string): string => `跟进保存标识 · ${token}`;

@Injectable()
export class CrmFollowupWriteStore implements FollowupWriteStore {
  constructor(@Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase) {}
  async claim(key: string, operation: string, token: string): Promise<FollowupClaim | undefined> {
    const now = new Date();
    const values = { recordKey: key, operation, ownerToken: token, phase: 'checking', leaseUntil: new Date(now.getTime() + 600000) };
    const [row] = await this.db.insert(writes).values(values).onConflictDoUpdate({ target: writes.recordKey, set: values,
      setWhere: or(eq(writes.phase, 'idle'), and(eq(writes.phase, 'checking'), lt(writes.leaseUntil, now))),
    }).returning();
    return row;
  }
  async find(key: string): Promise<FollowupClaim | undefined> {
    const [row] = await this.db.select().from(writes).where(eq(writes.recordKey, key)).limit(1);
    return row;
  }
  async change(row: FollowupClaim, patch: Partial<FollowupClaim>): Promise<FollowupClaim | undefined> {
    const [changed] = await this.db.update(writes).set({ ...patch, updatedAt: new Date() })
      .where(and(eq(writes.recordKey, row.recordKey), eq(writes.ownerToken, row.ownerToken), eq(writes.phase, row.phase))).returning();
    return changed;
  }
}

@Injectable()
export class CrmFollowupWrites {
  constructor(@Inject(CrmFollowupWriteStore) private readonly store: FollowupWriteStore) {}
  async run<T>(key: string, operation: string, evidence: {
    findSaved(token: string, operation: string): Promise<string | undefined>;
    isVoided(id: string): Promise<boolean>;
  }, work: (permit: FollowupWritePermit) => Promise<T>): Promise<T> {
    let claim = await this.store.claim(key, operation, randomUUID());
    if (!claim) {
      const existing = await this.store.find(key);
      // A missing response never permits another insert. Only positive Base evidence can release it.
      if (existing && (existing.phase === 'uncertain' || (existing.phase === 'writing' && existing.leaseUntil.getTime() < Date.now()))) {
        const id = await evidence.findSaved(existing.ownerToken, existing.operation);
        if (id) {
          await this.store.change(existing, { phase: 'idle',
            continuedId: existing.operation === 'continue' ? id : existing.continuedId });
          throw new ConflictException(`上次保存已找到记录 ${id}，请刷新核对后再操作，勿重复新增`);
        }
        throw new ConflictException('上次保存结果待核验，暂不可重复提交，请联系管理员核对');
      }
      throw new ConflictException('此跟进正在保存，请稍后刷新再操作');
    }
    let attempted = false;
    let createdId: string | undefined;
    const change = async (patch: Partial<FollowupClaim>) => {
      const next = await this.store.change(claim!, patch);
      if (!next) throw new ConflictException('本次保存已失效，请刷新后重新操作');
      claim = next;
    };
    try {
      if (operation === 'continue' && claim.continuedId) {
        if (!await evidence.isVoided(claim.continuedId)) throw new ConflictException('上次跟进已处理，请刷新查看后续记录');
        await change({ continuedId: null });
      }
      const result = await work({
        beforeWrite: async fields => {
          const note = [textValue(fields['管理记录']), writeMarker(claim!.ownerToken)].filter(Boolean).join('\n\n');
          if (note.length > 20000) throw new ConflictException('管理记录已达上限，请先整理留存');
          fields['管理记录'] = note;
          await change({ phase: 'writing' });
          attempted = true;
        },
        created: id => { createdId = id; },
      });
      await change({ phase: 'idle', continuedId: createdId || claim!.continuedId });
      return result;
    } catch (error) {
      // Keep an unresolved write fenced even after process restart. Do not unlock on a timeout.
      if (claim!.phase !== 'idle') {
        try { await change({ phase: attempted && !createdId ? 'uncertain' : 'idle', continuedId: createdId || claim!.continuedId }); }
        catch { throw new BadGatewayException('保存状态暂未确认，请刷新核对，勿重复提交'); }
      }
      throw error;
    }
  }
}
