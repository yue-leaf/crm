import type { CrmRecord, ProjectScope } from './api.interface';
import { linkIds, textValue, titles } from './crm';
import { followupStatus, shanghaiDay } from './crm-followup-status';
import { projectFacts, projectStates } from './crm-dashboard';
import { followupChains, projectFollowupSummary } from './crm-followup-chain';
import { followupTarget } from './crm-workflow';

export type WorkspaceKind = 'customer' | 'project' | 'followup';
export type TaskFilter = 'pending' | 'priority' | 'overdue' | 'today' | 'tomorrow' | 'other' | 'week' | 'missing' | 'all';
export const taskLabels: Record<TaskFilter, string> = { pending: '待跟进事项', priority: '优先处理', overdue: '逾期事项', today: '今日', tomorrow: '明日', other: '其他待跟进', week: '本周待跟进', missing: '待安排日期', all: '全部事项' };
export const taskFilterFromLink = (value: string | null): TaskFilter =>
  value && Object.prototype.hasOwnProperty.call(taskLabels, value) ? value as TaskFilter : 'pending';
export const taskTab = (filter: TaskFilter): 'pending' | 'overdue' | 'all' =>
  filter === 'overdue' ? 'overdue' : ['all', 'week', 'priority'].includes(filter) ? 'all' : 'pending';
export interface WorkspaceTask {
  id: string; kind: 'customer' | 'project' | 'followup'; targetKind?: 'customer' | 'project'; targetId?: string; name: string; customerId?: string; customerName: string;
  action: string; people: string[]; due: number | null; status: string; state: string; missing: boolean;
}
export interface WorkspaceActivity {
  id: string; subject: string; customerId?: string; customerName: string; projectId?: string; projectName: string;
  people: string[]; occurredAt: number; conclusion: string; nextAction: string; attachmentCount: number;
}
export interface WorkspaceAttention { id: string; name: string; lastAt: number | null; days: number; activeProjects: number }
export interface WorkspaceData {
  scope: ProjectScope; generatedAt: number;
  counts: { overdue: number; today: number; tomorrow: number; missing: number };
  totals: Record<WorkspaceKind, { total: number; monthNew: number }>;
  project: { active: number; monthCompleted: number; unknown: number; states: Record<string, number> };
  tasks: WorkspaceTask[]; recent: WorkspaceActivity[]; attention: WorkspaceAttention[]; attentionTotal: number;
}
export interface WorkspaceSource { customer: CrmRecord[]; project: CrmRecord[]; followup: CrmRecord[] }
export const validWorkspaceTime = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && Number.isFinite(new Date(v).getTime());
const people = (v: unknown): string[] => Array.isArray(v) ? v.map(String) : [];
const mine = (row: CrmRecord, keys: string[], id: string): boolean => keys.some(key => people(row.record[key]).includes(id));
const inMonth = (v: unknown, now: number): boolean => validWorkspaceTime(v) && v <= now &&
  new Date(v + 28800000).toISOString().slice(0, 7) === new Date(now + 28800000).toISOString().slice(0, 7);

