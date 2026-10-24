import type { CrmRecord, EntityKind } from './api.interface';
import type { Draft, FieldSpec } from './crm';
import { forms, linkIds, planFields, textValue } from './crm';

export const commerceKeys = ['预计金额', '币种', '金额含税口径'];

/** Existing paused/terminal records do not need an active plan. Creation still does. */
export function existingProjectFields(record: CrmRecord['record']): FieldSpec[] {
  const noPlan = textValue(record['工作状态']) === '暂停' ||
    ['已完成', '已取消'].includes(textValue(record['终局确认']));
  return forms.project.map((f) => noPlan && planFields.some((p) => p.key === f.key)
    ? { ...f, required: false } : f);
}

export function projectReviewProblem(record: CrmRecord['record'], now = Date.now()): string {
  const terminal = textValue(record['终局确认']);
  if (!['未确认', '已完成', '已取消'].includes(terminal)) return '终局状态异常，请先在原表核对';
  if (terminal === '未确认') {
    if (record['已归档'] === true) return '未结项项目不能归档，请先在原表核对';
    const work = textValue(record['工作状态']);
    if (!['待启动', '进行中', '暂停'].includes(work)) return '工作状态异常，请先更新项目进展';
    if (work === '暂停' && !textValue(record['暂停原因']).trim()) return '暂停原因缺失，请先更新项目进展';
    if (work === '进行中' && !textValue(record['当前进展']).trim()) return '当前进展缺失，请先更新项目进展';
  } else {
    const closed = record['结束日期'];
    const day = (ms: number) => Math.floor((ms + 8 * 3600000) / 86400000);
    if (typeof closed !== 'number' || !Number.isFinite(closed) || day(closed) > day(now))
      return '结束日期缺失或晚于今天，请先在原表核对';
    if (!textValue(record['结果说明']).trim()) return '结果说明缺失，请先在原表补齐';
    if (terminal === '已取消' && !textValue(record['取消原因']).trim()) return '取消原因缺失，请先在原表补齐';
  }
  if (record['已归档'] === true) {
    const archived = record['归档时间'];
    if (typeof archived !== 'number' || !Number.isFinite(archived) || archived > now)
      return '归档时间缺失或晚于当前时间，请先在原表核对';
    if (!textValue(record['归档原因']).trim()) return '归档原因缺失，请先在原表补齐';
  }
  return '';
}

export const progressFields: FieldSpec[] = [
  { key: '工作状态', type: 'select', required: true, options: ['待启动', '进行中', '暂停'] },
  { key: '当前进展', type: 'long', required: true },
  { key: '暂停原因', type: 'long' },
  ...planFields.map((f) => ({ ...f, required: false })),
  { key: '变更说明', type: 'long', required: true },
];

export function advancementBlocked(kind: EntityKind, row: CrmRecord): string {
  if (row.record['已归档'] === true) return '已归档，请先在飞书原表恢复';
  if (kind === 'project' && textValue(row.record['终局确认']) !== '未确认')
    return '项目已结束或终局状态异常，请先在飞书原表处理';
  return '';
}

export function followupTarget(row: CrmRecord): { kind: 'customer' | 'project'; id: string } | null {
  const direct = linkIds(row.record['直接客户']);
  const projects = linkIds(row.record['关联项目']);
  if (textValue(row.record['跟进归属']) === '客户直接跟进' && direct.length === 1 && !projects.length)
    return { kind: 'customer', id: direct[0] };
  if (textValue(row.record['跟进归属']) === '项目跟进' && projects.length === 1 && !direct.length)
    return { kind: 'project', id: projects[0] };
  return null;
}

export function relatedDraft(parentKind: 'customer' | 'project', parent: CrmRecord, kind: EntityKind): Draft {
  if (parentKind === 'customer' && (kind === 'contact' || kind === 'project'))
    return { 所属企业: [parent.id] };
  if (kind === 'followup') {
    const target: Draft = parentKind === 'customer'
      ? { 跟进归属: '客户直接跟进', 直接客户: [parent.id], 关联项目: [] }
      : { 跟进归属: '项目跟进', 关联项目: [parent.id], 直接客户: [] };
    // Historical entry must ask for the actual time, never default to "now".
    if (advancementBlocked(parentKind, parent)) {
      target['实际发生时间'] = null;
      target['后续安排'] = '无后续动作';
    }
    return target;
  }
  return {};
}
