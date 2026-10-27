import React, { useCallback } from 'react';
import type { CrmPage, CrmRecord } from '@shared/api.interface';
import { api } from '@/api/crm';
import { textValue } from '@shared/crm';
import { editBlockedReason } from '@shared/crm-edit';
import { Eye, Mail, Pencil, Phone, Plus } from 'lucide-react';
import { ActionButton as Button } from './ActionButton';
import { Cell } from './Fields';
import { useRelatedPage } from './useRelatedPage';

export const CustomerContacts: React.FC<{
  customerId: string;
  createBlocked: boolean;
  busy: boolean;
  onCreate?: () => void;
  onView: (row: CrmRecord) => void | Promise<void>;
  onEdit: (row: CrmRecord) => void | Promise<void>;
}> = ({ customerId, createBlocked, busy, onCreate, onView, onEdit }) => {
  const load = useCallback((cursor?: string): Promise<CrmPage> => api.customerContacts(customerId, { cursor }), [customerId]);
  const { page, loading, error, more, retry } = useRelatedPage(load, JSON.stringify(['contacts', customerId]));
  return <section className="detail-section customer-contacts" aria-label="客户联系人" data-page-loading={loading}>
    <div className="customer-contacts-heading"><h3>客户联系人{page && <span className="contact-count">{page.hasMore ? '已加载 ' : ''}{page.records.length} 人</span>}</h3>
      {onCreate && <Button type="button" variant="outline" size="sm" disabled={createBlocked || busy} title={createBlocked ? '客户归档后不能新建联系人' : undefined} onClick={onCreate}><Plus size={14} />新建联系人</Button>}
    </div>
    <div className="customer-contact-list">{page?.records.map((row: CrmRecord) => {
      const phone: string = textValue(row.record['电话']).trim();
      const email: string = textValue(row.record['邮箱']).trim();
      const name: string = textValue(row.record['姓名']) || '未命名联系人';
      const editReason: string = editBlockedReason('contact', row);
      return <article key={row.id} className="contact-card">
        <div className="contact-card-identity">
          <div className="contact-card-heading"><button type="button" className="contact-card-name" disabled={busy} onClick={() => onView(row)}>{name}</button>
            <Cell name="联系人状态" value={row.record['联系人状态']} /></div>
          {textValue(row.record['职务']) && <p className="muted">{textValue(row.record['职务'])}</p>}
        </div>
        <dl className="contact-card-channels">
          {phone && <div><dt><Phone size={13} aria-hidden="true" /><span>电话</span></dt><dd><a href={`tel:${encodeURIComponent(phone)}`}>{phone}</a></dd></div>}
          {email && <div><dt><Mail size={13} aria-hidden="true" /><span>邮箱</span></dt><dd><a href={`mailto:${encodeURIComponent(email)}`}>{email}</a></dd></div>}
          {!phone && !email && <div className="contact-card-empty"><dt className="sr-only">联系方式</dt><dd>未填写联系方式</dd></div>}
        </dl>
        <div className="contact-card-actions"><Button type="button" variant="ghost" size="sm" disabled={busy} aria-label={`查看${name}`} onClick={() => onView(row)}><Eye size={14} aria-hidden="true" />查看</Button>
          <Button type="button" variant="ghost" size="sm" disabled={busy || !!editReason} title={editReason || undefined} aria-label={`编辑${name}`} onClick={() => onEdit(row)}><Pencil size={14} aria-hidden="true" />编辑</Button></div>
      </article>;
    })}</div>
    {!loading && !error && page?.records.length === 0 && <p className="panel-note">{onCreate ? '该客户暂无联系人，可点击“新建联系人”，所属客户会自动带入。' : '所属客户暂无联系人，可返回客户全览新建。'}</p>}
    {loading && <p role="status" className="panel-note">正在读取联系人…</p>}
    {error && <div role="alert" className="panel-note">{error} <Button variant="ghost" size="sm" disabled={loading} onClick={retry}>重试</Button></div>}
    {page?.hasMore && <Button variant="outline" size="sm" disabled={loading} onClick={() => void more()}>加载更多联系人</Button>}
  </section>;
};