export function workspaceModel(source: WorkspaceSource, scope: ProjectScope, userId: string, now = Date.now()) {
  const customers = new Map(source.customer.map(row => [row.id, row]));
  source = { ...source, project: projectFollowupSummary(source.project, source.followup, now), followup: followupChains(source.followup, now) };
  const projects = new Map(source.project.map(row => [row.id, row]));
  const validFollowups = source.followup.filter(row => {
    const target = followupTarget(row);
    return textValue(row.record['记录状态']) === '正常' && !textValue(row.record['数据检查']).trim() &&
      validWorkspaceTime(row.record['实际发生时间']) && row.record['实际发生时间'] <= now &&
      !!target && (target.kind === 'customer' ? customers.has(target.id) : projects.has(target.id));
  });
  const scopedProjects = source.project.filter(row => scope === 'all' || mine(row, ['项目负责人', '协同人员', '待跟进执行人'], userId));
  const projectIds = new Set(scopedProjects.map(row => row.id));
  const projectCustomers = new Set(scopedProjects.flatMap(row => linkIds(row.record['所属企业'])));
  const assignedCustomers = new Set(validFollowups.filter(row => row.followup?.state === '待跟进' && mine(row, ['建议处理人'], userId)).flatMap(row => linkIds(row.record['直接客户'])));
  const scopedCustomers = source.customer.filter(row => scope === 'all' || mine(row, ['客户负责人', '行动执行人'], userId) || projectCustomers.has(row.id) || assignedCustomers.has(row.id));
  const customerIds = new Set(scopedCustomers.map(row => row.id));
  const scopedFollowups = validFollowups.filter(row => {
    const target = followupTarget(row)!;
    return scope === 'all' || mine(row, ['实际跟进人', '建议处理人'], userId) ||
      (target.kind === 'customer' ? customerIds.has(target.id) : projectIds.has(target.id));
  });
  const records: WorkspaceSource = { customer: scopedCustomers, project: scopedProjects, followup: scopedFollowups };
  const customerOf = (row: CrmRecord, kind: WorkspaceKind): string | undefined => kind === 'customer' ? row.id : kind === 'project'
    ? linkIds(row.record['所属企业'])[0] : linkIds(row.record['直接客户'])[0] || linkIds(projects.get(linkIds(row.record['关联项目'])[0])?.record['所属企业'])[0];
  const nameOf = (id: string | undefined): string => textValue(id ? customers.get(id)?.record['企业全称'] : '') || '未关联客户';
  const tasks: WorkspaceTask[] = [];
  for (const row of validFollowups) {
    if (row.followup?.state !== '待跟进' || (scope === 'mine' && !mine(row, ['建议处理人'], userId))) continue;
    const target = followupTarget(row)!;
    const targetRow = target.kind === 'project' ? projects.get(target.id) : customers.get(target.id);
    if (!targetRow) continue;
    const due = row.record['建议日期'];
    const status = followupStatus({ 下次跟进日期: due }, now);
    const customerId = customerOf(row, 'followup');
    tasks.push({ id: row.id, kind: 'followup', targetKind: target.kind, targetId: target.id,
      name: textValue(targetRow.record[titles[target.kind]]) || '未命名', customerId, customerName: nameOf(customerId),
      action: textValue(row.record['建议下一步行动']), people: people(row.record['建议处理人']),
      due: validWorkspaceTime(due) ? due : null, status: status.key,
      state: target.kind === 'project' ? projectFacts(targetRow, now).state : '', missing: status.key === 'unplanned' });
  }
  const rank: Record<string, number> = { overdue: 0, today: 1, tomorrow: 2, unplanned: 3, waiting: 4 };
  tasks.sort((a, b) => rank[a.status] - rank[b.status] || (a.due ?? Infinity) - (b.due ?? Infinity) || a.id.localeCompare(b.id));
  const latest = new Map<string, number>();
  // Include colleagues' project communication even in the personal workspace.
  for (const row of validFollowups) {
    const id = customerOf(row, 'followup');
    const time = row.record['实际发生时间'] as number;
    if (id) latest.set(id, Math.max(latest.get(id) ?? -Infinity, time));
  }
  const activeProjects = new Map<string, number>();
  for (const row of source.project) if (projectFacts(row, now).active) for (const id of linkIds(row.record['所属企业']))
    activeProjects.set(id, (activeProjects.get(id) || 0) + 1);
  const attention = scopedCustomers.flatMap(row => {
    const last = latest.get(row.id);
    const baseline = last ?? row.record['创建时间'];
    if (!validWorkspaceTime(baseline) || baseline > now) return [];
    const days = shanghaiDay(now) - shanghaiDay(baseline);
    return days >= 14 ? [{ id: row.id, name: textValue(row.record['企业全称']), lastAt: last ?? null, days, activeProjects: activeProjects.get(row.id) || 0 }] : [];
  }).sort((a, b) => b.days - a.days || a.id.localeCompare(b.id));
  const recent = [...scopedFollowups].sort((a, b) => Number(b.record['实际发生时间']) - Number(a.record['实际发生时间']) || a.id.localeCompare(b.id)).slice(0, 5).map(row => {
    const customerId = customerOf(row, 'followup'); const projectId = linkIds(row.record['关联项目'])[0];
    return { id: row.id, subject: textValue(row.record['内容 / 推进结论']).slice(0, 80), customerId, customerName: nameOf(customerId), projectId,
      projectName: textValue(projects.get(projectId)?.record['项目名称']), people: people(row.record['实际跟进人']), occurredAt: row.record['实际发生时间'] as number,
      conclusion: textValue(row.record['内容 / 推进结论']).slice(0, 240), nextAction: textValue(row.record['建议下一步行动']).slice(0, 160),
      attachmentCount: Array.isArray(row.record['附件']) ? row.record['附件'].length : 0 };
  });
  const totals = Object.fromEntries((['customer', 'project', 'followup'] as const).map(kind => [kind,
    { total: records[kind].length, monthNew: records[kind].filter(row => inMonth(row.record['创建时间'], now)).length }])) as WorkspaceData['totals'];
  const states: Record<string, number> = Object.fromEntries(projectStates.map(state => [state, 0]));
  let unknown = 0; let active = 0;
  for (const row of scopedProjects) {
    const fact = projectFacts(row, now);
    if (fact.active) active++;
    if (fact.state) states[fact.state]++; else unknown++;
  }
  const monthCompleted = scopedProjects.filter(row => projectFacts(row, now).state === '已签合同' && inMonth(row.record['签约日期'], now));
  const data: WorkspaceData = { scope, generatedAt: now, counts: {
    overdue: tasks.filter(row => row.status === 'overdue').length, today: tasks.filter(row => row.status === 'today').length,
    tomorrow: tasks.filter(row => row.status === 'tomorrow').length, missing: tasks.filter(row => row.missing).length,
  }, totals, project: { active, monthCompleted: monthCompleted.length, unknown, states }, tasks, recent, attention: attention.slice(0, 5), attentionTotal: attention.length };
  return { data, records, attentionIds: new Set(attention.map(row => row.id)), monthCompleted, now };
}

