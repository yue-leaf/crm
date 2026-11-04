export interface CrmMemberOption { id: string; name: string }
export type EntityKind =
  | 'customer'
  | 'contact'
  | 'project'
  | 'followup'
  | 'access';
export interface CrmRecord {
  id: string;
  record: Record<string, unknown>;
  followup?: FollowupChain;
}
export interface FollowupChain {
  state: '待跟进' | '已跟进' | '无需跟进' | '已结束' | '已作废' | '待核对';
  previousId?: string;
  nextIds: string[];
}
export interface PendingFollowupsQuery { customerId?: string; projectId?: string }
export interface EndFollowupRequest { expectedModifiedAt: number; 结束跟进说明?: string }
export interface CrmPage {
  records: CrmRecord[];
  hasMore: boolean;
  pageToken?: string;
  total?: number;
}
export interface CustomerContactsQuery {
  cursor?: string;
  search?: string;
}
export type FollowupScope = 'all' | 'direct' | 'project';
export interface RelatedRecordsQuery {
  status?: 'all' | 'pending';
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
  roles?: string[];
  isEmployee?: boolean;
}
export interface NotificationSettings {
  enabled: boolean;
  sendTime: string;
  recipientIds: string[];
  revision: number;
  nextAt: string;
}
export interface NotificationSettingsUpdate {
  enabled: boolean;
  sendTime: string;
  recipientIds: string[];
  revision: number;
}
export interface NotificationPreview {
  day: string;
  overdueCount: number;
  todayCount: number;
  tomorrowCount: number;
  otherCount: number;
  title: string;
  content: string;
}
export interface NotificationLog {
  id: string;
  day: string;
  recipientId: string | null;
  mode: string;
  status: string;
  detail: string;
  overdueCount: number | null;
  todayCount: number;
  tomorrowCount: number;
  otherCount: number | null;
  updatedAt: string;
}
export interface NotificationState {
  settings: NotificationSettings;
  logs: NotificationLog[];
}
export type DeleteKind = 'customer' | 'project' | 'followup';
export interface DeletionPreview {
  id: string;
  kind: DeleteKind;
  name: string;
  counts: Record<'customer' | 'project' | 'contact' | 'followup', number>;
  restoresPending: number;
  summary: string;
  status: 'preview' | 'running' | 'paused' | 'complete';
  deleted: number;
  total: number;
  message: string;
}
export interface WriteResult {
  id: string;
  message: string;
  warning?: string;
}
export interface CrmEditRequest {
  changes: Record<string, string | string[] | number | boolean | null>;
  reason?: string;
  expectedModifiedAt: number;
}
export interface CrmProgressRequest {
  工作状态: '待启动' | '进行中' | '暂停' | '已签合同';
  签约日期?: string;
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
  终局确认?: '已取消';
  结束日期?: string;
  结果说明?: string;
  取消原因?: string;
  工作状态?: '待启动' | '进行中' | '暂停' | '已签合同';
  签约日期?: string;
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
export type FollowupStatus = 'waiting' | 'tomorrow' | 'today' | 'overdue' | 'unplanned' | 'none';
export type FollowupFilter = 'all' | FollowupStatus;
export interface BusinessListQuery {
  customerId?: string;
  projectId?: string;
  scope?: ProjectScope;
  projectFilter?: ProjectFilter;
  followupFilter?: FollowupFilter;
}
export type ProjectFilter = FollowupFilter | 'active' | 'attention' | 'month-completed' | 'missing-plan' | '待启动' | '进行中' | '暂停' | '已签合同' | '已取消';
export interface ProjectOverview {
  scope: ProjectScope;
  generatedAt: number;
  total: number;
  active: number;
  attention: number;
  monthCompleted: number;
  overdue: number;
  missingPlan: number;
  today: number;
  tomorrow: number;
  unknown: number;
  states: Record<'待启动' | '进行中' | '暂停' | '已签合同' | '已取消', number>;
  projects: CrmRecord[];
}
