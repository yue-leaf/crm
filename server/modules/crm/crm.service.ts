import { explicitlyEnded, followupChains, projectFollowupSummary, sameFollowupTarget, validChainTime } from '@shared/crm-followup-chain';
import { CrmFollowupWrites, writeMarker } from './crm-followup-writes';
import type { FollowupWritePermit } from './crm-followup-writes';
import { statusInput, validateSignedDate } from './crm-status';
import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  NotFoundException,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import { AuthNPaasService, CapabilityService, FileService } from '@lark-apaas/fullstack-nestjs-core';
import { isDeepStrictEqual } from 'node:util';
import type {
  CrmPage,
  CrmMemberOption,
  EntityKind,
  CrmRecord,
  WriteResult,
  CrmSummary,
  ProjectScope,
  ProjectOverview,
  RelatedRecordsQuery,
  FollowupPage,
} from '@shared/api.interface';
import {
  forms,
  planFields,
  endFields,
  titles,
  textValue,
  linkIds,
} from '@shared/crm';
import type { Draft, FieldSpec } from '@shared/crm';
import { parseDraft, reject } from './crm-validation';
import { prepareEdit } from './crm-edit';
import { prepareProjectEditStatus } from './crm-project-edit';
import { changedFields, recordDraft } from '@shared/crm-edit';
import {
  followupTarget, advancementBlocked, commerceKeys, progressFields,
} from '@shared/crm-workflow';
import { contactChoiceProblem } from '@shared/crm-ux';
import { auditNote, isLifecycle } from '@shared/crm-lifecycle';
import { prepareLifecycle } from './crm-lifecycle';
import type { RelatedSnapshot } from './crm-lifecycle';
import { historicalContext } from './crm-workflow';
import { buildProjectOverview, projectMatches, scopedProjects, sortProjects, validProjectFilter } from '@shared/crm-dashboard';
import { followupStatus, sortFollowups, validFollowupFilter } from '@shared/crm-followup-status';
import { CrmRelations } from './crm-relations';
import { attachmentWriteMatches } from './crm-attachments';
import { NativeAttachmentGateway } from './crm-native-attachments';
import type { NativeAttachmentPlan } from './crm-native-attachments';
import type { ExpectedAttachment } from './crm-attachments';
import { attachmentSignature } from '@shared/crm-attachments';
import { workspaceModel, workspaceRecords } from '@shared/crm-workspace';
import type { WorkspaceKind } from '@shared/crm-workspace';

@Injectable()
export class CrmService {
  private readonly logger = new Logger(CrmService.name);
  private readonly updating = new Set<string>();
  private readonly nativeAttachments = new NativeAttachmentGateway();
  constructor(
    @Inject(CapabilityService) private readonly capability: CapabilityService,
    @Inject(AuthNPaasService) private readonly identities: AuthNPaasService,
    @Inject(FileService) private readonly files: FileService,
    @Inject(CrmFollowupWrites) private readonly followupWrites: CrmFollowupWrites,
  ) {}

  private kind(value: string): EntityKind {
    if (
      !['customer', 'contact', 'project', 'followup', 'access'].includes(value)
    )
      throw new BadRequestException('数据类型无效');
    return value as EntityKind;
  }

  private async call(
    kind: EntityKind,
    action: string,
    input: Record<string, unknown>,
  ): Promise<unknown> {
    try {
      return await this.capability.load(`crm-${kind}`).call(action, input);
    } catch {
      // Plugin errors can contain request data or credentials. Log operation only.
      this.logger.warn(`Base ${kind} ${action} failed`);
      throw new BadGatewayException(
        action.startsWith('batch')
          ? '保存结果尚未确认，请先刷新列表核对，避免重复提交'
          : '读取飞书数据失败，请检查连接授权后重试',
      );
    }
  }
  private enums(kind: EntityKind): Record<string, string[]> {
    const fields = this.capability.getCapability(`crm-${kind}`)?.formValue
      .fields;
    if (!Array.isArray(fields)) throw new BadGatewayException('表结构配置缺失');
    const enums = Object.fromEntries(
      fields
        .filter((f) => typeof f === 'object' && f && 'enumValues' in f)
        .map((f) => [f.name, f.enumValues]),
    );
    if (kind === 'project') enums['项目类型'] = forms.project.find((f) => f.key === '项目类型')!.options!;
    return enums;
  }
  async memberOptions(): Promise<CrmMemberOption[]> {
    const members = new Map<string, CrmMemberOption>();
    const cursors = new Set<string>();
    let cursor: string | undefined;
    do {
      const page = await this.list('access', cursor);
      for (const row of page.records) {
        const ids: unknown = row.record['飞书成员'];
        const name = textValue(row.record['姓名']) || textValue(row.record['通讯录姓名']);
        // Base's person field is converted to Miaoda IDs by the capability.
        // Never substitute the stored Feishu Open ID or match identities by name.
        if (!Array.isArray(ids) || ids.length !== 1 || !name.trim()) continue;
        const id = ids[0];
        if ((typeof id !== 'string' && typeof id !== 'number') ||
          (typeof id === 'number' && !Number.isSafeInteger(id)) || !/^[1-9]\d*$/.test(String(id))) continue;
        members.set(String(id), { id: String(id), name });
      }
      if (!page.hasMore) break;
      if (!page.pageToken || cursors.has(page.pageToken) || cursors.size >= 100)
        throw new BadGatewayException('成员名单未完整加载，请重试');
      cursor = page.pageToken; cursors.add(cursor);
    } while (cursor);
    return [...members.values()].sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
  }

