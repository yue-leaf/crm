import React, { useCallback } from 'react';
import { FolderKanban, Plus } from 'lucide-react';
import { api } from '@/api/crm';
import { ActionButton as Button } from './ActionButton';
import type { CrmPage, CrmRecord } from '@shared/api.interface';
import { textValue } from '@shared/crm';
import { useRelatedPage } from './useRelatedPage';
import { FollowupBadge } from './FollowupStatus';
import { Cell } from './Fields';

export function CustomerProjects({ customerId, busy, createBlocked, onCreate, onView }: {
  customerId: string; busy: boolean; createBlocked: boolean; onCreate: () => void; onView: (row: CrmRecord) => void | Promise<void>;
}) {
  const load = useCallback((cursor?: string): Promise<CrmPage> => api.customerProjects(customerId, { cursor }), [customerId]);
  const { page, loading, error, more, retry } = useRelatedPage(load, JSON.stringify(['projects', customerId]));
  return <section className="related-panel" aria-label="客户关联项目" data-page-loading={loading}>
    <div className="related-panel-heading"><div><h3>关联项目{page && <span>{page.total} 个</span>}</h3><p>集中查看在办、已结束及已归档的全部项目。</p></div>
      <Button size="sm" variant="outline" disabled={busy || createBlocked} onClick={onCreate}><Plus size={14} />新建项目</Button></div>
    <div className="customer-projects">{page?.records.map((row: CrmRecord) => <article className="customer-project-card" key={row.id}>
      <div className="project-card-title"><FolderKanban size={18} /><button className="record-title" disabled={busy}
        onClick={() => onView(row)}>{textValue(row.record['项目名称']) || '未命名项目'}</button></div>
      <div className="project-card-status"><Cell name="工作状态" value={textValue(row.record['终局确认']) === '未确认' ? row.record['工作状态'] : row.record['终局确认']} />
        <FollowupBadge record={row.record} />{row.record['已归档'] === true && <span className="tag neutral">已归档</span>}</div>
      <p>{textValue(row.record['当前进展']) || textValue(row.record['目标 / 需求摘要']) || '暂无进展说明'}</p>
      <div className="project-card-footer"><Cell name="项目负责人" value={row.record['项目负责人']} /><Button variant="ghost" size="sm" disabled={busy} onClick={() => onView(row)}>查看项目 →</Button></div>
    </article>)}</div>
    {loading && <p className="related-empty" role="status">正在读取关联项目…</p>}
    {!loading && !error && page?.records.length === 0 && <p className="related-empty">该客户暂无关联项目。</p>}
    {error && <div className="error-banner" role="alert">{error}<Button variant="ghost" size="sm" disabled={loading} onClick={retry}>重新加载</Button></div>}
    {page?.hasMore && <div className="related-pagination"><span>已加载 {page.records.length} / {page.total} 个</span><Button size="sm" variant="outline" disabled={loading} onClick={() => void more()}>加载更多项目</Button></div>}
  </section>;
}
