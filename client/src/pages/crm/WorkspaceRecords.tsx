import React, { useEffect, useRef, useState } from 'react';
import { api } from '@/api/crm';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import type { CrmPage, CrmRecord, ProjectScope } from '@shared/api.interface';
import type { WorkspaceKind } from '@shared/crm-workspace';
import { textValue, titles } from '@shared/crm';
import { appendPage } from '@shared/crm-interaction';
import { Cell, message } from './Fields';
export interface WorkspaceDrilldown { kind: WorkspaceKind; filter: string; title: string }
export const WorkspaceRecords: React.FC<{ selection: WorkspaceDrilldown; scope: ProjectScope; onClose: () => void;
  onOpen: (row: CrmRecord, kind: WorkspaceKind) => void }> = ({ selection, scope, onClose, onOpen }) => {
  const [data, setData] = useState<CrmPage | null>(null);
  const [search, setSearch] = useState(''); const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [retry, setRetry] = useState(0);
  const generation = useRef(0); const paging = useRef(false);
  useEffect(() => {
    const version = ++generation.current; setBusy(true); setError(''); setData(null); paging.current = false;
    void api.workspaceRecords(scope, selection.kind, selection.filter, '', query).then(result => {
      if (generation.current === version) setData(result);
    }).catch(e => { if (generation.current === version) setError(message(e)); })
      .finally(() => { if (generation.current === version) setBusy(false); });
    return () => { generation.current++; };
  }, [scope, selection.kind, selection.filter, query, retry]);
  const more = async () => {
    if (busy || paging.current || !data?.pageToken) return;
    const version = generation.current; paging.current = true; setBusy(true); setError('');
    try {
      const next = await api.workspaceRecords(scope, selection.kind, selection.filter, data.pageToken, query);
      if (version === generation.current) setData(previous => appendPage(previous, next));
    } catch (e) { if (version === generation.current) setError(message(e)); }
    finally { if (version === generation.current) { setBusy(false); paging.current = false; } }
  };
  return <Dialog open onOpenChange={open => { if (!open) onClose(); }}><DialogContent className="crm-dialog workspace-record-dialog">
    <header className="crm-dialog-header"><DialogTitle>{selection.title}</DialogTitle><DialogDescription className="sr-only">查看并打开业务记录</DialogDescription></header>
    <div className="crm-dialog-body">
      <form className="workspace-search" onSubmit={event => { event.preventDefault(); if (search.trim() === query) setRetry(n => n + 1); else setQuery(search.trim()); }}>
        <Input aria-label="搜索业务名称" placeholder="搜索名称" value={search} onChange={event => setSearch(event.target.value)} maxLength={200} />
        <Button type="submit" variant="outline">搜索</Button><span>{data ? `共 ${data.total} 条` : ''}</span>
      </form>
      {error && <div className="error-banner" role="alert">{error}<Button variant="ghost" onClick={() => { if (data?.hasMore) void more(); else setRetry(n => n + 1); }}>重试</Button></div>}
      <div className="workspace-records">{data?.records.map(row => <button key={row.id} className="workspace-record" onClick={() => { onClose(); onOpen(row, selection.kind); }}>
        <strong>{textValue(row.record[titles[selection.kind]]) || '未命名记录'}</strong>
        <span>{selection.kind === 'customer' ? '' : selection.kind === 'project'
          ? textValue(row.record['终局确认']) === '未确认' ? textValue(row.record['工作状态']) : textValue(row.record['终局确认']) : textValue(row.record['记录类型'])}
</span>
        <small><Cell name={selection.kind === 'followup' ? '实际发生时间' : '创建时间'} value={row.record[selection.kind === 'followup' ? '实际发生时间' : '创建时间']} /></small>
      </button>)}</div>
      {busy && <p className="workspace-empty" role="status">正在加载…</p>}
      {!busy && !error && !data?.records.length && <p className="workspace-empty">没有符合条件的记录</p>}
      {data?.hasMore && <Button variant="outline" disabled={busy} onClick={() => void more()}>加载更多</Button>}
    </div>
  </DialogContent></Dialog>;
};