  async customerContacts(id: string, cursor?: string, search?: string): Promise<CrmPage> {
    await this.get('customer', id);
    return this.list('contact', cursor, search, id);
  }
  async customerProjects(id: string, query: RelatedRecordsQuery): Promise<CrmPage> {
    await this.get('customer', id);
    const page = await new CrmRelations((kind: EntityKind, input: Record<string, unknown>) =>
      this.call(kind, 'searchRecords', input)).customerProjects(id, query);
    return { ...page, records: projectFollowupSummary(page.records, await this.allBusiness('followup')) };
  }
  async relatedFollowups(kind: 'customer' | 'project', id: string, query: RelatedRecordsQuery): Promise<FollowupPage> {
    const row: CrmRecord = await this.get(kind, id);
    return new CrmRelations((key: EntityKind, input: Record<string, unknown>) =>
      this.call(key, 'searchRecords', input)).followups(kind, row, query);
  }
  async list(kind: string, cursor?: string, search?: string, customerId?: string): Promise<CrmPage> {
    const key = this.kind(kind);
    if (cursor !== undefined && (typeof cursor !== 'string' || cursor.length > 2048))
      throw new BadRequestException('分页标记无效');
    if (search !== undefined && (typeof search !== 'string' || search.length > 200))
      throw new BadRequestException('搜索内容过长');
    const result = await this.call(key, 'searchRecords', {
      pageSize: 50,
      ...(cursor ? { pageToken: cursor } : {}),
      ...(search || customerId
        ? {
            filter: {
              conjunction: 'and',
              conditions: [
                ...(customerId ? [{ fieldName: '所属企业', operator: 'contains', value: [customerId] }] : []),
                ...(search ? [{
                  fieldName: titles[key],
                  operator: 'contains',
                  value: [search],
                }] : []),
              ],
            },
          }
        : {}),
    });
    if (
      !result ||
      typeof result !== 'object' ||
      !('records' in result) ||
      !Array.isArray(result.records) ||
      !('hasMore' in result) ||
      typeof result.hasMore !== 'boolean'
    )
      throw new Error('插件响应格式不符合合同');
    const page = result as CrmPage;
    if (page.hasMore && (!page.pageToken || page.pageToken === cursor))
      throw new BadGatewayException('分页信息不完整，请刷新重试');
    if (customerId && page.records.some(row => !linkIds(row.record['所属企业']).includes(customerId)))
      throw new BadGatewayException('联系人归属筛选异常，请刷新重试');
    return page;
  }
  async followupList(customerId?: string, projectId?: string, cursor?: string, search?: string): Promise<CrmPage> {
    for (const id of [customerId, projectId]) {
      if (id !== undefined && (typeof id !== 'string' || (id !== '' && !/^rec[A-Za-z0-9]+$/.test(id))))
        throw new BadRequestException('客户或项目筛选标识无效');
    }
    if (projectId) {
      const project = await this.get('project', projectId);
      if (customerId && !linkIds(project.record['所属企业']).includes(customerId))
        throw new BadRequestException('所选项目不属于所选客户，请重新选择项目');
      return new CrmRelations((kind, input) => this.call(kind, 'searchRecords', input))
        .followups('project', project, { cursor, search });
    }
    if (customerId) return this.relatedFollowups('customer', customerId, { cursor, search });
    return this.decorateFollowups(await this.list('followup', cursor, search));
  }

