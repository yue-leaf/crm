import { followupChains } from '@shared/crm-followup-chain';
import { BadGatewayException, BadRequestException, ConflictException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { CrmPage, CrmRecord, EntityKind, FollowupPage, RelatedRecordsQuery, RelatedSource } from '@shared/api.interface';
import { linkIds, textValue } from '@shared/crm';

type ReadRecords = (kind: EntityKind, input: Record<string, unknown>) => Promise<unknown>;
interface Condition { fieldName: string; operator: 'contains'; value: string[] }
const relation = (fieldName: string, id: string): Condition => ({ fieldName, operator: 'contains', value: [id] });
const modified = (row: CrmRecord): number => Number(row.record['修改时间']) || 0;
const time = (row: CrmRecord): number => Number(row.record['实际发生时间']) || 0;

/** Read only matching Base records. Never return a first-page approximation. */
export class CrmRelations {
  private requests = 0;
  constructor(private readonly read: ReadRecords) {}

  private async collect(kind: EntityKind, conditions: Condition[], conjunction = 'and'): Promise<CrmRecord[]> {
    const records: CrmRecord[] = [];
    const tokens = new Set<string>();
    const ids = new Set<string>();
    let cursor: string | undefined;
    for (;;) {
      if (++this.requests > 100) throw new BadGatewayException('关联记录超出当前读取范围，未返回不完整结果，请联系管理员');
      const result = await this.read(kind, { pageSize: 50, ...(cursor ? { pageToken: cursor } : {}),
        filter: { conjunction, conditions } });
      if (!result || typeof result !== 'object' || !('records' in result) || !Array.isArray(result.records)
        || !('hasMore' in result) || typeof result.hasMore !== 'boolean')
        throw new BadGatewayException('关联记录响应异常，请刷新重试');
      const page = result as CrmPage;
      for (const row of page.records) {
        if (!row || typeof row.id !== 'string' || !row.record || typeof row.record !== 'object' || ids.has(row.id))
          throw new BadGatewayException('关联记录分页重复或异常，请刷新重试');
        ids.add(row.id); records.push(row);
      }
      if (!page.hasMore) return records;
      if (!page.pageToken || typeof page.pageToken !== 'string' || tokens.has(page.pageToken) || page.pageToken === cursor)
        throw new BadGatewayException('关联记录分页不完整，请刷新重试');
      tokens.add(page.pageToken); cursor = page.pageToken;
    }
  }

  private validate(query: RelatedRecordsQuery): void {
    if (query.status !== undefined && !['all', 'pending'].includes(query.status)) throw new BadRequestException('后续状态筛选无效');
    if (query.cursor !== undefined && (typeof query.cursor !== 'string' || query.cursor.length > 100))
      throw new BadRequestException('分页标记无效');
    if (query.search !== undefined && (typeof query.search !== 'string' || query.search.length > 200))
      throw new BadRequestException('搜索内容过长');
    if (query.scope !== undefined && !['all', 'direct', 'project'].includes(query.scope))
      throw new BadRequestException('跟进范围无效');
  }

  private page(rows: CrmRecord[], query: RelatedRecordsQuery, context: string): CrmPage {
    const signature = createHash('sha256').update(JSON.stringify([context, query.search || '', query.scope || 'all', query.status || 'all',
      rows.map((row: CrmRecord) => [row.id, modified(row)])])).digest('hex').slice(0, 16);
    let offset = 0;
    if (query.cursor) {
      const match = /^related:(\d{1,6}):([a-f0-9]{16})$/.exec(query.cursor);
      if (!match) throw new BadRequestException('分页标记无效');
      if (match[2] !== signature) throw new ConflictException('关联记录已变化，请刷新后继续查看');
      offset = Number(match[1]);
      if (offset >= rows.length) throw new ConflictException('分页范围已变化，请刷新');
    }
    const more = offset + 30 < rows.length;
    return { records: rows.slice(offset, offset + 30), total: rows.length, hasMore: more,
      ...(more ? { pageToken: `related:${offset + 30}:${signature}` } : {}) };
  }

  private async projects(customerId: string): Promise<CrmRecord[]> {
    const rows = await this.collect('project', [relation('所属企业', customerId)]);
    if (rows.some((row: CrmRecord) => !linkIds(row.record['所属企业']).includes(customerId)))
      throw new BadGatewayException('项目归属筛选异常，请刷新重试');
    return rows;
  }

  async customerProjects(customerId: string, query: RelatedRecordsQuery): Promise<CrmPage> {
    this.validate(query);
    const search = (query.search || '').trim().toLocaleLowerCase();
    const rows = (await this.projects(customerId)).filter((row: CrmRecord) =>
      !search || textValue(row.record['项目名称']).toLocaleLowerCase().includes(search));
    rows.sort((a: CrmRecord, b: CrmRecord) => modified(b) - modified(a) || a.id.localeCompare(b.id));
    return this.page(rows, query, `customer:${customerId}:projects`);
  }

  async followups(kind: 'customer' | 'project', parent: CrmRecord, query: RelatedRecordsQuery): Promise<FollowupPage> {
    this.validate(query);
    if (kind === 'project' && query.scope && query.scope !== 'all') throw new BadRequestException('项目跟进不支持客户范围筛选');
    const projects: CrmRecord[] = kind === 'customer' && query.scope !== 'direct' ? await this.projects(parent.id)
      : kind === 'project' ? [parent] : [];
    const projectMap = new Map<string, CrmRecord>(projects.map((row: CrmRecord) => [row.id, row]));
    const conditions: Condition[] = [
      ...(kind === 'customer' && query.scope !== 'project' ? [relation('直接客户', parent.id)] : []),
      ...projects.map((row: CrmRecord) => relation('关联项目', row.id)),
    ];
    const found = new Map<string, CrmRecord>();
    for (let start = 0; start < conditions.length; start += 30) {
      const rows = await this.collect('followup', conditions.slice(start, start + 30), 'or');
      for (const row of rows) {
        const direct = kind === 'customer' && linkIds(row.record['直接客户']).includes(parent.id);
        const project = linkIds(row.record['关联项目']).some((id: string) => projectMap.has(id));
        if ((!direct && !project) || (query.scope === 'direct' && !direct) || (query.scope === 'project' && !project))
          throw new BadGatewayException('跟进归属筛选异常，请刷新重试');
        const previous = found.get(row.id);
        if (previous && JSON.stringify(previous.record) !== JSON.stringify(row.record))
          throw new ConflictException('关联跟进在读取期间发生变化，请刷新重试');
        found.set(row.id, row);
      }
    }
    const search = (query.search || '').trim().toLocaleLowerCase();
    const rows = followupChains([...found.values()]).filter((row: CrmRecord) =>
      (query.status !== 'pending' || row.followup?.state === '待跟进') &&
      (!search || textValue(row.record['内容 / 推进结论']).toLocaleLowerCase().includes(search)));
    rows.sort((a: CrmRecord, b: CrmRecord) => time(b) - time(a) || modified(b) - modified(a) || a.id.localeCompare(b.id));
    const page = this.page(rows, query, `${kind}:${parent.id}:followups`);
    const sources: Record<string, RelatedSource> = {};
    for (const row of page.records) {
      const projectId = linkIds(row.record['关联项目']).find((id: string) => projectMap.has(id));
      const direct = kind === 'customer' && linkIds(row.record['直接客户']).includes(parent.id);
      sources[row.id] = projectId && (!direct || textValue(row.record['跟进归属']) === '项目跟进')
        ? { kind: 'project', id: projectId, name: textValue(projectMap.get(projectId)?.record['项目名称']) || '关联项目' }
        : { kind: 'customer', id: parent.id, name: textValue(parent.record['企业全称']) || '客户直接跟进' };
    }
    return { ...page, sources };
  }
}
