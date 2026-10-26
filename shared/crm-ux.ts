import type { CrmRecord } from './api.interface';
import type { Draft } from './crm';
import { textValue } from './crm';
import { contactLifecycleProblem } from './crm-review';

/** Change only the requested filter; keep independent filters and scope. */
export function changeFilter(params: URLSearchParams, key: string, value: string): string {
  const next: URLSearchParams = new URLSearchParams(params);
  if (value === 'all') next.delete(key); else next.set(key, value);
  return next.toString();
}

export function followupTime(value: Draft[string] | undefined): number {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(value)) return NaN;
  return Date.parse(value + '+08:00');
}

export function contactChoiceProblem(row: CrmRecord, occurred: number): string {
  const issue: string = contactLifecycleProblem(row.record);
  if (issue) return issue;
  if (!Number.isFinite(occurred)) return '请先填写跟进时间';
  if (textValue(row.record['联系人状态']) === '有效') return '';
  const disabledAt: unknown = row.record['停用时间'];
  return typeof disabledAt === 'number' && occurred < disabledAt ? '' : '该联系人在跟进发生时已停用';
}

/** Keep the existing audited API contract without asking users to repeat their explanation. */
export function actionDraft(operation: string, draft: Draft): Draft {
  if (operation === 'progress') return { ...draft, 变更说明: `更新进展：${String(draft['当前进展'] || '').slice(0, 1000)}` };
  if (operation === 'confirm-end') {
    const result: Draft[string] = draft['终局确认'] === '已取消' ? draft['取消原因'] : draft['结果说明'];
    return { ...draft, 结果说明: result || '', 操作原因: `${String(draft['终局确认'])}：${String(result || '').slice(0, 1000)}` };
  }
  return draft;
}

export function suggestedPlan(record: CrmRecord['record']): Draft | null {
  const action: string = textValue(record['建议下一步行动']).trim();
  if (!action || textValue(record['记录状态']) !== '正常' || textValue(record['后续安排']) !== '有下一步行动') return null;
  const date: unknown = record['建议日期'];
  return {
    当前下一步行动: action,
    行动执行人: Array.isArray(record['建议处理人']) ? record['建议处理人'].map(String) : [],
    下次跟进日期: typeof date === 'number' && Number.isFinite(date)
      ? new Date(date + 8 * 3600000).toISOString().slice(0, 10) : '',
  };
}
