import React, { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ArrowRight, CalendarDays, Clock3, Paperclip, Plus, X } from 'lucide-react';
import { ActionButton as Button } from './ActionButton';
import type { CrmRecord } from '@shared/api.interface';
import { taskLabels, taskMatches, taskFilterFromLink, taskTab } from '@shared/crm-workspace';
import type { WorkspaceData, WorkspaceKind, TaskFilter } from '@shared/crm-workspace';
import { Cell } from './Fields';
import { displayDate } from '@shared/crm-presentation';
import { WorkspaceRecords } from './WorkspaceRecords';
import type { WorkspaceDrilldown } from './WorkspaceRecords';
import './workspace.css';
interface Props {
  data: WorkspaceData | null; loading: boolean; error: string; busy: boolean; onRetry: () => void;
  onOpen: (row: CrmRecord, kind: WorkspaceKind) => void | Promise<void>;
  onOpenLoaded: (row: CrmRecord, kind: WorkspaceKind) => void | Promise<void>;
  onContinue: (row: CrmRecord) => void | Promise<void>;
  onEnd: (row: CrmRecord) => void | Promise<void>;
  onCreate: () => void;
}
export const ProjectDashboard: React.FC<Props> = ({ data, loading, error, busy, onRetry, onOpen, onOpenLoaded, onCreate, onContinue, onEnd }) => {
  const [params] = useSearchParams();
  const linkedFilter = params.get('taskFilter');
  const initialFilter: TaskFilter = taskFilterFromLink(linkedFilter);
  const [filter, setFilter] = useState<TaskFilter>(initialFilter);
  useEffect(() => { setFilter(initialFilter); setLimit(8); }, [initialFilter]);
  const [limit, setLimit] = useState(8);
  const [drilldown, setDrilldown] = useState<WorkspaceDrilldown | null>(null);
  const taskPanel = useRef<HTMLElement>(null);
  useEffect(() => { setLimit(8); setDrilldown(null); }, [data?.scope]);
  const select = (next: TaskFilter, scroll = false) => {
    setFilter(next); setLimit(8);
    if (scroll) taskPanel.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  };
  const show = (kind: WorkspaceKind, recordFilter: string, title: string) => setDrilldown({ kind, filter: recordFilter, title });
  const open = (kind: WorkspaceKind, id: string) => onOpen({ id, record: {} }, kind);
  const tasks = data?.tasks.filter(row => taskMatches(row, filter, data.generatedAt)) || [];
  const count = (n: number | undefined) => loading || n === undefined ? '—' : n;
  const disabled = loading || !data;
  const metrics = [
    { key: 'overdue', label: '已逾期', icon: Clock3, tone: 'red', hint: '已超过建议日期的待跟进记录' },
    { key: 'week', label: '本周待跟进', icon: CalendarDays, tone: 'blue', hint: '建议日期在本周一至周日且尚未完成的事项，包含本周已逾期事项' },
  ] as const;
  const empty = (label: string) => <div className="workspace-empty" role="status">{loading ? '正在加载…' : data ? label : '数据暂不可用'}</div>;
  return <div className="workspace-dashboard" aria-busy={loading}>
    {error && <div className="error-banner" role="alert">{error}<Button variant="ghost" onClick={onRetry}>重试</Button></div>}
    <div className="workspace-metrics">{metrics.map(metric => <button key={metric.key} disabled={disabled} title={metric.hint}
      className={`workspace-metric tone-${metric.tone}`} aria-pressed={filter === metric.key} onClick={() => select(metric.key, true)}>
      <span>{metric.label}<metric.icon size={18} /></span><strong>{count(data?.tasks.filter(row => taskMatches(row, metric.key, data.generatedAt)).length)}</strong><ArrowRight size={15} className="metric-arrow" />
    </button>)}</div>
    <div className="workspace-main-grid">
      <section className="panel workspace-tasks" ref={taskPanel}>
        <div className="workspace-heading"><h2>待处理事项</h2><Button size="sm" variant="ghost" disabled={disabled} onClick={() => { select('all'); setLimit(data?.tasks.length || 8); }}>查看全部<ArrowRight size={14} /></Button></div>
        <div className="workspace-tabs" role="group" aria-label="待办筛选">
          {(['pending', 'overdue', 'all'] as const).map(key => <button key={key} disabled={disabled} aria-pressed={taskTab(filter) === key} onClick={() => select(key)}>{taskLabels[key]}</button>)}
        </div>
        {!['pending', 'overdue', 'all'].includes(filter) && <div className="workspace-filter-scope">
          <button onClick={() => select(taskTab(filter))} aria-label={`清除${taskLabels[filter]}筛选`}>
            {taskLabels[filter]}<X size={12} />
          </button>
        </div>}
        {!disabled && tasks.length > 0 ? <><div className="workspace-table-scroll"><table className="workspace-task-table"><thead><tr><th>客户 / 项目</th><th>下一步行动</th><th>执行人</th><th>计划日期</th><th>操作</th></tr></thead>
          <tbody>{tasks.slice(0, limit).map(row => <tr key={`${row.kind}:${row.id}`}>
            <td data-label="客户 / 项目"><button className="workspace-name" onClick={() => open(row.targetKind || row.kind, row.targetId || row.id)}>{row.name}</button>
              {(row.targetKind || row.kind) === 'project' && <button className="workspace-subname" disabled={!row.customerId} onClick={() => row.customerId && open('customer', row.customerId)}>{row.customerName}</button>}
              {row.state === '暂停' && <small className="workspace-muted">项目已暂停</small>}</td>
            <td data-label="下一步行动"><span className="workspace-clamp" title={row.action}>{row.action || '待补充下一步行动'}</span></td>
            <td data-label="执行人">{row.people.length ? <Cell name="行动执行人" value={row.people} /> : <span className="workspace-muted">未指定</span>}</td>
            <td data-label="计划日期"><span className={`workspace-due due-${row.status}`}>{row.status === 'today' ? '今日' : row.status === 'tomorrow' ? '明日' : row.status === 'overdue'
              ? `逾期 ${Math.floor((data.generatedAt + 28800000) / 86400000) - Math.floor((row.due! + 28800000) / 86400000)} 天` : row.due ? displayDate('下次跟进日期', row.due) : '待安排'}</span>
              {row.due && ['today', 'tomorrow', 'overdue'].includes(row.status) && <small className="workspace-muted">{displayDate('下次跟进日期', row.due)}</small>}</td>
            <td data-label="操作"><div className="workspace-row-actions"><Button variant="ghost" size="sm" disabled={busy} onClick={() => onContinue({ id: row.id, record: {} })}>继续跟进</Button>
              <Button variant="ghost" size="sm" disabled={busy} onClick={() => onEnd({ id: row.id, record: {} })}>结束跟进</Button></div></td>
          </tr>)}</tbody></table></div><div className="workspace-list-end"><span>共 {tasks.length} 项</span>{limit < tasks.length && <Button size="sm" variant="ghost" onClick={() => setLimit(n => n + 8)}>加载更多</Button>}</div></>
          : empty(filter === 'all' ? '暂无待处理事项' : `暂无${taskLabels[filter]}${taskLabels[filter].endsWith('事项') ? '' : '事项'}`)}
      </section>
      <section className="panel workspace-recent"><div className="workspace-heading"><h2>最近跟进</h2><Button size="sm" variant="ghost" disabled={disabled} onClick={() => show('followup', 'all', '全部有效跟进')}>查看全部<ArrowRight size={14} /></Button></div>
        {!disabled && data.recent.length ? <div className="workspace-feed">{data.recent.map(row => <article key={row.id}>
          <div className="workspace-feed-meta"><Cell name="实际跟进人" value={row.people} /><time>{displayDate('实际发生时间', row.occurredAt)}</time></div>
          <div className="workspace-feed-target"><button disabled={!row.customerId} onClick={() => row.customerId && open('customer', row.customerId)}>{row.customerName}</button>
            {row.projectId && <button onClick={() => open('project', row.projectId!)}>{row.projectName || '查看项目'}</button>}</div>
          <button className="workspace-feed-content" aria-label={`查看跟进：${row.subject}`} onClick={() => open('followup', row.id)}><span className="workspace-clamp">{row.conclusion || row.subject}</span></button>
          {row.nextAction && <p className="workspace-next workspace-clamp">后续：{row.nextAction}</p>}
          {row.attachmentCount > 0 && <button className="workspace-attachment" onClick={() => open('followup', row.id)}><Paperclip size={13} />{row.attachmentCount} 个附件</button>}
        </article>)}</div> : <>{empty('暂无有效跟进记录')}{data && <Button className="workspace-empty-action" variant="outline" onClick={onCreate}><Plus size={14} />记录跟进</Button>}</>}
      </section>
    </div>
    <section className="workspace-summary" aria-label="业务总览"><div className="workspace-section-title"><h2>业务总览</h2></div>
      <div className="workspace-totals">{([{ kind: 'customer', label: '总客户数', unit: '家', hint: '全部客户' }, { kind: 'project', label: '总项目数', unit: '个', hint: '全部项目' },
        { kind: 'followup', label: '总跟进数', unit: '条', hint: '有效跟进，已作废或数据异常的记录不计入' }] as const).map(item => <div className="panel workspace-total" key={item.kind}>
          <button disabled={disabled} title={item.hint} className="workspace-total-main" onClick={() => show(item.kind, 'all', item.label)}><span>{item.label}</span><div><strong>{count(data?.totals[item.kind].total)}</strong><small>{item.unit}</small><ArrowRight size={15} /></div></button>
          <div className="workspace-total-details">{item.kind === 'project' ? <><button disabled={disabled} onClick={() => show('project', 'active', '在办项目')}>在办 <b>{count(data?.project.active)}</b></button><button disabled={disabled} onClick={() => show('project', 'completed-month', '本月签约项目')}>本月签约 <b>{count(data?.project.monthCompleted)}</b></button></>
            : <button disabled={disabled} onClick={() => show(item.kind, 'month', `本月新增${item.kind === 'customer' ? '客户' : '跟进'}`)}>本月新增 <b>{count(data?.totals[item.kind].monthNew)}</b></button>}</div>
        </div>)}</div>
    </section>
    {drilldown && data && <WorkspaceRecords key={`${data.scope}:${drilldown.kind}:${drilldown.filter}`} scope={data.scope} selection={drilldown} onClose={() => setDrilldown(null)} onOpen={onOpenLoaded} />}
  </div>;
};
