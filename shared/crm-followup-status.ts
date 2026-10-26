import type { CrmRecord, FollowupFilter, FollowupStatus } from './api.interface';
import { textValue } from './crm';

export const followupFilterLabels: Record<FollowupFilter, string> = {
  all: '全部跟进状态', waiting: '等待中', tomorrow: '明日跟进', today: '今日跟进',
  overdue: '已逾期', unplanned: '未安排', none: '无需跟进',
};
export const shanghaiDay = (time: number): number => Math.floor((time + 8 * 3600000) / 86400000);
export function validFollowupFilter(value: string): value is FollowupFilter {
  return Object.prototype.hasOwnProperty.call(followupFilterLabels, value);
}
export function followupStatus(record: CrmRecord['record'], now = Date.now()): {
  key: FollowupStatus; label: string; tone: string; priority: number; due: number;
} {
  if (record['已归档'] === true || ['已完成', '已取消'].includes(textValue(record['终局确认'])))
    return { key: 'none', label: '无需跟进', tone: 'neutral', priority: 5, due: Infinity };
  const due = record['下次跟进日期'];
  if (typeof due !== 'number' || !Number.isFinite(due) || !Number.isFinite(new Date(due).getTime()))
    return { key: 'unplanned', label: '未安排', tone: 'neutral', priority: 3, due: Infinity };
  const distance = shanghaiDay(due) - shanghaiDay(now);
  if (distance < 0) return { key: 'overdue', label: `已逾期 ${-distance} 天`, tone: 'deep-red', priority: 0, due };
  if (distance === 0) return { key: 'today', label: '今日跟进', tone: 'red', priority: 1, due };
  if (distance === 1) return { key: 'tomorrow', label: '明日跟进', tone: 'amber', priority: 2, due };
  return { key: 'waiting', label: '等待中', tone: 'neutral', priority: 4, due };
}
export function sortFollowups(rows: CrmRecord[], now: number): CrmRecord[] {
  return [...rows].sort((a, b) => {
    const first = followupStatus(a.record, now), second = followupStatus(b.record, now);
    return first.priority - second.priority || (first.due === second.due ? 0 : first.due - second.due)
      || a.id.localeCompare(b.id);
  });
}
