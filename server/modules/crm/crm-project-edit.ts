import type { CrmRecord } from '@shared/api.interface';
import type { Draft } from '@shared/crm';
import { textValue } from '@shared/crm';
import { currentProjectStatus, projectEditStatusFields } from '@shared/crm-status';
import { auditNote } from '@shared/crm-lifecycle';
import { prepareLifecycle } from './crm-lifecycle';
import type { RelatedSnapshot } from './crm-lifecycle';
import { validateSignedDate } from './crm-status';
import { reject } from './crm-validation';

/** Merge status and profile changes into the same checked Base write. */
export async function prepareProjectEditStatus(
  row: CrmRecord, draft: Draft, writes: Record<string, unknown>, actor: string,
  context: Parameters<typeof prepareLifecycle>[5],
): Promise<{ fields: Record<string, unknown>; related: RelatedSnapshot[] }> {
  const fields: Record<string, unknown> = { ...writes };
  delete fields['项目状态'];
  const changed: boolean = projectEditStatusFields.some(field => Object.hasOwn(writes, field.key));
  if (!changed) return { fields, related: [] };
  const state: string = String(draft['项目状态']);
  const before: string = currentProjectStatus(row);
  if (state === '进行中' && !textValue(draft['当前进展']).trim()) reject('当前进展', '进行中时请填写当前进展');
  if (state === '暂停' && !textValue(draft['暂停原因']).trim()) reject('暂停原因', '暂停时必填');
  if (state === '已签合同') validateSignedDate({
    工作状态: state, 签约日期: fields['签约日期'] ?? row.record['签约日期'],
  });
  for (const key of ['暂停原因', '签约日期', '结束日期', '取消原因']) {
    const applicable: boolean = key === '暂停原因' ? state === '暂停'
      : key === '签约日期' ? state === '已签合同' : state === '已取消';
    if (!applicable && Object.hasOwn(writes, key)) reject(key, '当前项目状态不适用此字段');
  }
  const reason: string = `编辑项目：${before} → ${state}`;
  const auditedRow: CrmRecord = { ...row, record: { ...row.record, 管理记录: fields['管理记录'] } };
  if (state === '已取消' || ['已取消', '已完成'].includes(textValue(row.record['终局确认']))) {
    const operation = state === '已取消' ? 'confirm-end' : 'reopen';
    const input: Record<string, unknown> = state === '已取消' ? {
      终局确认: state, 结束日期: draft['结束日期'], 取消原因: draft['取消原因'],
      结果说明: draft['取消原因'], 操作原因: reason,
    } : {
      工作状态: state, 当前进展: draft['当前进展'],
      ...(state === '暂停' ? { 暂停原因: draft['暂停原因'] } : {}),
      ...(state === '已签合同' ? { 签约日期: draft['签约日期'] } : {}),
      操作原因: reason,
    };
    const lifecycle = await prepareLifecycle('project', auditedRow, operation, input, actor,
      { ...context, allowUnplanned: true });
    return { fields: { ...fields, ...lifecycle.fields }, related: lifecycle.related };
  }
  fields['工作状态'] = state;
  if (state !== '暂停') fields['暂停原因'] = '';
  const note: string = [textValue(fields['管理记录']), auditNote(reason)].filter(Boolean).join('\n');
  if (note.length > 20000) reject('管理记录', '历史说明已达上限，请先整理留存');
  fields['管理记录'] = note;
  return { fields, related: [] };
}
