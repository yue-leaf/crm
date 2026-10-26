import React, { useCallback, useState } from 'react';
import { MessageSquareText, Search, ArrowUpRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { api } from '@/api/crm';
import type { CrmRecord, EntityKind, FollowupPage, FollowupScope } from '@shared/api.interface';
import { textValue } from '@shared/crm';
import { Cell } from './Fields';
import { useRelatedPage } from './useRelatedPage';

interface Props {
  kind: 'customer' | 'project';
  id: string;
  busy: boolean;
  onView: (row: CrmRecord, kind: EntityKind) => void;
}
export function FollowupFeed({ kind, id, busy, onView }: Props) {
  const [scope, setScope] = useState<FollowupScope>('all');
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const load = useCallback((cursor?: string): Promise<FollowupPage> =>
    api.relatedFollowups(kind, id, { cursor, search: query, scope }), [kind, id, query, scope]);
  const { page, loading, error, more, retry } = useRelatedPage(load);
  return <section className="related-panel" aria-label="跟进记录">
    <div className="related-panel-heading"><div><h3>跟进记录{page && <span>{page.total} 条</span>}</h3>
      <p>{kind === 'customer' ? '汇总客户直接跟进及全部关联项目的跟进，包含历史记录。' : '按实际发生时间查看项目的全部跟进。'}</p></div></div>
    <form className="related-search" onSubmit={(event: React.FormEvent) => { event.preventDefault(); const value: string = search.trim(); if (value === query) retry(); else setQuery(value); }}>
      {kind === 'customer' && <select aria-label="跟进记录范围" value={scope}
        onChange={(event: React.ChangeEvent<HTMLSelectElement>) => setScope(event.target.value as FollowupScope)}>
        <option value="all">全部跟进</option><option value="direct">客户直接跟进</option><option value="project">项目跟进</option>
      </select>}
      <div><Search size={15} /><Input aria-label="搜索跟进记录" placeholder="搜索主题或推进结论" value={search}
        onChange={(event: React.ChangeEvent<HTMLInputElement>) => setSearch(event.target.value)} /></div>
      <Button type="submit" variant="outline" size="sm">搜索</Button>
      {(search || query) && <Button type="button" variant="ghost" size="sm" onClick={() => { setSearch(''); if (query) setQuery(''); else retry(); }}>清空</Button>}
    </form>
    <div className="followup-timeline">
      {page?.records.map((row: CrmRecord) => {
        const source = page.sources[row.id];
        return <article key={row.id} className={`followup-entry ${textValue(row.record['记录状态']) === '已作废' ? 'followup-void' : ''}`}>
          <span className="followup-dot"><MessageSquareText size={14} /></span>
          <div className="followup-entry-heading"><button className="record-title" disabled={busy}
            onClick={() => onView(row, 'followup')}>{textValue(row.record['跟进主题']) || '未命名跟进'}</button>
            <Cell name="实际发生时间" value={row.record['实际发生时间']} /></div>
          <div className="followup-meta"><Cell name="实际跟进人" value={row.record['实际跟进人']} />
            <span>{textValue(row.record['记录类型'])}</span><Cell name="核查标记" value={row.record['核查标记']} />
            {textValue(row.record['记录状态']) === '已作废' && <Cell name="记录状态" value={row.record['记录状态']} />}</div>
          <p className="followup-conclusion">{textValue(row.record['内容 / 推进结论']) || '未填写推进结论'}</p>
          {textValue(row.record['建议下一步行动']) && <p className="followup-advice"><span>下一步建议</span>{textValue(row.record['建议下一步行动'])}</p>}
          <div className="followup-entry-footer">{source && <button className="related-source" disabled={busy}
            onClick={() => onView({ id: source.id, record: {} }, source.kind)}>{source.kind === 'project' ? '项目' : '客户直接跟进'} · {source.name}<ArrowUpRight size={12} /></button>}
            <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => onView(row, 'followup')}>查看详情</Button></div>
        </article>;
      })}
    </div>
    {loading && <p className="related-empty" role="status">正在读取跟进记录…</p>}
    {!loading && !error && page?.records.length === 0 && <div className="related-empty"><MessageSquareText size={24} />
      <p>{query ? '没有找到匹配的跟进记录。' : scope !== 'all' ? '当前范围暂无跟进记录，可切换“全部跟进”。' : '暂无跟进记录，可点击上方“记录跟进”开始记录。'}</p></div>}
    {error && <div className="error-banner" role="alert">{error}<Button size="sm" variant="ghost" disabled={loading} onClick={retry}>重新加载</Button></div>}
    {page?.hasMore && <div className="related-pagination"><span>已加载 {page.records.length} / {page.total} 条</span>
      <Button variant="outline" size="sm" disabled={loading} onClick={() => void more()}>加载更多跟进</Button></div>}
  </section>;
}
