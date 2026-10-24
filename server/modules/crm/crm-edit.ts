import type { EntityKind, CrmRecord } from '@shared/api.interface';
import { forms, textValue } from '@shared/crm';
import type { Draft } from '@shared/crm';
import {
  editFields,
  recordDraft,
  changedFields,
  editBlockedReason,
} from '@shared/crm-edit';
import { parseDraft, reject } from './crm-validation';
import { existingProjectFields } from '@shared/crm-workflow';

export function prepareEdit(
  kind: EntityKind,
  row: CrmRecord,
  input: Record<string, unknown>,
  enums: Record<string, string[]>,
  actor: string,
): {
  draft: Draft;
  validationFields: Record<string, unknown>;
  writes: Record<string, unknown>;
} {
  const blocked = editBlockedReason(kind, row);
  if (blocked) reject('编辑', blocked);
  if (Object.keys(input).some((k) => !['changes', 'reason'].includes(k)))
    reject('编辑', '请求包含不可修改的字段');
  const reason = parseDraft(
    { 修改说明: input.reason },
    [{ key: '修改说明', type: 'long', required: true }],
    {},
  ).draft['修改说明'];
  if (String(reason).length > 1000) reject('修改说明', '最多1000字');
  const spec = editFields(kind);
  const patch = parseDraft(
    input.changes,
    spec.map((f) => ({ ...f, required: false })),
    enums,
  );
  const raw = input.changes as Record<string, unknown>;
  const before = recordDraft(row.record, forms[kind]);
  const merged = { ...before };
  for (const key of Object.keys(raw)) merged[key] = patch.draft[key];
  const checked = parseDraft(merged, kind === 'project' ? existingProjectFields(row.record) : forms[kind], enums);
  const changes = changedFields(before, checked.draft, spec);
  if (!Object.keys(changes).length) reject('编辑', '没有需要保存的修改');
  const writes: Record<string, unknown> = {};
  for (const key of Object.keys(changes)) {
    const field = spec.find((f) => f.key === key)!;
    if (checked.fields[key] !== undefined) writes[key] = checked.fields[key];
    else if (field.type === 'text' || field.type === 'long') writes[key] = '';
    else if (field.type === 'person' || field.type === 'relation')
      writes[key] = [];
    else
      reject(
        key,
        '当前连接不支持清空此类型，请在飞书原表处理；本次修改尚未保存',
      );
  }
  // Preserve full timestamp precision for untouched dates during relationship validation.
  for (const f of forms[kind]) {
    if (
      (f.type === 'date' || f.type === 'datetime') &&
      !(f.key in changes) &&
      typeof row.record[f.key] === 'number'
    )
      checked.fields[f.key] = row.record[f.key];
  }
  const note = [
    textValue(row.record['核查说明']),
    `资料修改 · ${new Date().toISOString()} · 操作人 ${actor}\n字段：${Object.keys(changes).join('、')}\n说明：${String(reason)}`,
  ]
    .filter(Boolean)
    .join('\n\n');
  if (note.length > 20000)
    reject('核查说明', '历史说明已达上限，请先由管理员整理留存');
  writes['核查标记'] = '待核查';
  writes['核查说明'] = note;
  return { draft: checked.draft, validationFields: checked.fields, writes };
}
