import React, { useEffect, useState } from 'react';
import type { CrmRecord } from '@shared/api.interface';
import { textValue } from '@shared/crm';
import { displayDate } from '@shared/crm-presentation';
import { api } from '@/api/crm';
import { RecordPicker } from './RecordPicker';
import { Cell } from './Fields';
import { ActionButton as Button } from './ActionButton';

export function PreviousFollowup({ customerId, projectId, value, disabled, fixed, onChange }: {
  customerId: string; projectId: string; value: string[]; disabled: boolean; fixed: boolean; onChange: (ids: string[]) => void;
}) {
  const [open, setOpen] = useState(false), [query, setQuery] = useState('');
  const [items, setItems] = useState<CrmRecord[]>([]), [selected, setSelected] = useState<CrmRecord | null>(null);
  const [loading, setLoading] = useState(false), [error, setError] = useState(''), [retry, setRetry] = useState(0);
  const selectedId = value[0] || '';
  useEffect(() => {
    let canceled = false;
    setSelected(null); setError('');
    if (selectedId) void api.get('followup', selectedId).then(row => { if (!canceled) setSelected(row); })
      .catch(() => { if (!canceled) setError('上次跟进读取失败，请重试'); });
    return () => { canceled = true; };
  }, [selectedId, retry]);
  useEffect(() => {
    let canceled = false;
    setItems([]);
    if (!open || fixed) return;
    setLoading(true); setError('');
    void api.pendingFollowups(customerId, projectId).then(page => { if (!canceled) setItems(page.records); })
      .catch(() => { if (!canceled) setError('待跟进记录读取失败，请重试'); })
      .finally(() => { if (!canceled) setLoading(false); });
    return () => { canceled = true; };
  }, [open, fixed, customerId, projectId, retry]);
  const option = (row: CrmRecord) => ({ id: row.id, name: textValue(row.record['建议下一步行动']) || textValue(row.record['内容 / 推进结论']),
    description: `上次 ${displayDate('实际发生时间', row.record['实际发生时间'])} · 建议 ${displayDate('建议日期', row.record['建议日期'])}` });
  return <div className="field wide">
    <label>接着哪次跟进</label>
    <RecordPicker label="上次跟进" value={value} selected={selected ? [option(selected)] : []}
      options={items.filter(row => !query || `${textValue(row.record['建议下一步行动'])} ${textValue(row.record['内容 / 推进结论'])}`.includes(query)).map(option)}
      open={open} onOpenChange={setOpen} disabled={disabled || fixed || (!customerId && !projectId)}
      query={query} onQueryChange={setQuery} onChange={onChange} loading={loading} loadingMore={false} hasMore={false}
      error={error} onRetry={() => setRetry(n => n + 1)} onLoadMore={() => undefined} />
    {selected && <div className="panel-note followup-previous"><p>{textValue(selected.record['内容 / 推进结论'])}</p>
      <p>下一步：{textValue(selected.record['建议下一步行动'])}</p>
      <Cell name="建议处理人" value={selected.record['建议处理人']} />
      <Cell name="建议日期" value={selected.record['建议日期']} />
    </div>}
    {selectedId && !fixed && <Button variant="ghost" size="sm" type="button" disabled={disabled} onClick={() => onChange([])}>取消关联，独立记录</Button>}
  </div>;
}
