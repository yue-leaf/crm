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
import { auditNote } from '@shared/crm-lifecycle';
import { CONTACT_INTERVAL_PREFIX } from '@shared/crm-contact-history';
import { projectEditStatusFields } from '@shared/crm-status';

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
    [{ key: '修改说明', type: 'long' }],
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
  const validationSpec = kind === 'customer' ? spec : kind === 'contact'
    ? [...forms.contact, ...spec.filter((field) => ['联系人状态', '停用原因'].includes(field.key))]
    : kind === 'project' ? [...forms.project, ...projectEditStatusFields] : forms[kind];
  const before = recordDraft(row.record, validationSpec);
  const merged = { ...before };
  for (const key of Object.keys(raw)) merged[key] = patch.draft[key];
  if (kind === 'contact' && merged['联系人状态'] === '有效') merged['停用原因'] = null;
  const checked = parseDraft(merged, kind === 'project'
    ? [...existingProjectFields(row.record), ...projectEditStatusFields] : validationSpec, enums);
  const changes = changedFields(before, checked.draft, spec);
  if (!Object.keys(changes).length) reject('编辑', '没有需要保存的修改');
  const writes: Record<string, unknown> = {};
  const now: number = Date.now();
  let contactEvent: string = '';
  if (kind === 'contact') {
    const status = checked.draft['联系人状态'];
    if (status === '停用' && !checked.draft['停用原因']) reject('停用原因', '停用联系人时必填');
    if (status === '有效') {
      if (textValue(row.record['联系人状态']) === '停用') {
        const disabledAt: unknown = row.record['停用时间'];
        if (typeof disabledAt !== 'number' || !Number.isSafeInteger(disabledAt) || disabledAt < 0 || disabledAt > now)
          reject('停用时间', '历史停用时间异常，请先在原表核对');
        contactEvent = CONTACT_INTERVAL_PREFIX + JSON.stringify({ version: 1, disabledAt, restoredAt: now });
      }
      writes['停用时间'] = null;
      writes['停用原因'] = '';
    } else if (textValue(row.record['联系人状态']) !== '停用') {
      writes['停用时间'] = now;
    } else if (typeof row.record['停用时间'] !== 'number' || !Number.isFinite(row.record['停用时间']) || row.record['停用时间'] > Date.now()) {
      reject('停用时间', '历史停用时间异常，请先在原表核对');
    }
  }
  for (const key of Object.keys(changes)) {
    const field = spec.find((f) => f.key === key)!;
    if (checked.fields[key] !== undefined) writes[key] = checked.fields[key];
    else if (field.type === 'text' || field.type === 'long') writes[key] = '';
    else if (field.type === 'person' || field.type === 'relation' || field.type === 'attachment')
      writes[key] = [];
    else if (!field.required && (field.type === 'date' || field.type === 'datetime'))
      writes[key] = null;
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
  const auditKey = kind === 'contact' ? '联系人管理记录' : '管理记录';
  const note = [
    textValue(row.record[auditKey]),
    ...(kind === 'contact' && Object.hasOwn(changes, '联系人状态') ? [
      `联系人状态：${textValue(row.record['联系人状态'])} → ${String(checked.draft['联系人状态'])}`,
      `停用信息：${String(writes['停用时间'] ?? row.record['停用时间'] ?? '')}\n${auditNote(textValue(writes['停用原因'] || row.record['停用原因'] || checked.draft['停用原因']))}`,
    ] : []),
    `资料修改 · ${new Date(now).toISOString()} · 操作人 ${actor}\n字段：${Object.keys(changes).join('、')}${reason ? `\n说明：\n${auditNote(String(reason))}` : ''}`,
    contactEvent,
  ]
    .filter(Boolean)
    .join('\n\n');
  if (note.length > 20000)
    reject('管理记录', '历史说明已达上限，请先由管理员整理留存');
  writes[auditKey] = note;
  return { draft: checked.draft, validationFields: checked.fields, writes };
}
