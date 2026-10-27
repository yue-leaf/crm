import type { CrmRecord } from '@shared/api.interface';
import { statusFields, statusBlocked } from '@shared/crm-status';
import { textValue } from '@shared/crm';
import { parseDraft, reject } from './crm-validation';
/** Resolve one user-facing state change into the existing audited workflows. */
export function statusInput(row: CrmRecord, input: Record<string, unknown>) {
  const blocked = statusBlocked(row);
  if (blocked) reject('项目状态', blocked);
  const { draft } = parseDraft(input, statusFields, {});
  const state = String(draft['项目状态']);
  if (state === '已取消') return { operation: 'confirm-end', input: {
    终局确认: '已取消', 结束日期: draft['结束日期'], 取消原因: draft['取消原因'],
    结果说明: draft['取消原因'], 操作原因: `取消项目：${String(draft['取消原因'] || '')}`,
  } };
  const reopening = ['已取消', '已完成'].includes(textValue(row.record['终局确认']));
  return { operation: reopening ? 'reopen' : 'progress', input: {
    工作状态: state, 当前进展: draft['当前进展'],
    ...(state === '暂停' ? { 暂停原因: draft['暂停原因'] } : {
      当前下一步行动: draft['当前下一步行动'], 下次跟进日期: draft['下次跟进日期'], 行动执行人: draft['行动执行人'],
    }),
    ...(state === '已签合同' ? { 签约日期: draft['签约日期'] } : {}),
    [reopening ? '操作原因' : '变更说明']: `更新项目状态为${state}：${String(draft['当前进展'] || '')}`,
  } };
}
export function validateSignedDate(fields: Record<string, unknown>) {
  if (fields['工作状态'] !== '已签合同') return;
  const signed = fields['签约日期'];
  if (typeof signed !== 'number' || !Number.isFinite(signed)) reject('签约日期', '签约时必填');
  if (Math.floor((signed + 28800000) / 86400000) > Math.floor((Date.now() + 28800000) / 86400000))
    reject('签约日期', '不能晚于今天');
}
