import { useEffect, useState } from 'react';
import type { CrmRecord } from '@shared/api.interface';
import { followupStatus } from '@shared/crm-followup-status';
import { displayDate } from '@shared/crm-presentation';

export function FollowupDueDate({ row, now }: { row: CrmRecord; now: number }) {
  const date = displayDate('建议日期', row.record['建议日期']) || '—';
  const status = followupStatus({ 下次跟进日期: row.record['建议日期'] }, now);
  const tone = row.followup?.state === '待跟进'
    ? ({ overdue: 'red', today: 'followup-today', tomorrow: 'blue' } as Record<string, string>)[status.key]
    : undefined;
  const label = tone ? `${status.label} · ${date}` : date;
  return <span className={tone ? `tag ${tone}` : undefined} title={label} aria-label={label}>{date}</span>;
}

export function useFollowupClock(): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const update = () => setNow(Date.now());
    const timer = window.setInterval(update, 30000);
    window.addEventListener('focus', update);
    document.addEventListener('visibilitychange', update);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', update);
      document.removeEventListener('visibilitychange', update);
    };
  }, []);
  return now;
}
export function FollowupBadge({ record }: { record: CrmRecord['record'] }) {
  const now = useFollowupClock();
  const status = followupStatus(record, now);
  return <span className={`tag ${status.tone}`}>{status.label}</span>;
}
