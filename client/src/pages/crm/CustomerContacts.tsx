import React, { useEffect, useRef, useState } from 'react';
import type { CrmPage, CrmRecord } from '@shared/api.interface';
import { api } from '@/api/crm';
import { textValue } from '@shared/crm';
import { editBlockedReason } from '@shared/crm-edit';
import { appendPage } from '@shared/crm-interaction';
import { Eye, Pencil, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Cell, message } from './Fields';

export const CustomerContacts: React.FC<{
  customerId: string;
  createBlocked: boolean;
  busy: boolean;
  onCreate?: () => void;
  onView: (row: CrmRecord) => void;
  onEdit: (row: CrmRecord) => void;
}> = ({ customerId, createBlocked, busy, onCreate, onView, onEdit }) => {
  const [page, setPage] = useState<CrmPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const alive = useRef(false);
  const paging = useRef(false);
  useEffect(() => {
    let canceled = false;
    alive.current = true;
    setLoading(true); setError(''); setPage(null);
    void api.customerContacts(customerId).then(next => { if (!canceled) setPage(next); })
      .catch(e => { if (!canceled) setError(message(e)); })
      .finally(() => { if (!canceled) setLoading(false); });
    return () => { canceled = true; alive.current = false; };
  }, [customerId, retry]);
  const more = async () => {
    if (!page?.pageToken || loading || paging.current) return;
    paging.current = true; setLoading(true); setError('');
    try {
      const next = await api.customerContacts(customerId, { cursor: page.pageToken });
      if (alive.current) setPage(previous => appendPage(previous, next));
    } catch (e) { if (alive.current) setError(message(e)); }
    finally { paging.current = false; if (alive.current) setLoading(false); }
  };
  return <section className="detail-section customer-contacts" aria-label="客户联系人">
    <div className="customer-contacts-heading"><h3>客户联系人{page ? ` · ${page.hasMore ? `已加载 ${page.records.length}` : page.records.length} 人` : ''}</h3>
      {onCreate && <Button type="button" variant="outline" size="sm" disabled={createBlocked || busy} title={createBlocked ? '客户核查通过且未归档后可新建联系人' : undefined} onClick={onCreate}><Plus size={14} />新建联系人</Button>}
    </div>
    {page?.records.map(row => <article key={row.id} className="customer-contact-row">
      <div className="customer-contact-info"><button type="button" className="record-title" disabled={busy} onClick={() => onView(row)}>{textValue(row.record['姓名']) || '未命名联系人'}</button>
        <span>{textValue(row.record['职务']) || '未填写职务'}</span>
        <div className="customer-contact-channels"><Cell name="电话" value={row.record['电话']} /><Cell name="邮箱" value={row.record['邮箱']} /></div>
        <div><Cell name="联系人状态" value={row.record['联系人状态']} /> <Cell name="核查标记" value={row.record['核查标记']} /></div>
      </div>
      <div className="record-actions"><Button variant="ghost" size="sm" disabled={busy} onClick={() => onView(row)}><Eye size={14} />查看</Button>
        <Button variant="ghost" size="sm" disabled={busy || !!editBlockedReason('contact', row)} title={editBlockedReason('contact', row) || undefined} onClick={() => onEdit(row)}><Pencil size={14} />编辑</Button></div>
    </article>)}
    {!loading && !error && page?.records.length === 0 && <p className="panel-note">{onCreate ? '该客户暂无联系人，可点击“新建联系人”，所属客户会自动带入。' : '所属客户暂无联系人，可返回客户全览新建。'}</p>}
    {loading && <p role="status" className="panel-note">正在读取联系人…</p>}
    {error && <div role="alert" className="panel-note">{error} <Button variant="ghost" size="sm" onClick={() => page ? void more() : setRetry(n => n + 1)}>重试</Button></div>}
    {page?.hasMore && <Button variant="outline" size="sm" disabled={loading} onClick={() => void more()}>加载更多联系人</Button>}
  </section>;
};
