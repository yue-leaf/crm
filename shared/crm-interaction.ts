import type { Draft, FieldSpec } from './crm';
import type { CrmPage } from './api.interface';
import { commerceKeys } from './crm-workflow';

/** Ignore equivalent selections before clearing their dependent fields. */
export function changeDraft(previous: Draft, key: string, value: Draft[string], initial: Draft, editing: boolean): Draft {
  const comparable = (v: Draft[string] | undefined) => Array.isArray(v) ? [...v].sort() : v;
  if (JSON.stringify(comparable(previous[key])) === JSON.stringify(comparable(value))) return previous;
  const next = { ...previous, [key]: value };
  if (key === '终局确认' && value === '已完成') next['取消原因'] = '';
  if (key === '跟进归属') {
    next['直接客户'] = [];
    next['关联项目'] = [];
    next['客户联系人'] = [];
  }
  if (key === '直接客户' || key === '关联项目') next['客户联系人'] = [];
  if (key === '记录类型') { next['客户联系人'] = []; next['沟通 / 推进方式'] = ''; }
  if (key === '后续安排')
    for (const name of ['建议下一步行动', '建议日期', '建议处理人', '无后续动作结论']) next[name] = null;
  if (key === '项目类型' && value !== '销售机会')
    for (const name of commerceKeys) next[name] = editing ? initial[name] ?? null : null;
  return next;
}

export function requiredField(field: FieldSpec, kind: string, operation: string, draft: Draft): FieldSpec {
  let required = Boolean(field.required);
  if (operation === 'confirm-end' && field.key === '取消原因') required = draft['终局确认'] === '已取消';
  if (operation === 'progress') {
    if (field.key === '暂停原因') required = draft['工作状态'] === '暂停';
    if (['当前下一步行动', '下次跟进日期'].includes(field.key)) required = draft['工作状态'] !== '暂停';
  }
  if (kind === 'followup') {
    if (field.key === '直接客户') required = draft['跟进归属'] === '客户直接跟进';
    if (field.key === '关联项目') required = draft['跟进归属'] === '项目跟进';
    if (['客户联系人', '沟通 / 推进方式'].includes(field.key)) required = draft['记录类型'] === '外部沟通';
    if (field.key === '建议下一步行动') required = draft['后续安排'] === '有下一步行动';
    if (field.key === '无后续动作结论') required = draft['后续安排'] === '无后续动作';
  }
  if (kind === 'project' && draft['项目类型'] === '销售机会' && draft['预计金额'] != null && draft['预计金额'] !== '' &&
    ['币种', '金额含税口径'].includes(field.key)) required = true;
  return { ...field, required };
}

export function missingFields(fields: FieldSpec[], draft: Draft): Record<string, string> {
  const errors = Object.fromEntries(fields.filter((field) => {
    const value = draft[field.key];
    return field.required && (value == null || (typeof value === 'string' && !value.trim()) ||
      (Array.isArray(value) && !value.length));
  }).map((field) => [field.key, `请${['person', 'relation', 'select', 'date', 'datetime'].includes(field.type) ? '选择' : '填写'}${field.label || field.key}`]));
  for (const field of fields) {
    const value = draft[field.key];
    if (field.type === 'datetime' && typeof value === 'string' && value && !/T\d{2}:\d{2}(?::\d{2})?$/.test(value))
      errors[field.key] = `请完整选择${field.label || field.key}的日期和时间`;
  }
  if (['电话', '邮箱'].every((key) => fields.some((field) => field.key === key)) &&
    !String(draft['电话'] || '').trim() && !String(draft['邮箱'] || '').trim()) {
    errors['电话'] = '电话或邮箱至少填写一项';
    errors['邮箱'] = '电话或邮箱至少填写一项';
  }
  return errors;
}

export function appendPage(previous: CrmPage | null, next: CrmPage): CrmPage {
  return { ...next, records: [...new Map([...(previous?.records || []), ...next.records]
    .map((row) => [row.id, row])).values()] };
}
