import React from 'react';
import { ArrowRight, Clock3, CircleAlert, FileCheck2, Eye, Pencil, MessageSquarePlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { CrmRecord, CrmSummary, ProjectFilter, ProjectOverview } from '@shared/api.interface';
import { projectFacts, projectStates } from '@shared/crm-dashboard';
import { sectionLabels, textValue } from '@shared/crm';
import { displayDate } from '@shared/crm-presentation';
import { editBlockedReason } from '@shared/crm-edit';
import { FollowupBadge, useFollowupClock } from './FollowupStatus';
import './project-overview.css';
interface Props {
  data: ProjectOverview | null; summary: CrmSummary | null; loading: boolean;
  onFilter: (filter: ProjectFilter) => void; onNavigate: (kind: 'customer' | 'contact' | 'followup') => void;
  onOpen: (row: CrmRecord) => void; onEdit: (row: CrmRecord) => void; onFollowup: (row: CrmRecord) => void;
}
export const ProjectDashboard: React.FC<Props> = ({ data, summary, loading, onFilter, onNavigate, onOpen, onEdit, onFollowup }) => {
  const now = useFollowupClock();
  const count = (value: number | undefined) => loading || value === undefined ? '—' : value;
  const max = Math.max(1, ...projectStates.slice(0, 3).map(state => data?.states[state] || 0));
  const metrics = [
    { key: 'active', label: '在办项目', value: data?.active, note: '待启动、进行中及暂停', icon: Clock3 },
    { key: 'attention', label: '需要关注', value: data?.attention, note: '逾期、今日、明日及未安排 · 按项目去重', icon: CircleAlert },
    { key: 'month-completed', label: '本月完成', value: data?.monthCompleted, note: '按北京时间结束日期', icon: FileCheck2 },
  ] as const;
  return <div className="project-dashboard" aria-busy={loading}>
    <section className="project-metrics" aria-label="项目关键指标">
      {metrics.map(metric => <button key={metric.key} className={`project-metric metric-${metric.key}`} disabled={loading || !data} onClick={() => onFilter(metric.key)}>
        <div className="metric-label"><span>{metric.label}</span><metric.icon size={19} /></div>
        <strong>{count(metric.value)}</strong><small>{metric.note}</small>
      </button>)}
    </section>
    <div className="project-overview-grid">
      <section className="panel project-distribution">
        <div className="dashboard-panel-heading"><div><h2>项目推进情况</h2><p>未归档项目 {count(data?.total)} 个</p></div>
          <Button variant="ghost" size="sm" disabled={loading || !data} onClick={() => onFilter('all')}>查看全部<ArrowRight size={14} /></Button></div>
        <div className="project-bars">
          {projectStates.slice(0, 3).map(state => <button className={`project-state state-${state}`} key={state} disabled={loading || !data} onClick={() => onFilter(state)}>
            <span>{state}</span><div className="project-bar-track" aria-hidden="true"><div style={{ width: `${(data?.states[state] || 0) / max * 100}%` }} /></div><strong>{count(data?.states[state])}</strong>
          </button>)}
        </div>
        <div className="project-outcomes">
          {(['已完成', '已取消'] as const).map(state => <button key={state} disabled={loading || !data} onClick={() => onFilter(state)}><span className={`outcome-dot outcome-${state}`} />{state}<strong>{count(data?.states[state])}</strong></button>)}
          <button disabled={loading || !data} onClick={() => onFilter('archived')}>已归档<strong>{count(data?.archived)}</strong><ArrowRight size={13} /></button>
        </div>
        {!!data?.unknown && <p className="dashboard-status-note">另有 {data.unknown} 个项目状态异常，请打开项目修正资料。</p>}
      </section>
      <section className="panel priority-panel">
        <div className="dashboard-panel-heading"><div><h2>优先处理</h2><p>从需要处理的事项开始</p></div><span className="priority-mark"><CircleAlert size={19} /></span></div>
        <div className="priority-list">{[
          { filter: 'overdue', label: '项目已逾期', value: data?.overdue, tone: 'urgent' },
          { filter: 'missing-plan', label: '项目缺少下一步计划', value: data?.missingPlan, tone: 'warning' },
          { filter: 'today', label: '项目今日需跟进', value: data?.today, tone: 'urgent' },
          { filter: 'tomorrow', label: '项目明日需跟进', value: data?.tomorrow, tone: 'warning' },
        ].map(item => <button key={item.filter} disabled={loading || !data} onClick={() => onFilter(item.filter as ProjectFilter)}><span className={`priority-dot ${item.tone}`} /><span><strong>{count(item.value)}</strong> 个{item.label}</span><ArrowRight size={16} /></button>)}</div>
        <p className="dashboard-status-note">跟进提醒按北京时间计算，已结束和已归档项目不参与提醒。</p>
      </section>
    </div>
    <section className="panel project-tracking">
      <div className="dashboard-panel-heading"><div><h2>项目跟踪</h2><p>优先展示逾期、今日及明日需跟进项目 · 最多 8 条</p></div><Button variant="ghost" size="sm" disabled={loading || !data} onClick={() => onFilter('all')}>查看全部<ArrowRight size={14} /></Button></div>
      <div className="project-tracking-scroll"><table aria-label="项目跟踪"><thead><tr><th>项目名称</th><th>状态</th><th>当前进展</th><th>下一步 / 截止日期</th><th>操作</th></tr></thead><tbody>
        {!loading && data?.projects.map(row => {
          const fact = projectFacts(row, now);
          const inactive = ['已完成', '已取消'].includes(fact.state);
          return <tr key={row.id}><td data-label="项目名称"><button className="record-title" onClick={() => onOpen(row)}>{textValue(row.record['项目名称']) || '未命名项目'}</button></td>
            <td data-label="状态"><span className={`project-status status-${fact.state || '异常'}`}>{fact.state || '状态异常'}</span></td>
            <td data-label="当前进展"><span className="tracking-text" title={textValue(row.record['当前进展'])}>{textValue(row.record['当前进展']) || '暂无进展'}</span></td>
            <td data-label="下一步 / 截止日期"><span className="tracking-text">{!fact.state ? '请先核对项目状态' : inactive ? '项目已结束' : fact.state === '暂停' ? '已暂停推进' : textValue(row.record['当前下一步行动']) || '尚未安排下一步'}</span>
              {!inactive && <small className={fact.overdue ? 'tracking-overdue' : 'tracking-date'}>{displayDate('下次跟进日期', row.record['下次跟进日期']) || '—'}</small>} <FollowupBadge record={row.record} /></td>
            <td data-label="操作"><div className="tracking-actions"><Button variant="ghost" size="sm" onClick={() => onOpen(row)}><Eye size={14} />查看</Button><Button variant="ghost" size="sm" disabled={!!editBlockedReason('project', row)} title={editBlockedReason('project', row) || '编辑项目'} onClick={() => onEdit(row)}><Pencil size={14} />编辑</Button><Button variant="ghost" size="sm" title={inactive ? '补录历史跟进' : '记录项目跟进'} onClick={() => onFollowup(row)}><MessageSquarePlus size={14} />{inactive ? '补录' : '跟进'}</Button></div></td></tr>;
        })}
      </tbody></table></div>
      {(loading || !data?.projects.length) && <div className="dashboard-empty" role="status">{loading ? '正在读取项目概览…' : data ? '当前范围暂无未归档项目' : '项目概览尚未加载，请刷新重试'}</div>}
    </section>
    <div className="dashboard-footnote"><div>{(['customer', 'contact', 'followup'] as const).map(kind => <button key={kind} onClick={() => onNavigate(kind)}>{sectionLabels[kind]}<strong>{count(summary?.[kind])}</strong><ArrowRight size={12} /></button>)}</div><span>辅助数量为全体记录 · 项目统计{data ? `更新于 ${new Intl.DateTimeFormat('zh-CN', {timeZone:'Asia/Shanghai',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(data.generatedAt)}` : '等待加载'}</span></div>
  </div>;
};
