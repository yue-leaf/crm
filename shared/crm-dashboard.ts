import type { CrmRecord, ProjectFilter, ProjectOverview, ProjectScope } from './api.interface';
import { textValue } from './crm';
import { projectReviewProblem } from './crm-workflow';
export const projectStates = ['进行中', '待启动', '暂停', '已完成', '已取消'] as const;
export const projectFilterLabels: Record<ProjectFilter, string> = {
  all: '全部未归档项目', active: '在办项目', attention: '需要关注', 'month-completed': '本月完成',
  overdue: '项目逾期', 'missing-plan': '缺少下一步计划', review: '待核查',
  待启动: '待启动', 进行中: '进行中', 暂停: '暂停', 已完成: '已完成', 已取消: '已取消', archived: '已归档',
};
export function validProjectFilter(value: string): value is ProjectFilter { return Object.prototype.hasOwnProperty.call(projectFilterLabels, value); }
const day = (time: number) => Math.floor((time + 8 * 3600000) / 86400000);
const validTime = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && Number.isFinite(new Date(value).getTime());
export function projectFacts(row: CrmRecord, now: number) {
  const r = row.record;
  const archived = r['已归档'] === true;
  const terminal = textValue(r['终局确认']);
  const state = ['已完成', '已取消'].includes(terminal) ? terminal
    : terminal === '未确认' && ['待启动', '进行中', '暂停'].includes(textValue(r['工作状态'])) ? textValue(r['工作状态']) : '';
  const review = !archived && (textValue(r['核查标记']) !== '正常' || !!textValue(r['数据检查']).trim() || !!projectReviewProblem(r, now) || (['已完成', '已取消'].includes(state) && !validTime(r['结束日期'])));
  const due = r['下次跟进日期'];
  const validDue = validTime(due);
  const advancing = !archived && ['待启动', '进行中'].includes(state);
  const missingPlan = advancing && textValue(r['核查标记']) === '正常' && (!textValue(r['当前下一步行动']).trim() || !validDue);
  const overdue = advancing && !review && !missingPlan && validDue && day(due) < day(now);
  const end = r['结束日期'];
  const monthCompleted = !archived && state === '已完成' && validTime(end)
    && day(end) <= day(now) && new Date(end + 8 * 3600000).toISOString().slice(0, 7) === new Date(now + 8 * 3600000).toISOString().slice(0, 7);
  return { archived, state, review, advancing, missingPlan, overdue, monthCompleted,
    active: !archived && ['待启动', '进行中', '暂停'].includes(state), attention: overdue || missingPlan || review,
    priority: overdue ? 0 : missingPlan ? 1 : review ? 2 : advancing && validDue && day(due) <= day(now) + 3 ? 3 : advancing ? 4 : state === '暂停' ? 5 : 6 };
}
export function projectMatches(row: CrmRecord, filter: ProjectFilter, now: number): boolean {
  const f = projectFacts(row, now);
  if (filter === 'archived') return f.archived;
  if (f.archived) return false;
  if (filter === 'all') return true;
  if (filter === 'active') return f.active;
  if (filter === 'attention') return f.attention;
  if (filter === 'month-completed') return f.monthCompleted;
  if (filter === 'overdue') return f.overdue;
  if (filter === 'missing-plan') return f.missingPlan;
  if (filter === 'review') return f.review;
  return f.state === filter;
}
export function scopedProjects(rows: CrmRecord[], scope: ProjectScope, userId: string): CrmRecord[] {
  return rows.filter(row => scope === 'all' || (Array.isArray(row.record['项目负责人']) && row.record['项目负责人'].some(id => String(id) === userId)));
}
export function sortProjects(rows: CrmRecord[], now: number): CrmRecord[] {
  const time = (row: CrmRecord, name: string, fallback: number) => typeof row.record[name] === 'number' && Number.isFinite(row.record[name]) ? row.record[name] as number : fallback;
  return [...rows].sort((a, b) => projectFacts(a, now).priority - projectFacts(b, now).priority
    || (projectFacts(a, now).priority <= 3 ? time(a, '下次跟进日期', Infinity) - time(b, '下次跟进日期', Infinity) : 0)
    || time(b, '修改时间', 0) - time(a, '修改时间', 0) || a.id.localeCompare(b.id));
}
export function buildProjectOverview(rows: CrmRecord[], scope: ProjectScope, userId: string, now = Date.now()): ProjectOverview {
  const selected = scopedProjects(rows, scope, userId);
  const current = selected.filter(row => row.record['已归档'] !== true);
  const count = (filter: ProjectFilter) => selected.filter(row => projectMatches(row, filter, now)).length;
  return { scope, generatedAt: now, total: current.length, active: count('active'), attention: count('attention'),
    monthCompleted: count('month-completed'), overdue: count('overdue'), missingPlan: count('missing-plan'), review: count('review'),
    archived: count('archived'), unknown: current.filter(row => !projectFacts(row, now).state).length,
    states: { 待启动: count('待启动'), 进行中: count('进行中'), 暂停: count('暂停'), 已完成: count('已完成'), 已取消: count('已取消') },
    projects: sortProjects(current, now).slice(0, 8) };
}
