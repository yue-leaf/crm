import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  NotFoundException,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import { CapabilityService } from '@lark-apaas/fullstack-nestjs-core';
import { isDeepStrictEqual } from 'node:util';
import type {
  CrmPage,
  EntityKind,
  CrmRecord,
  WriteResult,
  CrmSummary,
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
import { changedFields, recordDraft } from '@shared/crm-edit';
import {
  advancementBlocked, commerceKeys, existingProjectFields, progressFields,
} from '@shared/crm-workflow';
import { contactLifecycleProblem, recordReviewProblem } from '@shared/crm-review';
import { isLifecycle } from '@shared/crm-lifecycle';
import { prepareLifecycle } from './crm-lifecycle';
import type { RelatedSnapshot } from './crm-lifecycle';
import { historicalContext } from './crm-workflow';

@Injectable()
export class CrmService {
  private readonly logger = new Logger(CrmService.name);
  private readonly updating = new Set<string>();
  constructor(
    @Inject(CapabilityService) private readonly capability: CapabilityService,
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
    return Object.fromEntries(
      fields
        .filter((f) => typeof f === 'object' && f && 'enumValues' in f)
        .map((f) => [f.name, f.enumValues]),
    );
  }
  async list(kind: string, cursor?: string, search?: string): Promise<CrmPage> {
    const key = this.kind(kind);
    if (cursor !== undefined && (typeof cursor !== 'string' || cursor.length > 2048))
      throw new BadRequestException('分页标记无效');
    if (search !== undefined && (typeof search !== 'string' || search.length > 200))
      throw new BadRequestException('搜索内容过长');
    const result = await this.call(key, 'searchRecords', {
      pageSize: 50,
      ...(cursor ? { pageToken: cursor } : {}),
      ...(search
        ? {
            filter: {
              conjunction: 'and',
              conditions: [
                {
                  fieldName: titles[key],
                  operator: 'contains',
                  value: [search],
                },
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
    return result as CrmPage;
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
  private async people(
    fields: Record<string, unknown>,
    spec: FieldSpec[],
    includeInactive = false,
  ): Promise<void> {
    const ids = spec
      .filter((f) => f.type === 'person')
      .flatMap((f) =>
        Array.isArray(fields[f.key]) ? (fields[f.key] as number[]) : [],
      );
    if (!ids.length) return;
    const known = new Set<number>();
    let cursor: string | undefined;
    let pages = 0;
    do {
      const page = await this.list('access', cursor);
      for (const r of page.records) {
        if (
          (includeInactive || textValue(r.record['目录状态']) === '已激活') &&
          Array.isArray(r.record['飞书成员'])
        )
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
      reject('人员', '请选择已同步且已激活的企业员工');
  }
  private async activeCustomer(id: string): Promise<CrmRecord> {
    const c = await this.get('customer', id);
    if (c.record['已归档'] === true) reject('所属企业', '企业已归档');
    if (textValue(c.record['核查标记']) !== '正常')
      reject('所属企业', '企业需先核查通过');
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
      const customer = await this.get('customer', arr('所属企业')[0]);
      if (customer.record['已归档'] === true) {
        const archived = customer.record['归档时间'];
        const closed = reviewing.record['结束日期'];
        const day = (ms: number) => Math.floor((ms + 8 * 3600000) / 86400000);
        if (typeof archived !== 'number' || !Number.isFinite(archived) || archived > Date.now() ||
            typeof closed !== 'number' || !Number.isFinite(closed) || day(closed) > day(archived))
          reject('所属企业', '归档边界异常或项目结束晚于客户归档，请在原表核对');
      }
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
      if (!arr('客户联系人').length)
        reject('客户联系人', '外部沟通必须选择联系人');
      for (const id of arr('客户联系人')) {
        const c = await this.get('contact', id);
        const parents = linkIds(c.record['所属企业']);
        if (parents.length !== 1 || parents[0] !== customerId)
          reject('客户联系人', '联系人不属于当前企业');
        if (textValue(c.record['核查标记']) !== '正常')
          reject('客户联系人', '联系人需先核查通过');
        const issue = contactLifecycleProblem(c.record);
        if (issue) reject('客户联系人', issue);
        if (
          textValue(c.record['联系人状态']) !== '有效' &&
          !(
            textValue(c.record['联系人状态']) === '停用' &&
            typeof c.record['停用时间'] === 'number' &&
            Number.isFinite(c.record['停用时间']) &&
            occurred < c.record['停用时间']
          )
        )
          reject('客户联系人', '发生时间不在联系人有效期内');
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
    if (row.record['已归档'] === true) reject('记录', '已归档，不能继续推进');
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
          reject('项目类型', '非销售项目只能保留已有商务信息供核查，不能新增或修改商务金额');
      }
      if (
        draft['预计金额'] != null &&
        (!draft['币种'] || !draft['金额含税口径'])
      )
        reject('预计金额', '填写金额时必须填写币种和含税口径');
    }
  }
  async create(kind: string, body: unknown): Promise<WriteResult> {
    const key = this.kind(kind);
    if (key === 'access') reject('成员', '人员由通讯录同步，请在 Base 管理');
    const { draft, fields } = parseDraft(body, forms[key], this.enums(key));
    this.validateFacts(key, draft);
    await this.people(fields, forms[key]);
    await this.relationChecks(key, draft, fields);
    Object.assign(
      fields,
      { 核查标记: '待核查' },
      key === 'customer'
        ? { 客户关系状态: '待建立', 已归档: false }
        : key === 'project'
          ? { 工作状态: '待启动', 终局确认: '未确认', 已归档: false }
          : key === 'contact'
            ? { 联系人状态: '有效' }
            : { 记录状态: '正常' },
    );
    const result = await this.call(key, 'batchAddRecords', {
      records: [{ record: fields }],
    });
    const id = this.writtenId(result);
    await this.verifySaved(key, id, fields);
    return {
      id,
      message: '已保存到飞书，待管理员核查；当前计划不会被跟进建议覆盖',
    };
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
  private async verifySaved(key: EntityKind, id: string, fields: Record<string, unknown>): Promise<void> {
    let saved: CrmRecord;
    try {
      saved = await this.get(key, id);
    } catch {
      throw new BadGatewayException(`保存后的回读未完成，请刷新核对记录 ${id}，避免重复提交`);
    }
    const specs = [...forms[key], ...planFields, ...endFields, ...progressFields];
    const mismatch = Object.entries(fields).some(([name, expected]) => {
      const actual = saved.record[name];
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
  ): Promise<WriteResult> {
    const key = this.kind(kind);
    const lock = `${key}:${id}`;
    if (this.updating.has(lock)) throw new ConflictException('此记录正在保存，请稍后刷新再操作');
    this.updating.add(lock);
    try {
      return await this.updateRecord(key, id, operation, body, actor);
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
  ): Promise<WriteResult> {
    const row = await this.get(key, id);
    if (!body || typeof body !== 'object' || Array.isArray(body))
      reject('表单', '格式无效');
    const source = body as Record<string, unknown>;
    const { expectedModifiedAt, ...input } = source;
    if (
      typeof expectedModifiedAt !== 'number' ||
      row.record['修改时间'] !== expectedModifiedAt
    )
      throw new ConflictException('记录已变化，请刷新后重新操作');
    let fields: Record<string, unknown>;
    let related: RelatedSnapshot[] = [];
    if (isLifecycle(operation)) {
      const prepared = await prepareLifecycle(key, row, operation, input, actor, {
        get: (kind, recordId) => this.get(kind, recordId),
        people: (values) => this.people(values, planFields),
      });
      fields = prepared.fields;
      related = prepared.related;
    } else if (operation === 'edit' && key !== 'access') {
      const edited = prepareEdit(key, row, input, this.enums(key), actor);
      this.validateFacts(key, edited.draft, row);
      const peopleFields = { ...edited.validationFields };
      if (key === 'followup') {
        // Validate the added IDs, not the whole changed array: departed historical
        // participants must not prevent adding a currently active colleague.
        for (const f of forms[key]) {
          const selected = peopleFields[f.key];
          if (f.type === 'person' && Array.isArray(selected)) {
            const before = row.record[f.key];
            peopleFields[f.key] = selected.filter((id: unknown) => !Array.isArray(before) || !before.includes(id));
          }
        }
      }
      await this.people(peopleFields, forms[key]);
      await this.relationChecks(key, edited.draft, edited.validationFields);
      fields = edited.writes;
    } else if (
      operation === 'plan' &&
      (key === 'customer' || key === 'project')
    ) {
      this.assertActive(row);
      if (key === 'project') await this.projectAdvancement(row);
      const parsed = parseDraft(input, planFields, this.enums(key));
      fields = parsed.fields;
      if (!fields['行动执行人']) fields['行动执行人'] = [];
      await this.people(fields, planFields);
    } else if (operation === 'suggest-end' && key === 'project') {
      await this.projectAdvancement(row);
      fields = parseDraft(input, endFields, this.enums(key)).fields;
    } else if (operation === 'progress' && key === 'project') {
      await this.projectAdvancement(row);
      const parsed = parseDraft(input, progressFields, this.enums(key));
      fields = parsed.fields;
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
      await this.people(fields, progressFields);
      const note = [textValue(row.record['管理记录']),
        `进展更新 · ${new Date().toISOString()} · ${actor}\n${textValue(row.record['工作状态'])} → ${String(parsed.draft['工作状态'])}\n${String(parsed.draft['变更说明'])}`,
      ].filter(Boolean).join('\n\n');
      if (note.length > 20000) reject('管理记录', '历史说明已达上限，请先整理留存');
      delete fields['变更说明'];
      fields['管理记录'] = note;
      fields['核查标记'] = '待核查';
    } else if (operation === 'access' && key === 'access') {
      fields = parseDraft(input, forms.access, this.enums(key)).fields;
      for (const f of forms.access) {
        if ((f.type === 'text' || f.type === 'long') && Object.hasOwn(input, f.key) && fields[f.key] === undefined)
          fields[f.key] = '';
      }
    } else if (operation === 'review' && key !== 'access') {
      const parsed = parseDraft(
        input,
        [{ key: '核查说明', type: 'long', required: true }],
        {},
      );
      fields = parsed.fields;
      if (textValue(row.record['核查标记']) !== '待核查')
        reject('核查', '此记录不处于待核查状态');
      // Revalidate original data and cross-record relations before admitting it into aggregates.
      const original = recordDraft(row.record, forms[key]);
      const issue = recordReviewProblem(key, row.record);
      if (issue) reject('核查', issue);
      const reviewSpec = key === 'project' ? existingProjectFields(row.record) : forms[key];
      const checked = parseDraft(original, reviewSpec, this.enums(key));
      // Revalidation must not round historical timestamps down to a whole second.
      for (const f of forms[key])
        if ((f.type === 'date' || f.type === 'datetime') && typeof row.record[f.key] === 'number')
          checked.fields[f.key] = row.record[f.key];
      this.validateFacts(key, checked.draft, row);
      // The administrator confirms historical participation. Directory existence
      // is still required, but subsequent deactivation must not erase history.
      await this.people(checked.fields, forms[key], key === 'followup');
      await this.relationChecks(key, checked.draft, checked.fields, row);
      fields['核查标记'] = '正常';
      fields['核查说明'] = [
        textValue(row.record['核查说明']),
        `${textValue(fields['核查说明'])}\n核查人 ${actor} · ${new Date().toISOString()}`,
      ]
        .filter(Boolean)
        .join('\n\n');
      if (String(fields['核查说明']).length > 20000)
        reject('核查说明', '历史说明已达上限，请先整理留存');
    } else reject('操作', '不支持的操作');
    // Base has no atomic compare-and-set. Recheck after slow relation/person reads;
    // a process-local lock also excludes overlapping updates in this instance.
    for (const check of related) {
      if (!isDeepStrictEqual(check.row.record, (await this.get(check.kind, check.row.id)).record))
        throw new ConflictException('关联记录在操作期间已变化，请刷新后重新操作');
    }
    const latest = await this.get(key, id);
    if (!isDeepStrictEqual(row.record, latest.record))
      throw new ConflictException('记录在校验期间已变化，请刷新后重新操作');
    const written = this.writtenId(
      await this.call(key, 'batchUpdateRecords', {
        records: [{ id, record: fields }],
      }),
    );
    if (written !== id) throw new BadGatewayException('保存响应记录不一致，请刷新核对');
    await this.verifySaved(key, id, fields);
    return {
      id,
      message:
        key === 'access'
          ? '已保存授权意向；未改变飞书或妙搭实际角色'
          : operation === 'edit'
            ? '修改已保存并回读，记录进入待核查'
            : '已保存并回读飞书记录',
    };
  }
}