export function workspaceRecords(model: ReturnType<typeof workspaceModel>, kind: WorkspaceKind, filter: string): CrmRecord[] {
  const rows = model.records[kind];
  if (filter === 'all') return rows;
  if (filter === 'month') return rows.filter(row => inMonth(row.record['创建时间'], model.now));
  if (kind === 'customer' && filter === 'attention') return rows.filter(row => model.attentionIds.has(row.id));
  if (kind === 'project') {
    if (filter === 'completed-month') return model.monthCompleted;
    if (filter === 'active') return rows.filter(row => projectFacts(row, model.now).active);
    if ((projectStates as readonly string[]).includes(filter)) return rows.filter(row => projectFacts(row, model.now).state === filter);
    if (filter === 'unknown') return rows.filter(row => !projectFacts(row, model.now).state);
  }
  throw new Error('工作台筛选无效');
}

export function taskMatches(row: WorkspaceTask, filter: TaskFilter, now: number): boolean {
  if (filter === 'all') return true;
  if (filter === 'pending') return row.status !== 'overdue';
  if (filter === 'priority') return ['overdue', 'today', 'tomorrow'].includes(row.status);
  if (filter === 'missing') return row.missing;
  if (filter === 'other') return row.due === null || shanghaiDay(row.due) > shanghaiDay(now) + 1;
  if (filter === 'week') {
    const today = shanghaiDay(now); const monday = today - ((today + 3) % 7);
    return row.due !== null && shanghaiDay(row.due) >= monday && shanghaiDay(row.due) < monday + 7;
  }
  return row.status === filter;
}
