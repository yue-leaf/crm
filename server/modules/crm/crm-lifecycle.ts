import { validateSignedDate } from './crm-status';
import type { CrmLifecycleOperation, CrmRecord, EntityKind } from '@shared/api.interface';
import { linkIds, textValue } from '@shared/crm';
import { EVENT_PREFIX, auditNote, lifecycleBlocked, lifecycleFields, lifecycleEvents, lifecycleTitles } from '@shared/crm-lifecycle';
import type { LifecycleEvent } from '@shared/crm-lifecycle';
import { recordReviewProblem } from '@shared/crm-review';
import { parseDraft, reject } from './crm-validation';

export interface RelatedSnapshot { kind: EntityKind; row: CrmRecord }
interface LifecycleContext {
  get: (kind: EntityKind, id: string) => Promise<CrmRecord>;
  people: (fields: Record<string, unknown>) => Promise<void>;
}
const day = (ms: number) => Math.floor((ms + 8 * 3600000) / 86400000);

export async function prepareLifecycle(
  kind: EntityKind, row: CrmRecord, operation: CrmLifecycleOperation,
  input: Record<string, unknown>, actor: string, context: LifecycleContext,
): Promise<{ fields: Record<string, unknown>; related: RelatedSnapshot[] }> {
  const blocked = lifecycleBlocked(kind, operation, row);
  if (blocked) reject('操作', blocked);
  const parsed = parseDraft(input, lifecycleFields(kind, operation), {});
  const fields = parsed.fields;
  const now = Date.now();
  const related: RelatedSnapshot[] = [];
  const load = async (key: EntityKind, id: string) => {
    const record = await context.get(key, id);
    related.push({ kind: key, row: record });
    return record;
  };
  if (operation === 'confirm-end' || operation === 'archive') {
    const issue = recordReviewProblem(kind, row.record);
    if (issue) reject('资料', issue);
  }
  if (kind === 'project' && (operation === 'confirm-end' || operation === 'reopen' ||
      (operation === 'restore' && textValue(row.record['工作状态']) === '已签合同' && textValue(row.record['终局确认']) === '未确认'))) {
    const parents = linkIds(row.record['所属企业']);
    if (parents.length !== 1) reject('所属企业', '项目必须关联唯一企业');
    const customer = await load('customer', parents[0]);
    if (customer.record['已归档'] === true) reject('所属企业', '请先取消客户归档，再操作项目');
    if (recordReviewProblem('customer', customer.record))
      reject('所属企业', '客户资料不完整，请先修正');
  }
  if (operation === 'confirm-end') {
    if (fields['终局确认'] !== '已取消') reject('终局确认', '请选择已取消');
    if (fields['终局确认'] === '已取消' && !fields['取消原因']) reject('取消原因', '取消项目时必填');
    const closed = fields['结束日期'] as number;
    if (day(closed) > day(now)) reject('结束日期', '不能晚于今天');
    const reopened = lifecycleEvents(row.record).filter(e => e.operation === 'reopen').at(-1);
    if (reopened && day(closed) < day(reopened.at)) reject('结束日期', '不能早于本轮重开日期');
    const followups = linkIds(row.record['项目跟进']);
    if (followups.length > 500) reject('历史记录', '跟进记录过多，请先分批核对结束日期');
    for (const id of followups) {
      const followup = await load('followup', id);
      const occurred = followup.record['实际发生时间'];
      if (textValue(followup.record['记录状态']) !== '已作废' &&
        (typeof occurred !== 'number' || !Number.isFinite(occurred) || day(occurred) > day(closed)))
        reject('结束日期', '结束日期不能早于已有跟进；异常跟进需先核对');
    }
    Object.assign(fields, { 结束建议: '', 建议说明: '', 取消原因: fields['取消原因'] || '' });
  } else if (operation === 'archive') {
    if (kind === 'customer') {
      const projects = linkIds(row.record['项目']);
      if (projects.length > 500) reject('关联项目', '项目过多，请先分批核对后归档');
      for (const id of projects) {
        const project = await load('project', id);
        if ((!['已完成', '已取消'].includes(textValue(project.record['终局确认'])) && !(textValue(project.record['工作状态']) === '已签合同' && project.record['已归档'] === true)) ||
          recordReviewProblem('project', project.record))
          reject('归档', '仍有未结束或信息不完整的项目');
      }
      if (textValue(row.record['归档阻塞项目数']) !== '0') reject('归档', '关联项目计算尚未就绪，请刷新核对');
    }
    Object.assign(fields, { 已归档: true, 归档时间: now, 归档原因: fields['操作原因'] });
  } else if (operation === 'restore') {
    const archivedAt = row.record['归档时间'];
    if (typeof archivedAt !== 'number' || !Number.isFinite(archivedAt) || archivedAt > now)
      reject('归档时间', '历史边界无效，请先在原表核对');
    Object.assign(fields, { 已归档: false, 归档原因: '' });
    if (kind === 'customer') {
      fields['行动执行人'] ||= [];
      await context.people(fields);
    }
  } else {
    const closed = row.record['结束日期'];
    if (typeof closed !== 'number' || !Number.isFinite(closed) || day(closed) > day(now))
      reject('结束日期', '历史结束边界无效，请先核对');
    if (!['待启动', '进行中', '暂停', '已签合同'].includes(String(fields['工作状态']))) reject('工作状态', '请选择有效项目状态');
    validateSignedDate(fields);
    if (fields['工作状态'] === '暂停') {
      if (!fields['暂停原因']) reject('暂停原因', '暂停时必填');
      fields['当前下一步行动'] = ''; fields['下次跟进日期'] = null;
    } else if (!fields['当前下一步行动'] || !fields['下次跟进日期']) reject('当前计划', '恢复项目时请确认下一步行动和日期');
    if (row.record['已归档'] === true) {
      const at = row.record['归档时间'];
      if (typeof at !== 'number' || !Number.isFinite(at) || at > now) reject('归档时间', '历史归档边界无效');
    }
    Object.assign(fields, { 终局确认: '未确认', 已归档: false, 归档原因: '', 结果说明: '', 取消原因: '',
      暂停原因: fields['工作状态'] === '暂停' ? fields['暂停原因'] : '', 结束建议: '', 建议说明: '', 最近重开原因: fields['操作原因'] });
    fields['行动执行人'] ||= [];
    await context.people(fields);
  }
  const event: LifecycleEvent = {
    version: 1, operation, at: now, actor, reason: String(fields['操作原因']),
    previous: {
      terminal: textValue(row.record['终局确认']), archived: row.record['已归档'] === true,
      ...(typeof row.record['结束日期'] === 'number' ? { endDate: row.record['结束日期'] } : {}),
      ...(typeof row.record['归档时间'] === 'number' ? { archiveTime: row.record['归档时间'] } : {}),
      action: textValue(row.record['当前下一步行动']),
      ...(typeof row.record['下次跟进日期'] === 'number' ? { dueDate: row.record['下次跟进日期'] } : {}),
      result: textValue(row.record['结果说明']), suggestion: textValue(row.record['结束建议']),
      suggestionNote: textValue(row.record['建议说明']), cancelReason: textValue(row.record['取消原因']),
      archiveReason: textValue(row.record['归档原因']),
    },
  };
  const note = [textValue(row.record['管理记录']),
    `${lifecycleTitles[operation]} · ${new Date(now).toISOString()} · ${actor}\n${auditNote(event.reason)}`,
    EVENT_PREFIX + JSON.stringify(event),
  ].filter(Boolean).join('\n');
  if (note.length > 20000) reject('管理记录', '历史记录已达上限，请先整理留存');
  fields['管理记录'] = note;
  delete fields['操作原因'];
  return { fields, related };
}
