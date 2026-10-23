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
export interface CrmSummary {
  customer: number;
  contact: number;
  project: number;
  followup: number;
}