  async get(kind: string, id: string): Promise<CrmRecord> {
    const key = this.kind(kind);
    if (typeof id !== 'string' || id.length > 100 || !/^rec[A-Za-z0-9]+$/.test(id))
      throw new BadRequestException('记录标识无效');
    const result = await this.call(key, 'getRecord', { recordID: id });
    if (
      !result ||
      typeof result !== 'object' ||
      !('record' in result) ||
      !result.record
    )
      throw new NotFoundException('记录不存在');
    return result as CrmRecord;
  }
  async detail(kind: string, id: string): Promise<CrmRecord> {
    const row = await this.get(kind, id);
    if (kind === 'followup') return (await this.chainRows()).find(item => item.id === id) || row;
    if (kind === 'project') return projectFollowupSummary([row], await this.allBusiness('followup'))[0];
    return row;
  }
  private async chainRows(): Promise<CrmRecord[]> {
    return followupChains(await this.allBusiness('followup'));
  }
  async decorateFollowups<T extends CrmPage>(page: T): Promise<T> {
    if (!page.records.length) return page;
    const chains = new Map((await this.chainRows()).map(row => [row.id, row.followup]));
    return { ...page, records: page.records.map(row => ({ ...row, followup: chains.get(row.id) })) };
  }
  async pendingFollowups(customerId?: string, projectId?: string): Promise<CrmPage> {
    for (const id of [customerId, projectId]) if (id !== undefined && (typeof id !== 'string' || (id && !/^rec[A-Za-z0-9]+$/.test(id))))
      throw new BadRequestException('客户或项目标识无效');
    if (!customerId && !projectId) return { records: [], hasMore: false };
    if (projectId) {
      const project = await this.get('project', projectId);
      if (customerId && !linkIds(project.record['所属企业']).includes(customerId)) reject('项目', '不属于当前客户');
    } else await this.get('customer', customerId!);
    const rows = (await this.chainRows()).filter(row => {
      const target = followupTarget(row);
      return row.followup?.state === '待跟进' && target?.kind === (projectId ? 'project' : 'customer') && target.id === (projectId || customerId);
    });
    rows.sort((a, b) => Number(a.record['建议日期'] || Infinity) - Number(b.record['建议日期'] || Infinity) || a.id.localeCompare(b.id));
    return { records: rows, total: rows.length, hasMore: false };
  }
  private async continuationParent(fields: Record<string, unknown>): Promise<CrmRecord | undefined> {
    const parentIds = fields['上次跟进'];
    if (!Array.isArray(parentIds) || !parentIds.length) return undefined;
    const parent = (await this.chainRows()).find(row => row.id === parentIds[0]);
    if (!parent || parent.followup?.state !== '待跟进') throw new ConflictException('上次跟进已处理或不可继续，请刷新后重新选择');
    const row: CrmRecord = { id: '', record: { ...fields,
      直接客户: { link_record_ids: fields['直接客户'] || [] }, 关联项目: { link_record_ids: fields['关联项目'] || [] } } };
    if (!sameFollowupTarget(parent, row)) reject('上次跟进', '必须属于同一客户和同一项目');
    if (Number(fields['实际发生时间']) < Number(parent.record['实际发生时间'])) reject('跟进时间', '不能早于上次跟进时间');
    return parent;
  }
  async summary(): Promise<CrmSummary> {
    const out: CrmSummary = {
      customer: 0,
      contact: 0,
      project: 0,
      followup: 0,
    };
    for (const key of Object.keys(out) as (keyof CrmSummary)[]) {
      const result = await this.call(key, 'aggregateQuery', {
        measures: [
          { fieldName: titles[key], aggregation: 'count', alias: 'total' },
        ],
        pageSize: 1,
      });
      if (
        !result ||
        typeof result !== 'object' ||
        !('result' in result) ||
        !Array.isArray(result.result)
      )
        throw new BadGatewayException('统计响应无效');
      const row = result.result[0] as
        | Record<string, { value: unknown }>
        | undefined;
      const value = row?.total?.value ?? 0;
      if (typeof value !== 'number')
        throw new BadGatewayException('统计结果无效');
      out[key] = value;
    }
    return out;
  }
  private projectScope(scope: string): ProjectScope {
    if (scope !== 'all' && scope !== 'mine') throw new BadRequestException('项目范围无效');
    return scope;
  }
  async allBusiness(key: 'customer' | 'project' | 'followup' | 'contact'): Promise<CrmRecord[]> {
    const rows: CrmRecord[] = [];
    const tokens = new Set<string>();
    const ids = new Set<string>();
    let cursor: string | undefined;
    for (let page = 0; page < 100; page++) {
      const next = await this.list(key, cursor);
      for (const row of next.records) {
        if (!row || typeof row.id !== 'string' || !row.record || ids.has(row.id))
          throw new BadGatewayException('业务分页数据变化或异常，请刷新后重试');
        ids.add(row.id); rows.push(row);
      }
      if (!next.hasMore) return rows;
      if (!next.pageToken || tokens.has(next.pageToken)) throw new BadGatewayException('业务分页不完整，请刷新后重试');
      tokens.add(next.pageToken); cursor = next.pageToken;
    }
    throw new BadGatewayException('数据数量超出当前统计读取范围，未显示不完整统计，请联系管理员');
  }
  private async workspaceModel(scope: string, userId: string) {
    const checked = this.projectScope(scope);
    const [customer, project, followup] = await Promise.all([
      this.allBusiness('customer'), this.allBusiness('project'), this.allBusiness('followup'),
    ]);
    return workspaceModel({ customer, project, followup }, checked, userId);
  }
  async workspace(scope: string, userId: string) {
    return (await this.workspaceModel(scope, userId)).data;
  }
  async notificationTasks(now: number) {
    const [customer, project, followup] = await Promise.all([
      this.allBusiness('customer'), this.allBusiness('project'), this.allBusiness('followup'),
    ]);
    return workspaceModel({ customer, project, followup }, 'all', '', now).data.tasks;
  }
  async workspaceList(scope: string, userId: string, kind: string, filter: string, cursor?: string, search?: string): Promise<CrmPage> {
    if (!['customer', 'project', 'followup'].includes(kind)) throw new BadRequestException('工作台数据类型无效');
    const filters = ['all', 'month', ...(kind === 'customer' ? ['attention'] : kind === 'project'
      ? ['active', 'completed-month', 'unknown', '待启动', '进行中', '暂停', '已签合同', '已取消'] : [])];
    if (!filters.includes(filter)) throw new BadRequestException('工作台筛选无效');
    if (cursor && !/^offset:\d{1,6}$/.test(cursor)) throw new BadRequestException('分页标记无效');
    if (search !== undefined && (typeof search !== 'string' || search.length > 200)) throw new BadRequestException('搜索内容过长');
    const model = await this.workspaceModel(scope, userId);
    const rows = workspaceRecords(model, kind as WorkspaceKind, filter)
      .filter(row => !search || textValue(row.record[titles[kind as WorkspaceKind]]).toLocaleLowerCase().includes(search.toLocaleLowerCase()))
      .sort((a, b) => Number(b.record['创建时间'] || 0) - Number(a.record['创建时间'] || 0) || a.id.localeCompare(b.id));
    const offset = cursor ? Number(cursor.slice(7)) : 0;
    if (offset > rows.length) throw new ConflictException('列表已变化，请重新查询');
    const more = offset + 20 < rows.length;
    return { records: rows.slice(offset, offset + 20), total: rows.length, hasMore: more, ...(more ? { pageToken: `offset:${offset + 20}` } : {}) };
  }
  async overview(scope: string, userId: string): Promise<ProjectOverview> {
    const checked = this.projectScope(scope);
    return buildProjectOverview(projectFollowupSummary(await this.allBusiness('project'), await this.allBusiness('followup')), checked, userId);
  }
  async projectList(scope: string, filter: string, cursor: string | undefined, search: string | undefined, userId: string, followupFilter = 'all', customerId = ''): Promise<CrmPage> {
    const checked = this.projectScope(scope);
    if (typeof customerId !== 'string' || (customerId && !/^rec[A-Za-z0-9]+$/.test(customerId))) throw new BadRequestException('所属客户筛选无效');
    if (!validProjectFilter(filter)) throw new BadRequestException('项目筛选无效');
    if (!validFollowupFilter(followupFilter)) throw new BadRequestException('跟进状态筛选无效');
    if (search !== undefined && (typeof search !== 'string' || search.length > 200)) throw new BadRequestException('搜索内容过长');
    if (cursor !== undefined && cursor !== '' && (typeof cursor !== 'string' || !/^offset:\d{1,6}$/.test(cursor))) throw new BadRequestException('分页标记无效');
    const offset = cursor ? Number(cursor.slice(7)) : 0;
    const now = Date.now();
    const rows = sortProjects(scopedProjects(projectFollowupSummary(await this.allBusiness('project'), await this.allBusiness('followup'), now), checked, userId)
      .filter(row => projectMatches(row, filter === 'all' && followupFilter === 'none' ? 'none' : filter, now)
        && (!customerId || linkIds(row.record['所属企业']).includes(customerId))
        && (followupFilter === 'all' || projectMatches(row, followupFilter, now))
        && (!search || textValue(row.record['项目名称']).toLocaleLowerCase().includes(search.toLocaleLowerCase()))), now);
    if (offset > rows.length) throw new ConflictException('项目列表已变化，请刷新');
    const more = offset + 50 < rows.length;
    return { records: rows.slice(offset, offset + 50), total: rows.length, hasMore: more, ...(more ? { pageToken: `offset:${offset + 50}` } : {}) };
  }
  async customerList(filter: string, cursor?: string, search?: string): Promise<CrmPage> {
    if (!validFollowupFilter(filter)) throw new BadRequestException('跟进状态筛选无效');
    if (search !== undefined && (typeof search !== 'string' || search.length > 200)) throw new BadRequestException('搜索内容过长');
    if (cursor && !/^offset:\d{1,6}$/.test(cursor)) throw new BadRequestException('分页标记无效');
    const offset = cursor ? Number(cursor.slice(7)) : 0;
    const now = Date.now();
    const rows = sortFollowups((await this.allBusiness('customer')).filter(row =>
      (filter === 'all' || followupStatus(row.record, now).key === filter) &&
      (!search || textValue(row.record['企业全称']).toLocaleLowerCase().includes(search.toLocaleLowerCase()))), now);
    if (offset > rows.length) throw new ConflictException('客户列表已变化，请刷新');
    const more = offset + 50 < rows.length;
    return { records: rows.slice(offset, offset + 50), total: rows.length, hasMore: more,
      ...(more ? { pageToken: 'offset:' + (offset + 50) } : {}) };
  }
  private async people(
    fields: Record<string, unknown>,
    spec: FieldSpec[],
    historical = false,
    verifiedEmployeeId?: string,
  ): Promise<void> {
    const ids = [...new Set(spec
      .filter((f) => f.type === 'person')
      .flatMap((f) =>
        Array.isArray(fields[f.key]) ? (fields[f.key] as number[]) : [],
      ))];
    // The gateway already verified this request's tenant employee identity.
    // Do not require a newly joined employee's secondary ID mapping to exist
    // when they select themselves. This ID is supplied only by the controller.
    const pendingIds = ids.filter(id => String(id) !== verifiedEmployeeId);
    if (!pendingIds.length) return;
    // Resolve via the app's tenant-scoped employee-ID mapping, then round-trip
    // to prevent accepting a foreign/global ID or requiring prior roster import.
    const known = new Set<number>(ids.filter(id => String(id) === verifiedEmployeeId));
    for (let start = 0; start < pendingIds.length; start += 100) {
      const batch = pendingIds.slice(start, start + 100).map(String);
      let employees: (string | null)[];
      let resolved: (string | null)[];
      try {
        employees = await this.identities.getBatchLarkUserIds(batch);
        if (!Array.isArray(employees) || employees.length !== batch.length)
          throw new Error('Invalid employee mapping');
        const valid = employees.filter((id): id is string => typeof id === 'string' && !!id.trim());
        resolved = valid.length ? await this.identities.getBatchMiaodaUserIds(valid) : [];
        if (!Array.isArray(resolved) || resolved.length !== valid.length)
          throw new Error('Invalid employee round-trip');
      } catch {
        this.logger.warn('Platform employee identity validation failed');
        throw new BadGatewayException('企业人员校验暂时失败，请稍后重试');
      }
      let offset = 0;
      employees.forEach((employee: string | null, index: number) => {
        if (typeof employee === 'string' && employee.trim()) {
          if (resolved[offset] === batch[index]) known.add(pendingIds[start + index]);
          offset++;
        }
      });
    }
    if (ids.every((id: number) => known.has(id))) return;
    if (!historical) reject('人员', '暂时无法核验所选员工的企业身份，请稍后重试或联系管理员检查通讯录映射');
    // Historical review may retain a previously synchronized enterprise member
    // whose current platform mapping is no longer available.
    let cursor: string | undefined;
    let pages = 0;
    do {
      const page = await this.list('access', cursor);
      for (const r of page.records) {
        if (Array.isArray(r.record['飞书成员']))
          for (const id of r.record['飞书成员'])
            if (typeof id === 'number') known.add(id);
      }
      cursor = page.hasMore ? page.pageToken : undefined;
      if (page.hasMore && !cursor)
        throw new BadGatewayException('人员分页不完整');
      if (++pages > 100)
        throw new BadGatewayException('人员范围过大，请联系管理员');
    } while (cursor);
    if (ids.some((id) => !known.has(id)))
      reject('人员', '历史人员未通过企业身份核验');
  }
  private async activeCustomer(id: string): Promise<CrmRecord> {
    const c = await this.get('customer', id);
    return c;
  }
  private async relationChecks(
    key: EntityKind,
    d: Draft,
    fields: Record<string, unknown>,
    reviewing?: CrmRecord,
  ): Promise<void> {
    const arr = (k: string): string[] =>
      Array.isArray(d[k]) ? (d[k] as string[]) : [];
    if (key === 'project' && reviewing && ['已完成', '已取消'].includes(textValue(reviewing.record['终局确认']))) {
      // Terminal review must not depend on customer quality (which aggregates these projects).
      await this.get('customer', arr('所属企业')[0]);
    } else if (key === 'contact' || key === 'project')
      await this.activeCustomer(arr('所属企业')[0]);
    if (key !== 'followup') return;
    const customer = arr('直接客户'),
      project = arr('关联项目');
    if (
      d['跟进归属'] === '客户直接跟进'
        ? customer.length !== 1 || project.length > 0
        : project.length !== 1 || customer.length > 0
    )
      reject('跟进归属', '客户和项目必须二选一');
    let customerId = customer[0];
    const occurred = fields['实际发生时间'] as number;
    if (project.length) {
      const p = await this.get('project', project[0]);
      historicalContext('project', p, occurred);
      const parents = linkIds(p.record['所属企业']);
      if (parents.length !== 1) reject('关联项目', '项目必须且只能关联一个企业，请先核对');
      customerId = parents[0];
    }
    if (!customerId) reject('跟进归属', '无法确定所属企业');
    historicalContext('customer', await this.get('customer', customerId), occurred);
    if (d['记录类型'] === '外部沟通') {
      if (
        !['电话', '线上会议', '现场', '即时消息', '邮件', '其他'].includes(
          String(d['沟通 / 推进方式']),
        )
      )
        reject('沟通 / 推进方式', '请选择外部沟通方式');
      for (const id of arr('客户联系人')) {
        const c = await this.get('contact', id);
        const parents = linkIds(c.record['所属企业']);
        if (parents.length !== 1 || parents[0] !== customerId)
          reject('客户联系人', '联系人不属于当前企业');
        const issue = contactChoiceProblem(c, occurred);
        if (issue) reject('客户联系人', issue);
      }
    } else {
      if (arr('客户联系人').length)
        reject('客户联系人', '内部推进不应选择客户联系人');
      if (
        d['沟通 / 推进方式'] &&
        !['内部讨论', '资料处理', '其他'].includes(String(d['沟通 / 推进方式']))
      )
        reject('沟通 / 推进方式', '请选择内部推进方式');
    }
    if (d['后续安排'] === '有下一步行动') {
      if (!d['建议下一步行动']) reject('建议下一步行动', '请填写下一步建议');
      if (d['无后续动作结论']) reject('无后续动作结论', '请清空无后续动作结论');
    } else {
      if (!d['无后续动作结论']) reject('无后续动作结论', '请填写结论');
      if (d['建议下一步行动'] || d['建议日期'] || arr('建议处理人').length)
        reject('后续安排', '请清空所有下一步建议');
    }
  }
  private assertActive(row: CrmRecord): void {
    if (['已完成', '已取消'].includes(textValue(row.record['终局确认'])))
      reject('记录', '项目已经结束，不能继续推进');
  }
  private async projectAdvancement(row: CrmRecord): Promise<void> {
    const blocked = advancementBlocked('project', row);
    if (blocked) reject('项目', blocked);
    const parents = linkIds(row.record['所属企业']);
    if (parents.length !== 1) reject('所属企业', '项目必须关联一个企业');
    await this.activeCustomer(parents[0]);
  }
  private validateFacts(key: EntityKind, draft: Draft, existing?: CrmRecord): void {
    if (key === 'contact') {
      if (!draft['电话'] && !draft['邮箱'])
        reject('联系方式', '电话或邮箱至少填写一项');
      if (
        draft['邮箱'] &&
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(draft['邮箱']))
      )
        reject('邮箱', '格式无效');
    }
    if (key === 'project') {
      if (
        draft['项目类型'] !== '销售机会' &&
        commerceKeys.some((k) => draft[k] != null)
      ) {
        const before = existing ? recordDraft(existing.record, forms.project) : {};
        const spec = forms.project.filter((f) => commerceKeys.includes(f.key));
        if (!existing || Object.keys(changedFields(before, draft, spec)).length)
          reject('项目类型', '非销售项目只能保留已有商务信息，不能新增或修改商务金额');
      }
      if (
        draft['预计金额'] != null &&
        (!draft['币种'] || !draft['金额含税口径'])
      )
        reject('预计金额', '填写金额时必须填写币种和含税口径');
    }
  }
  async create(kind: string, body: unknown, verifiedEmployeeId?: string, actor?: string): Promise<WriteResult> {
    const previous = kind === 'followup' && body && typeof body === 'object' && '上次跟进' in body && Array.isArray(body['上次跟进'])
      ? body['上次跟进'][0] : undefined;
    const lock = typeof previous === 'string' ? `followup:${previous}` : undefined;
    if (lock && this.updating.has(lock)) throw new ConflictException('上次跟进正在处理，请稍后刷新');
    if (lock) this.updating.add(lock);
    try { return typeof previous === 'string'
      ? await this.followupWrite(previous, 'continue', permit => this.createRecord(kind, body, verifiedEmployeeId, actor, permit))
      : await this.createRecord(kind, body, verifiedEmployeeId, actor); }
    finally { if (lock) this.updating.delete(lock); }
  }
  private async followupWrite<T>(id: string, operation: string, work: (permit: FollowupWritePermit) => Promise<T>): Promise<T> {
    if (!/^rec[A-Za-z0-9]+$/.test(id)) reject('跟进记录', '标识无效');
    return this.followupWrites.run(id, operation, {
      isVoided: async childId => textValue((await this.get('followup', childId)).record['记录状态']) === '已作废',
      findSaved: async (token, pendingOperation) => {
        const rows = pendingOperation === 'continue' ? await this.allBusiness('followup') : [await this.get('followup', id)];
        return rows.find(row => textValue(row.record['管理记录']).split('\n').includes(writeMarker(token)) &&
          (pendingOperation !== 'continue' || linkIds(row.record['上次跟进']).includes(id)))?.id;
      },
    }, work);
  }
  private async createRecord(kind: string, body: unknown, verifiedEmployeeId?: string, actor?: string, permit?: FollowupWritePermit): Promise<WriteResult> {
    const key = this.kind(kind);
    if (key === 'access') reject('成员', '人员由通讯录同步，请在 Base 管理');
    const { draft, fields } = parseDraft(body, forms[key], this.enums(key));
    // Keep Base's record name useful without asking users for a separate subject.
    if (key === 'followup' && !fields['跟进主题'])
      fields['跟进主题'] = Array.from(textValue(fields['内容 / 推进结论']).trim().replace(/\s+/g, ' '))
        .slice(0, 80).join('');
    this.validateFacts(key, draft);
    await this.people(fields, forms[key], false, verifiedEmployeeId);
    await this.relationChecks(key, draft, fields);
    Object.assign(
      fields,
      key === 'customer'
        ? {}
        : key === 'project'
          ? { 工作状态: '待启动', 终局确认: '未确认' }
          : key === 'contact'
            ? { 联系人状态: '有效' }
            : { 记录状态: '正常', 后续处理: draft['后续安排'] === '有下一步行动' ? '待跟进' : '已结束' },
    );
    const attachmentCheck = key === 'followup' ? await this.prepareAttachments(fields) : undefined;
    if (key === 'followup') await this.continuationParent(fields);
    await permit?.beforeWrite(fields);
    const result = await this.call(key, 'batchAddRecords', {
      records: [{ record: fields }],
    });
    const id = this.writtenId(result);
    permit?.created(id);
    if (attachmentCheck) await this.nativeAttachments.apply(attachmentCheck, id);
    await this.verifySaved(key, id, fields, attachmentCheck?.expected);
    const projectId = key === 'followup' && Array.isArray(draft['关联项目']) ? draft['关联项目'][0] : undefined;
    if (projectId) {
      try {
        const started = await this.startProjectAfterFollowup(projectId, id, textValue(fields['内容 / 推进结论']), actor);
        if (started) return { id, message: '跟进记录已保存，项目已更新为进行中' };
      } catch (error: unknown) {
        this.logger.error(`跟进 ${id} 已保存，项目 ${projectId} 自动启动未确认`, error instanceof Error ? error.stack : String(error));
        return { id, message: '跟进记录已保存',
          warning: '跟进记录已保存，但项目状态自动更新未确认。请刷新项目核对，必要时在编辑项目中修改状态，无需重复新增跟进。' };
      }
    }
    return {
      id,
      message: '已保存',
    };
  }
  private async startProjectAfterFollowup(projectId: string, followupId: string, conclusion: string, actor?: string): Promise<boolean> {
    const lock = `project:${projectId}`;
    if (this.updating.has(lock)) throw new ConflictException('项目正在修改');
    this.updating.add(lock);
    try {
      const row = await this.get('project', projectId);
      if (textValue(row.record['工作状态']) !== '待启动' || textValue(row.record['终局确认']) !== '未确认') return false;
      // Saving the followup recalculates linked and formula fields on this project.
      // Recheck ownership and lifecycle, and merge the patch onto the latest writable values.
      const latest = await this.get('project', projectId);
      if (textValue(latest.record['工作状态']) !== '待启动' || textValue(latest.record['终局确认']) !== '未确认' ||
          !isDeepStrictEqual(linkIds(row.record['所属企业']), linkIds(latest.record['所属企业'])))
        throw new ConflictException('项目状态或所属客户已变化');
      const note = [textValue(latest.record['管理记录']),
        `跟进自动启动 · ${new Date().toISOString()} · ${actor || '系统'}\n${auditNote(`新增跟进 ${followupId}，项目状态：待启动 → 进行中`)}`,
      ].filter(Boolean).join('\n\n');
      if (note.length > 20000) reject('管理记录', '历史记录已达上限');
      const fields: Record<string, unknown> = { 工作状态: '进行中', 管理记录: note };
      if (!textValue(latest.record['当前进展']).trim()) fields['当前进展'] = Array.from(conclusion).slice(0, 2000).join('');
      const written = this.writtenId(await this.call('project', 'batchUpdateRecords', {
        records: [{ id: projectId, record: fields }],
      }));
      if (written !== projectId) throw new BadGatewayException('项目更新响应记录不一致');
      await this.verifySaved('project', projectId, fields);
      return true;
    } finally {
      this.updating.delete(lock);
    }
  }
  private writtenId(result: unknown): string {
    if (
      !result ||
      typeof result !== 'object' ||
      !('records' in result) ||
      !Array.isArray(result.records) ||
      result.records.length !== 1 ||
      typeof result.records[0]?.id !== 'string'
    )
      throw new BadGatewayException('保存结果未确认，请先刷新核对');
    return result.records[0].id;
  }
  private async prepareAttachments(fields: Record<string, unknown>, previous?: unknown, id?: string): Promise<NativeAttachmentPlan | undefined> {
    if (!Object.hasOwn(fields, '附件')) return undefined;
    if (!id && Array.isArray(fields['附件']) && !fields['附件'].length) {
      delete fields['附件']; return undefined;
    }
    try {
      const config = this.capability.getCapability('crm-followup')?.formValue;
      const result = await this.nativeAttachments.prepare(String(config?.appToken || ''), String(config?.tableID || ''),
        fields['附件'] as string[], previous, this.files, id);
      // Never send attachments through the URL-import plugin: it changes filenames.
      delete fields['附件'];
      return result;
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      throw new BadRequestException('附件处理失败，记录尚未保存，请重新上传或稍后重试');
    }
  }
  private async verifySaved(key: EntityKind, id: string, fields: Record<string, unknown>, attachmentCheck?: ExpectedAttachment[]): Promise<void> {
    let saved: CrmRecord;
    try {
      saved = await this.get(key, id);
    } catch {
      throw new BadGatewayException(`保存后的回读未完成，请刷新核对记录 ${id}，避免重复提交`);
    }
    const specs = [...forms[key], ...planFields, ...endFields, ...progressFields];
    // Read-after-write may lag; retry the read only, never create another record.
    if (attachmentCheck) {
      for (let attempt = 0; attempt < 3 && !attachmentWriteMatches(saved.record['附件'], attachmentCheck); attempt++) {
        await new Promise(resolve => setTimeout(resolve, 300 * (attempt + 1)));
        saved = await this.get(key, id);
      }
      if (!attachmentWriteMatches(saved.record['附件'], attachmentCheck))
        throw new BadGatewayException(`附件原文件名或数量未正确回读，请刷新核对记录 ${id}，避免重复提交`);
    }
    const mismatch = Object.entries(fields).some(([name, expected]) => {
      const actual = saved.record[name];
      if (name === '附件' && attachmentCheck) return !attachmentWriteMatches(actual, attachmentCheck);
      if (expected === null) return actual != null;
      if (Array.isArray(expected)) {
        const values = specs.find((f) => f.key === name)?.type === 'relation'
          ? linkIds(actual) : actual == null ? [] : actual;
        return !Array.isArray(values) || !isDeepStrictEqual([...expected].sort(), [...values].sort());
      }
      if (typeof expected === 'string') return textValue(actual) !== expected;
      return actual !== expected;
    });
    if (mismatch) throw new BadGatewayException(`保存回读不一致，请刷新核对记录 ${id} 后再操作`);
  }
  async update(
    kind: string,
    id: string,
    operation: string,
    body: unknown,
    actor: string,
    verifiedEmployeeId?: string,
  ): Promise<WriteResult> {
    const key = this.kind(kind);
    const lock = `${key}:${id}`;
    if (this.updating.has(lock)) throw new ConflictException('此记录正在保存，请稍后刷新再操作');
    this.updating.add(lock);
    try {
      return key === 'followup'
        ? await this.followupWrite(id, operation, permit => this.updateRecord(key, id, operation, body, actor, verifiedEmployeeId, permit))
        : await this.updateRecord(key, id, operation, body, actor, verifiedEmployeeId);
    } finally {
      this.updating.delete(lock);
    }
  }
  private async updateRecord(
    key: EntityKind,
    id: string,
    operation: string,
    body: unknown,
    actor: string,
    verifiedEmployeeId?: string,
    permit?: FollowupWritePermit,
  ): Promise<WriteResult> {
    const row = await this.get(key, id);
    if (!body || typeof body !== 'object' || Array.isArray(body))
      reject('表单', '格式无效');
    const source = body as Record<string, unknown>;
    const { expectedModifiedAt, ...submitted } = source;
    let input: Record<string, unknown> = submitted;
    if (
      typeof expectedModifiedAt !== 'number' ||
      row.record['修改时间'] !== expectedModifiedAt
    )
      throw new ConflictException('记录已变化，请刷新后重新操作');
    if (operation === 'status') {
      if (key !== 'project') reject('操作', '仅项目支持更新状态');
      const next = statusInput(row, input);
      operation = next.operation; input = next.input;
    }
    let fields: Record<string, unknown>;
    let related: RelatedSnapshot[] = [];
    if (key === 'followup' && ['end-followup', 'resume-followup'].includes(operation)) {
      const current = (await this.chainRows()).find(item => item.id === id);
      const activation = operation !== 'end-followup';
      if (!current || current.followup?.state !== (activation ? '已结束' : '待跟进'))
        throw new ConflictException('跟进状态已变化，请刷新后再操作');
      if (activation && (textValue(row.record['后续安排']) !== '有下一步行动' || textValue(row.record['数据检查']).trim() || !textValue(row.record['建议下一步行动']).trim() ||
        !validChainTime(row.record['实际发生时间']) || Number(row.record['实际发生时间']) > Date.now() || !followupTarget(row)))
        reject('后续安排', '请先完善下一步建议');
      const parsed = parseDraft(input, [{ key: '结束跟进说明', type: 'long' }], {});
      const action = activation ? '恢复跟进' : '结束跟进';
      fields = { 后续处理: activation ? '待跟进' : '已结束',
        结束跟进说明: activation ? '' : textValue(parsed.fields['结束跟进说明']),
        管理记录: [textValue(row.record['管理记录']), `${action} · ${new Date().toISOString()} · ${actor}`].filter(Boolean).join('\n\n') };
      if (textValue(fields['管理记录']).length > 20000) reject('管理记录', '历史记录已达上限');
    } else if (isLifecycle(operation)) {
      const prepared = await prepareLifecycle(key, row, operation, input, actor, {
        get: (kind, recordId) => this.get(kind, recordId),
        people: (values) => this.people(values, planFields, false, verifiedEmployeeId),
      });
      fields = prepared.fields;
      related = prepared.related;
    } else if (operation === 'edit' && key !== 'access') {
      const edited = prepareEdit(key, row, input, this.enums(key), actor);
      this.validateFacts(key, edited.draft, row);
      const peopleFields = { ...edited.validationFields };
      if (key === 'followup') {
        // Validate added IDs against the enterprise roster without blocking
        // unchanged historical participants that are no longer in the roster.
        for (const f of forms[key]) {
          const selected = peopleFields[f.key];
          if (f.type === 'person' && Array.isArray(selected)) {
            const before = row.record[f.key];
            peopleFields[f.key] = selected.filter((id: unknown) => !Array.isArray(before) || !before.includes(id));
          }
        }
      }
      await this.people(peopleFields, forms[key], false, verifiedEmployeeId);
      await this.relationChecks(key, edited.draft, edited.validationFields);
      fields = edited.writes;
      if (key === 'followup' && ['', '待跟进', '已结束'].includes(textValue(row.record['后续处理'])) && !explicitlyEnded(row.record)) {
        // Enable reminders again after changing an automatic no-action ending; keep explicit endings closed.
        fields['后续处理'] = edited.draft['后续安排'] === '有下一步行动' ? '待跟进' : '已结束';
      }
      if (key === 'followup' && Object.hasOwn(fields, '实际发生时间')) {
        const chain = await this.chainRows();
        const before = chain.find(item => item.id === id);
        const parent = chain.find(item => item.id === before?.followup?.previousId);
        const time = Number(fields['实际发生时间']);
        if (parent && time < Number(parent.record['实际发生时间'])) reject('跟进时间', '不能早于上次跟进');
        if (chain.some(item => before?.followup?.nextIds.includes(item.id) && time > Number(item.record['实际发生时间'])))
          reject('跟进时间', '不能晚于后续跟进');
      }
      if (key === 'project') {
        const prepared = await prepareProjectEditStatus(row, edited.draft, fields, actor, {
          get: (kind, recordId) => this.get(kind, recordId),
          people: (values) => this.people(values, planFields, false, verifiedEmployeeId),
        });
        fields = prepared.fields;
        related = prepared.related;
      }
    } else if (
      operation === 'plan' &&
      (key === 'customer' || key === 'project')
    ) {
      this.assertActive(row);
      if (key === 'project') await this.projectAdvancement(row);
      const parsed = parseDraft(input, planFields, this.enums(key));
      fields = parsed.fields;
      if (!fields['行动执行人']) fields['行动执行人'] = [];
      await this.people(fields, planFields, false, verifiedEmployeeId);
    } else if (operation === 'suggest-end' && key === 'project') {
      await this.projectAdvancement(row);
      fields = parseDraft(input, endFields, this.enums(key)).fields;
    } else if (operation === 'progress' && key === 'project') {
      await this.projectAdvancement(row);
      const parsed = parseDraft(input, progressFields, {});
      fields = parsed.fields;
      validateSignedDate(fields);
      if (parsed.draft['工作状态'] === '暂停') {
        if (!parsed.draft['暂停原因']) reject('暂停原因', '暂停时必填');
        for (const f of planFields) delete fields[f.key];
      } else {
        if (!parsed.draft['当前下一步行动'] || !parsed.draft['下次跟进日期'])
          reject('当前计划', '启动或恢复项目时请确认下一步行动和日期');
        fields['暂停原因'] = '';
      }
      if (parsed.draft['工作状态'] !== '暂停' && Object.hasOwn(input, '行动执行人') && !fields['行动执行人'])
        fields['行动执行人'] = [];
      await this.people(fields, progressFields, false, verifiedEmployeeId);
      const note = [textValue(row.record['管理记录']),
        `进展更新 · ${new Date().toISOString()} · ${actor}\n${textValue(row.record['工作状态'])} → ${String(parsed.draft['工作状态'])}\n${auditNote(String(parsed.draft['变更说明']))}`,
      ].filter(Boolean).join('\n\n');
      if (note.length > 20000) reject('管理记录', '历史说明已达上限，请先整理留存');
      delete fields['变更说明'];
      fields['管理记录'] = note;
    } else if (operation === 'access' && key === 'access') {
      fields = parseDraft(input, forms.access, this.enums(key)).fields;
    } else reject('操作', '不支持的操作');
    const attachmentCheck = key === 'followup' ? await this.prepareAttachments(fields, row.record['附件'], id) : undefined;
    // Base has no atomic compare-and-set. Recheck after slow relation/person/file reads;
    // a process-local lock also excludes overlapping updates in this instance.
    for (const check of related) {
      if (!isDeepStrictEqual(check.row.record, (await this.get(check.kind, check.row.id)).record))
        throw new ConflictException('关联记录在操作期间已变化，请刷新后重新操作');
    }
    const latest = await this.get(key, id);
    // Download signatures expire/rotate; compare attachment identity metadata instead.
    const comparable = (record: CrmRecord['record']) => key === 'followup'
      ? { ...record, 附件: attachmentSignature(record['附件']) } : record;
    if (!isDeepStrictEqual(comparable(row.record), comparable(latest.record)))
      throw new ConflictException('记录在校验期间已变化，请刷新后重新操作');
    await permit?.beforeWrite(fields);
    const written = this.writtenId(
      await this.call(key, 'batchUpdateRecords', {
        records: [{ id, record: fields }],
      }),
    );
    if (written !== id) throw new BadGatewayException('保存响应记录不一致，请刷新核对');
    if (attachmentCheck) await this.nativeAttachments.apply(attachmentCheck, id);
    await this.verifySaved(key, id, fields, attachmentCheck?.expected);
    return {
      id,
      message:
        key === 'access'
          ? '已保存授权意向；未改变飞书或妙搭实际角色'
          : operation === 'edit'
            ? '修改已保存'
            : '已保存并回读飞书记录',
    };
  }
}
