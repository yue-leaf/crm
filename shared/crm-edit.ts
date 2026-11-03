import type { EntityKind, CrmRecord } from './api.interface';
import { forms, textValue, linkIds } from './crm';
import type { Draft, FieldSpec } from './crm';
import { attachmentDraft } from './crm-attachments';

// Parent migration and project lifecycle changes use their dedicated workflows.
const locked = new Set([
  '所属企业',
  '跟进归属',
  '直接客户',
  '关联项目',
  '当前下一步行动',
  '下次跟进日期',
  '跟进主题',
]);
export function editFields(kind: EntityKind): FieldSpec[] {
  if (kind === 'access') return [];
  const fields: FieldSpec[] = forms[kind].filter((f) => !locked.has(f.key) &&
    !(kind === 'project' && f.key === '目标完成日期'));
  if (kind === 'contact') {
    fields.push(
      { key: '联系人状态', type: 'select', required: true, options: ['有效', '停用'] },
      { key: '停用原因', type: 'long' },
    );
  }
  return fields;
}
export function recordDraft(
  record: CrmRecord['record'],
  spec: FieldSpec[],
): Draft {
  const out: Draft = {};
  for (const f of spec) {
    const value = record[f.key];
    if (value == null) out[f.key] = null;
    else if (f.type === 'person')
      out[f.key] = Array.isArray(value) ? value.map(String) : null;
    else if (f.type === 'relation') out[f.key] = linkIds(value);
    else if (f.type === 'attachment') out[f.key] = attachmentDraft(value);
    else if (f.type === 'number')
      out[f.key] = typeof value === 'number' ? value : null;
    else if (f.type === 'date' || f.type === 'datetime') {
      out[f.key] =
        typeof value === 'number' && Number.isFinite(value)
          ? new Date(value + 8 * 3600000)
              .toISOString()
              .slice(0, f.type === 'date' ? 10 : 19)
          : null;
    } else out[f.key] = textValue(value);
  }
  return out;
}
function normalize(value: Draft[string] | undefined): Draft[string] {
  if (value == null || value === '' || (Array.isArray(value) && !value.length))
    return null;
  if (Array.isArray(value)) return [...value].sort();
  return typeof value === 'string' ? value.trim() : value;
}
export function changedFields(
  before: Draft,
  after: Draft,
  spec: FieldSpec[],
): Draft {
  return Object.fromEntries(
    spec
      .filter(
        (f) =>
          JSON.stringify(normalize(before[f.key])) !==
          JSON.stringify(normalize(after[f.key])),
      )
      .map((f) => [f.key, after[f.key] ?? null]),
  );
}
export function editBlockedReason(kind: EntityKind, row: CrmRecord): string {
  if (
    kind === 'project' &&
    textValue(row.record['终局确认']) !== '未确认'
  )
    return '项目已结束或终局状态异常，请先重开或核对状态';
  if (kind === 'project' && !['待启动', '进行中', '暂停', '已签合同'].includes(textValue(row.record['工作状态'])))
    return '项目工作状态异常，请先更新项目进展';
  if (kind === 'contact' && !['有效', '停用'].includes(textValue(row.record['联系人状态'])))
    return '联系人状态异常，请先在飞书核对';
  if (kind === 'followup' && textValue(row.record['记录状态']) !== '正常')
    return '跟进记录已作废或状态异常，请在飞书核对';
  return '';
}
