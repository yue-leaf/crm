import type { CrmRecord } from './api.interface';
import type { Draft } from './crm';
import { textValue } from './crm';
import { contactLifecycleProblem } from './crm-review';
import { contactInactiveAt } from './crm-contact-history';

/** Change only the requested filter; keep independent filters and scope. */
export function changeFilter(params: URLSearchParams, key: string, value: string): string {
  const next: URLSearchParams = new URLSearchParams(params);
  if (value === 'all') next.delete(key); else next.set(key, value);
  return next.toString();
}

export function changeFollowupListTarget(params: URLSearchParams, key: 'customerId' | 'projectId' | 'reset', value = ''): string {
  const next: URLSearchParams = new URLSearchParams(params);
  if (key === 'reset') { next.delete('customerId'); next.delete('projectId'); }
  else {
    if (key === 'customerId' && value !== (next.get(key) || '')) next.delete('projectId');
    if (value) next.set(key, value); else next.delete(key);
  }
  return next.toString();
}

export function followupTime(value: Draft[string] | undefined): number {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(value)) return NaN;
  const time: number = Date.parse(value + '+08:00');
  if (!Number.isFinite(time)) return NaN;
  const normalized: string = new Date(time + 8 * 3600000).toISOString().slice(0, value.length);
  return normalized === value ? time : NaN;
}

export function contactChoiceProblem(row: CrmRecord, occurred: number): string {
  const issue: string = contactLifecycleProblem(row.record);
  if (issue) return issue;
  if (!Number.isFinite(occurred)) return '请先填写跟进时间';
  if (contactInactiveAt(row.record, occurred)) return '该联系人在跟进发生时已停用';
  if (textValue(row.record['联系人状态']) === '有效') return '';
  const disabledAt: unknown = row.record['停用时间'];
  return typeof disabledAt === 'number' && occurred < disabledAt ? '' : '该联系人在跟进发生时已停用';
}
