import { isAxiosError } from 'axios';
import { axiosForBackend } from '@lark-apaas/client-toolkit/utils/getAxiosForBackend';
import type {
  CrmPage,
  CustomerGeoData,
  CrmMemberOption,
  CrmRecord,
  CrmSession,
  CrmSummary,
  EntityKind,
  WriteResult,
  CrmEditRequest,
  ProjectOverview,
  ProjectScope,
  BusinessListQuery,
  CustomerContactsQuery,
  RelatedRecordsQuery,
  FollowupPage,
  NotificationState, NotificationTestResult, NotificationPreview, NotificationSettings, NotificationSettingsUpdate,
  DeletionPreview, DeleteKind,
} from '@shared/api.interface';
import type { Draft } from '@shared/crm';
import type { WorkspaceData, WorkspaceKind } from '@shared/crm-workspace';
import { RecordPageChanged } from '@shared/crm-navigation';
export class SaveOutcomeUnknown extends Error {}
async function request<T>(
  url: string,
  method: 'GET' | 'POST' | 'PATCH' = 'GET',
  data?: unknown,
): Promise<T> {
  try {
    const r = await axiosForBackend({
      url: `/api/crm/${url}`,
      method,
      data,
      timeout: 45000,
    });
    if (r.status === 403)
      throw new Error(r.data?.error?.message || '当前操作未获允许，请核对企业登录身份');
    if (r.status >= 500 && method !== 'GET')
      throw new SaveOutcomeUnknown(r.data?.error?.message || '保存结果未确认，请关闭窗口并刷新核对，避免重复提交');
    if (r.status === 409 && method === 'GET')
      throw new RecordPageChanged(r.data?.error?.message || '列表已变化，请刷新');
    if (r.status >= 400)
      throw new Error(r.data?.error?.message || '操作未完成');
    return r.data as T;
  } catch (e: unknown) {
    if (isAxiosError(e)) {
      if (method !== 'GET' && (!e.response || e.response.status >= 500))
        throw new SaveOutcomeUnknown(e.response?.data?.error?.message || '保存结果未确认，请关闭窗口并刷新核对，避免重复提交');
      if (method === 'GET' && e.response?.status === 409)
        throw new RecordPageChanged(e.response.data?.error?.message || '列表已变化，请刷新');
      throw new Error(
        e.response?.status === 403
          ? e.response?.data?.error?.message || '当前操作未获允许，请核对企业登录身份'
          : e.response?.data?.error?.message ||
            (method === 'GET'
              ? '数据加载失败，请稍后重试'
              : '保存结果未确认，请刷新核对后再操作'),
      );
    }
    throw e;
  }
}
export const api = {
  customerGeography: () => request<CustomerGeoData>('customers/geography'),
  deletionPreview: (kind: DeleteKind, id: string) => request<DeletionPreview>('deletions/preview','POST',{kind,id}),
  deletionStep: (id: string) => request<DeletionPreview>(`deletions/${id}/step`,'POST'),
  deletionInspect: (id: string) => request<DeletionPreview>(`deletions/${id}`),
  deletionPending: () => request<DeletionPreview[]>('deletions'),
  pendingFollowups: (customerId = '', projectId = '') => request<CrmPage>(`followups/pending?${new URLSearchParams({ customerId, projectId })}`),
  members: () => request<CrmMemberOption[]>('members'),
  notificationState: () => request<NotificationState>('notifications'),
  notificationSave: (value: NotificationSettingsUpdate) => request<NotificationSettings>('notifications', 'PATCH', value),
  notificationPreview: () => request<NotificationPreview>('notifications/preview'),
  notificationTest: (requestId: string) => request<NotificationTestResult>('notifications/test', 'POST', { requestId }),
  workspace: (scope: ProjectScope) => request<WorkspaceData>(`workspace?scope=${scope}`),
  workspaceRecords: (scope: ProjectScope, kind: WorkspaceKind, filter: string, cursor = '', search = '') =>
    request<CrmPage>(`workspace/records?${new URLSearchParams({ scope, kind, filter, cursor, search })}`),
  customerProjects: (customerId: string, query: RelatedRecordsQuery = {}) =>
    request<CrmPage>(`customers/${encodeURIComponent(customerId)}/projects?${new URLSearchParams({ cursor: query.cursor || '', search: query.search || '' })}`),
  relatedFollowups: (kind: 'customer' | 'project', id: string, query: RelatedRecordsQuery = {}) =>
    request<FollowupPage>(`${kind === 'customer' ? 'customers' : 'projects'}/${encodeURIComponent(id)}/followups?${new URLSearchParams({ cursor: query.cursor || '', search: query.search || '', scope: query.scope || 'all', status: query.status || 'all' })}`),
  customerContacts: (customerId: string, query: CustomerContactsQuery = {}) =>
    request<CrmPage>(`customers/${encodeURIComponent(customerId)}/contacts?${new URLSearchParams({ cursor: query.cursor || '', search: query.search || '' })}`),
  session: () => request<CrmSession>('session'),
  summary: () => request<CrmSummary>('summary'),
  overview: (scope: ProjectScope) => request<ProjectOverview>(`overview?scope=${scope}`),
  list: (kind: EntityKind, cursor = '', search = '', project?: BusinessListQuery) =>
    request<CrmPage>(
      `records/${kind}?${new URLSearchParams({ cursor, search, ...project })}`,
    ),
  get: (kind: EntityKind, id: string) =>
    request<CrmRecord>(`records/${kind}/${encodeURIComponent(id)}`),
  create: (kind: EntityKind, draft: Draft) =>
    request<WriteResult>(`records/${kind}`, 'POST', draft),
  edit: (kind: EntityKind, id: string, input: CrmEditRequest) =>
    request<WriteResult>(
      `records/${kind}/${encodeURIComponent(id)}/edit`,
      'PATCH',
      input,
    ),
  update: (
    kind: EntityKind,
    id: string,
    operation: string,
    draft: Draft,
    expectedModifiedAt: number,
  ) =>
    request<WriteResult>(
      `records/${kind}/${encodeURIComponent(id)}/${operation}`,
      'PATCH',
      { ...draft, expectedModifiedAt },
    ),
};
