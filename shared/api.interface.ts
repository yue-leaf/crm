export type EntityKind =
  | 'customer'
  | 'contact'
  | 'project'
  | 'followup'
  | 'access';
export interface CrmRecord {
  id: string;
  record: Record<string, unknown>;
}
export interface CrmPage {
  records: CrmRecord[];
  hasMore: boolean;
  pageToken?: string;
  total?: number;
}
export interface CustomerContactsQuery {
  cursor?: string;
}
export type FollowupScope = 'all' | 'direct' | 'project';
export interface RelatedRecordsQuery {
  cursor?: string;
  search?: string;
  scope?: FollowupScope;
}
export interface RelatedSource {
  kind: 'customer' | 'project';
  id: string;
  name: string;
}
export interface FollowupPage extends CrmPage {
  sources: Record<string, RelatedSource>;
}
export interface CrmSession {
  userId: string;
  name: string;
  roles: string[];
}
export interface WriteResult {
  id: string;
  message: string;
}
export interface CrmEditRequest {
  changes: Record<string, string | string[] | number | boolean | null>;
  reason: string;
  expectedModifiedAt: number;
}
export interface CrmProgressRequest {
  工作状态: '待启动' | '进行中' | '暂停';
  当前进展: string;
  暂停原因?: string | null;
  当前下一步行动?: string | null;
  下次跟进日期?: string | null;
  行动执行人?: string[] | null;
  变更说明: string;
  expectedModifiedAt: number;
}
export type CrmLifecycleOperation = 'confirm-end' | 'archive' | 'restore' | 'reopen';
export interface CrmLifecycleRequest {
  expectedModifiedAt: number;
  操作原因: string;
  终局确认?: '已完成' | '已取消';
  结束日期?: string;
  结果说明?: string;
  取消原因?: string;
  工作状态?: '待启动' | '进行中';
  当前进展?: string;
  当前下一步行动?: string;
  行动执行人?: string[];
  下次跟进日期?: string;
}
export interface CrmSummary {
  customer: number;
  contact: number;
  project: number;
  followup: number;
}
export type ProjectScope = 'all' | 'mine';
export type ProjectFilter = 'all' | 'active' | 'attention' | 'month-completed' | 'overdue' | 'missing-plan' | 'review' | '待启动' | '进行中' | '暂停' | '已完成' | '已取消' | 'archived';
export interface ProjectOverview {
  scope: ProjectScope;
  generatedAt: number;
  total: number;
  active: number;
  attention: number;
  monthCompleted: number;
  overdue: number;
  missingPlan: number;
  review: number;
  archived: number;
  unknown: number;
  states: Record<'待启动' | '进行中' | '暂停' | '已完成' | '已取消', number>;
  projects: CrmRecord[];
}
