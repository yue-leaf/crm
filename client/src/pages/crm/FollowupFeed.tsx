import React, { useCallback } from 'react';
import { MessageSquareText } from 'lucide-react';
import { ActionButton as Button } from './ActionButton';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { api } from '@/api/crm';
import type { CrmRecord, EntityKind, FollowupPage, FollowupScope } from '@shared/api.interface';
import { textValue } from '@shared/crm';
import { Cell } from './Fields';
import { useRelatedPage } from './useRelatedPage';

export interface FollowupView { status?: 'all' | 'pending'; scope: FollowupScope; search: string; query: string }
export const defaultFollowupView: FollowupView = { scope: 'all', search: '', query: '' };
interface Props {
  kind: 'customer' | 'project';
  id: string;
  busy: boolean;
  onView: (row: CrmRecord, kind: EntityKind) => void | Promise<void>;
  onContinue?: (row: CrmRecord) => void | Promise<void>;
  onEnd?: (row: CrmRecord) => void | Promise<void>;
  view: FollowupView;
  onViewChange: (view: FollowupView) => void;
}
export function FollowupFeed({ kind, id, busy, onView, view, onViewChange, onContinue, onEnd }: Props) {
  const { scope, search, query, status = 'all' } = view;
  const load = useCallback((cursor?: string): Promise<FollowupPage> =>
    api.relatedFollowups(kind, id, { cursor, search: query, scope, status }), [kind, id, query, scope, status]);
  const { page, loading, error, more, retry, refresh } = useRelatedPage(load, JSON.stringify(['followups', kind, id, query, scope, status]));
  return <section className="related-panel" aria-label="跟进记录" data-page-loading={loading}>
    <div className="related-panel-heading"><div><h3>跟进记录{page && <span>{page.total} 条</span>}</h3>
      <p>{kind === 'customer' ? '汇总客户直接跟进及全部关联项目的跟进，包含历史记录。' : '按实际发生时间查看项目的全部跟进。'}</p></div></div>
    <form className="related-search" onSubmit={(event: React.FormEvent) => { event.preventDefault(); const value: string = search.trim(); if (value === query) refresh(); else onViewChange({ ...view, query: value }); }}>
      <Select value={status} onValueChange={(value: 'all' | 'pending') => onViewChange({ ...view, status: value })}>
        <SelectTrigger aria-label="后续状态筛选" className="w-36"><SelectValue /></SelectTrigger>
        <SelectContent><SelectItem value="all">全部记录</SelectItem><SelectItem value="pending">待跟进</SelectItem></SelectContent>
      </Select>
      {kind === 'customer' && <Select value={scope} onValueChange={(value: FollowupScope) => onViewChange({ ...view, scope: value })}>
        <SelectTrigger aria-label="跟进记录范围" className="w-36"><SelectValue /></SelectTrigger>
        <SelectContent><SelectItem value="all">全部跟进</SelectItem><SelectItem value="direct">客户跟进</SelectItem><SelectItem value="project">项目跟进</SelectItem></SelectContent>
      </Select>}
      <div><Input aria-label="搜索跟进记录" placeholder="搜索跟进内容与结论" value={search}
        onChange={(event: React.ChangeEvent<HTMLInputElement>) => onViewChange({ ...view, search: event.target.value })} /></div>
      <Button type="submit" variant="outline" size="sm">搜索</Button>
      {(search || query) && <Button type="button" variant="ghost" size="sm" onClick={() => { onViewChange({ ...view, search: '', query: '' }); if (!query) refresh(); }}>清空</Button>}
    </form>
    <div className="followup-timeline">
      {page?.records.map((row: CrmRecord) => {
        const source = page.sources[row.id];
        const suggestedPeople: unknown = row.record['建议处理人'];
        const hasSuggestedPeople: boolean = Array.isArray(suggestedPeople) && suggestedPeople.length > 0;
        const hasSuggestion: boolean = textValue(row.record['后续安排']) === '有下一步行动' ||
          !!textValue(row.record['建议下一步行动']) || row.record['建议日期'] != null || hasSuggestedPeople;
        return <article key={row.id} className={`followup-entry ${textValue(row.record['记录状态']) === '已作废' ? 'followup-void' : ''}`}>
          <span className="followup-dot"><MessageSquareText size={14} /></span>
          <div className="followup-entry-heading"><h4 className="followup-source-title">
            {source ? `${source.kind === 'project' ? '项目' : '客户'}：${source.name}` : '跟进记录'}
          </h4><Cell name="实际发生时间" value={row.record['实际发生时间']} /></div>
          <div className="followup-meta"><Cell name="实际跟进人" value={row.record['实际跟进人']} />
            <span>{textValue(row.record['记录类型'])}</span><span>{row.followup?.state}</span>
            {textValue(row.record['记录状态']) === '已作废' && <Cell name="记录状态" value={row.record['记录状态']} />}</div>
          <p className="followup-conclusion">{textValue(row.record['内容 / 推进结论']) || '未填写推进结论'}</p>
          {hasSuggestion && <div className="followup-advice">
            {textValue(row.record['建议下一步行动']) && <p className="followup-advice-action"><span>下一步建议</span>{textValue(row.record['建议下一步行动'])}</p>}
            <dl className="followup-advice-details">
              <div><dt>建议跟进日期</dt><dd><Cell name="建议日期" value={row.record['建议日期']} /></dd></div>
              <div><dt>建议执行人</dt><dd>{hasSuggestedPeople
                ? <Cell name="建议处理人" value={suggestedPeople} /> : '未指定'}</dd></div>
            </dl>
          </div>}
          <div className="followup-entry-footer">
            {row.followup?.state === '待跟进' && <><Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => onContinue?.(row)}>继续跟进</Button>
              <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => onEnd?.(row)}>结束跟进</Button></>}
            <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => onView(row, 'followup')}>查看详情</Button></div>
        </article>;
      })}
    </div>
    {loading && <p className="related-empty" role="status">正在读取跟进记录…</p>}
    {!loading && !error && page?.records.length === 0 && <div className="related-empty"><MessageSquareText size={24} />
      <p>{query ? '没有找到匹配的跟进记录。' : status === 'pending' ? '暂无待跟进记录。' : scope !== 'all' ? '当前范围暂无跟进记录，可切换“全部跟进”。' : '暂无跟进记录，可点击上方“记录跟进”开始记录。'}</p></div>}
    {error && <div className="error-banner" role="alert">{error}<Button size="sm" variant="ghost" disabled={loading} onClick={retry}>重新加载</Button></div>}
    {page?.hasMore && <div className="related-pagination"><span>已加载 {page.records.length} / {page.total} 条</span>
      <Button variant="outline" size="sm" disabled={loading} onClick={() => void more()}>加载更多跟进</Button></div>}
  </section>;
}
