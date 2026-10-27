import type { CrmRecord, ProjectFilter, ProjectOverview, ProjectScope } from './api.interface';
import { textValue } from './crm';
import { followupStatus, followupFilterLabels, sortFollowups } from './crm-followup-status';
export const projectStates = ['待启动', '进行中', '暂停', '已签合同', '已取消'] as const;
export const projectFilterLabels: Record<ProjectFilter, string> = {
  active: '在办项目', attention: '需要关注', 'month-completed': '本月签约',
  ...followupFilterLabels, all: '全部项目', 'missing-plan': '缺少下一步计划',
  待启动: '待启动', 进行中: '进行中', 暂停: '暂停', 已签合同: '已签合同', 已取消: '已取消',
};
export function validProjectFilter(value: string): value is ProjectFilter { return Object.prototype.hasOwnProperty.call(projectFilterLabels, value); }
const day = (time: number) => Math.floor((time + 8 * 3600000) / 86400000);
const validTime = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && Number.isFinite(new Date(value).getTime());
export function projectFacts(row: CrmRecord, now: number) {
  const r = row.record;
  const terminal = textValue(r['终局确认']);
  const state = ['已完成', '已取消'].includes(terminal) ? terminal === '已完成' ? '已签合同' : terminal
    : terminal === '未确认' && ['待启动', '进行中', '暂停', '已签合同'].includes(textValue(r['工作状态'])) ? textValue(r['工作状态']) : '';
  const followup = followupStatus(r, now);
  const due = r['下次跟进日期'];
  const validDue = validTime(due);
  const advancing = ['待启动', '进行中', '已签合同'].includes(state);
  const missingPlan = advancing && (!textValue(r['当前下一步行动']).trim() || !validDue);
  const overdue = followup.key === 'overdue';
  const end = r['签约日期'];
  const monthCompleted = state === '已签合同' && validTime(end)
    && day(end) <= day(now) && new Date(end + 8 * 3600000).toISOString().slice(0, 7) === new Date(now + 8 * 3600000).toISOString().slice(0, 7);
  return { state, followup, advancing, missingPlan, overdue, monthCompleted,
    active: ['待启动', '进行中', '暂停', '已签合同'].includes(state), attention: overdue || missingPlan || ['today', 'tomorrow', 'unplanned'].includes(followup.key),
    priority: followup.priority };
}
export function projectMatches(row: CrmRecord, filter: ProjectFilter, now: number): boolean {
  const f = projectFacts(row, now);
  if (filter === 'all') return true;
  if (filter === 'none') return f.followup.key === 'none';
  if (filter === 'active') return f.active;
  if (filter === 'attention') return f.attention;
  if (filter === 'month-completed') return f.monthCompleted;
  if (filter === 'overdue') return f.overdue;
  if (filter === 'missing-plan') return f.missingPlan;
  if (filter in followupFilterLabels) return f.followup.key === filter;
  return f.state === filter;
}
export function scopedProjects(rows: CrmRecord[], scope: ProjectScope, userId: string): CrmRecord[] {
  return rows.filter(row => scope === 'all' || (Array.isArray(row.record['项目负责人']) && row.record['项目负责人'].some(id => String(id) === userId)));
}
export function sortProjects(rows: CrmRecord[], now: number): CrmRecord[] {
  return sortFollowups(rows, now);
}
export function buildProjectOverview(rows: CrmRecord[], scope: ProjectScope, userId: string, now = Date.now()): ProjectOverview {
  const selected = scopedProjects(rows, scope, userId);
  const current = selected;
  const count = (filter: ProjectFilter) => selected.filter(row => projectMatches(row, filter, now)).length;
  return { scope, generatedAt: now, total: current.length, active: count('active'), attention: count('attention'),
    monthCompleted: count('month-completed'), overdue: count('overdue'), missingPlan: count('missing-plan'), today: count('today'), tomorrow: count('tomorrow'),
    unknown: current.filter(row => !projectFacts(row, now).state).length,
    states: { 待启动: count('待启动'), 进行中: count('进行中'), 暂停: count('暂停'), 已签合同: count('已签合同'), 已取消: count('已取消') },
    projects: sortProjects(current, now).slice(0, 8) };
}
