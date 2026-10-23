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

@Injectable()
export class CrmService {
  private readonly logger = new Logger(CrmService.name);
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
    } catch (error: unknown) {
      this.logger.warn(
        `Base ${kind} ${action} failed: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
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
    if (cursor && cursor.length > 2048)
      throw new BadRequestException('分页标记无效');
    if (search && search.length > 200)
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
    if (!/^rec[A-Za-z0-9]+$/.test(id))
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
          textValue(r.record['目录状态']) === '已激活' &&
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
  ): Promise<void> {
    const arr = (k: string): string[] =>
      Array.isArray(d[k]) ? (d[k] as string[]) : [];
    if (key === 'contact' || key === 'project')
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
    if (project.length) {
      const p = await this.get('project', project[0]);
      this.assertActive(p);
      if (textValue(p.record['核查标记']) !== '正常')
        reject('关联项目', '项目需先核查通过');
      customerId = linkIds(p.record['所属企业'])[0];
    }
    if (!customerId) reject('跟进归属', '无法确定所属企业');
    await this.activeCustomer(customerId);
    const occurred = fields['实际发生时间'] as number;
    if (occurred > Date.now()) reject('实际发生时间', '不能晚于当前时间');
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
        if (!linkIds(c.record['所属企业']).includes(customerId))
          reject('客户联系人', '联系人不属于当前企业');
        if (textValue(c.record['核查标记']) !== '正常')
          reject('客户联系人', '联系人需先核查通过');
        if (
          textValue(c.record['联系人状态']) !== '有效' &&
          !(
            typeof c.record['停用时间'] === 'number' &&
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
  private validateFacts(key: EntityKind, draft: Draft): void {
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
        ['预计金额', '币种', '金额含税口径'].some((k) => draft[k] != null)
      )
        reject('项目类型', '非销售项目不填写商务金额');
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
    await this.get(key, id);
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
  async update(
    kind: string,
    id: string,
    operation: string,
    body: unknown,
    actor: string,
  ): Promise<WriteResult> {
    const key = this.kind(kind);
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
    if (operation === 'plan' && (key === 'customer' || key === 'project')) {
      this.assertActive(row);
      const parsed = parseDraft(input, planFields, this.enums(key));
      fields = parsed.fields;
      if (!fields['行动执行人']) fields['行动执行人'] = [];
      await this.people(fields, planFields);
    } else if (operation === 'suggest-end' && key === 'project') {
      this.assertActive(row);
      fields = parseDraft(input, endFields, this.enums(key)).fields;
    } else if (operation === 'access' && key === 'access') {
      fields = parseDraft(input, forms.access, this.enums(key)).fields;
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
      const original: Draft = {};
      for (const f of forms[key]) {
        const v = row.record[f.key];
        if (v == null) continue;
        if (f.type === 'person')
          original[f.key] = Array.isArray(v) ? v.map(String) : null;
        else if (f.type === 'relation') original[f.key] = linkIds(v);
        else if (f.type === 'date' || f.type === 'datetime') {
          if (typeof v === 'number')
            original[f.key] = new Date(v + 8 * 3600000)
              .toISOString()
              .slice(0, f.type === 'date' ? 10 : 16);
        } else if (f.type === 'number')
          original[f.key] = typeof v === 'number' ? v : null;
        else original[f.key] = textValue(v);
      }
      const checked = parseDraft(original, forms[key], this.enums(key));
      this.validateFacts(key, checked.draft);
      await this.people(checked.fields, forms[key]);
      await this.relationChecks(key, checked.draft, checked.fields);
      fields['核查标记'] = '正常';
      fields['核查说明'] =
        `${textValue(fields['核查说明'])}\n核查人 ${actor} · ${new Date().toISOString()}`;
    } else reject('操作', '不支持的操作');
    this.writtenId(
      await this.call(key, 'batchUpdateRecords', {
        records: [{ id, record: fields }],
      }),
    );
    await this.get(key, id);
    return {
      id,
      message:
        key === 'access'
          ? '已保存授权意向；未改变飞书或妙搭实际角色'
          : '已保存并回读飞书记录',
    };
  }
}
