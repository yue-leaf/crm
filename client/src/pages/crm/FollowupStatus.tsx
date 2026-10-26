import React, { useEffect, useState } from 'react';
import type { CrmRecord } from '@shared/api.interface';
import { followupStatus } from '@shared/crm-followup-status';

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
  return <span className={`tag ${status.tone}`} title="按北京时间的下次跟进日期计算">{status.label}</span>;
}
