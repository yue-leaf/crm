import type { CrmRecord } from './api.interface';
import { textValue } from './crm';

export const CONTACT_INTERVAL_PREFIX = 'CRM_CONTACT_INTERVAL_V1:';
export interface ContactInterval { version: 1; disabledAt: number; restoredAt: number }

function validInterval(value: unknown): value is ContactInterval {
  if (!value || typeof value !== 'object') return false;
  const interval = value as ContactInterval;
  return interval.version === 1 && Number.isSafeInteger(interval.disabledAt) &&
    Number.isSafeInteger(interval.restoredAt) && interval.disabledAt >= 0 &&
    interval.disabledAt <= interval.restoredAt && interval.restoredAt <= Date.now();
}

/** Read closed intervals, including the exact audit format emitted before structured history. */
export function contactIntervals(record: CrmRecord['record']): ContactInterval[] {
  const history: string = textValue(record['联系人管理记录']);
  const intervals: ContactInterval[] = [];
  for (const line of history.split(/\r?\n/)) {
    if (!line.startsWith(CONTACT_INTERVAL_PREFIX)) continue;
    try {
      const value: unknown = JSON.parse(line.slice(CONTACT_INTERVAL_PREFIX.length));
      if (validInterval(value)) intervals.push(value);
    } catch { /* Free text is never a lifecycle boundary. */ }
  }
  const legacy = /^联系人状态：停用 → 有效\r?\n\r?\n停用信息：(\d+) · [\s\S]*?\r?\n\r?\n资料修改 · (\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z) · 操作人 [^\r\n]+\r?\n字段：/gm;
  for (const match of history.matchAll(legacy)) {
    const interval: ContactInterval = { version: 1, disabledAt: Number(match[1]), restoredAt: Date.parse(match[2]) };
    if (validInterval(interval)) intervals.push(interval);
  }
  return intervals;
}

export function contactInactiveAt(record: CrmRecord['record'], occurred: number): boolean {
  return contactIntervals(record).some(interval => occurred >= interval.disabledAt && occurred < interval.restoredAt);
}
