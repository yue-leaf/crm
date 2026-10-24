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
export interface CrmSummary {
  customer: number;
  contact: number;
  project: number;
  followup: number;
}
