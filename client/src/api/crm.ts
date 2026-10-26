import { isAxiosError } from 'axios';
import { axiosForBackend } from '@lark-apaas/client-toolkit/utils/getAxiosForBackend';
import type {
  CrmPage,
  CrmRecord,
  CrmSession,
  CrmSummary,
  EntityKind,
  WriteResult,
  CrmEditRequest,
  ProjectOverview,
  ProjectScope,
  ProjectFilter,
  CustomerContactsQuery,
  RelatedRecordsQuery,
  FollowupPage,
} from '@shared/api.interface';
import type { Draft } from '@shared/crm';
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
      throw new Error(r.data?.error?.message || '当前账号尚未获得所需权限，请联系管理员');
    if (r.status >= 500 && method !== 'GET')
      throw new SaveOutcomeUnknown(r.data?.error?.message || '保存结果未确认，请关闭窗口并刷新核对，避免重复提交');
    if (r.status >= 400)
      throw new Error(r.data?.error?.message || '操作未完成');
    return r.data as T;
  } catch (e: unknown) {
    if (isAxiosError(e)) {
      if (method !== 'GET' && (!e.response || e.response.status >= 500))
        throw new SaveOutcomeUnknown(e.response?.data?.error?.message || '保存结果未确认，请关闭窗口并刷新核对，避免重复提交');
      throw new Error(
        e.response?.status === 403
          ? e.response?.data?.error?.message || '当前账号尚未获得所需权限，请联系管理员'
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
  customerProjects: (customerId: string, query: RelatedRecordsQuery = {}) =>
    request<CrmPage>(`customers/${encodeURIComponent(customerId)}/projects?${new URLSearchParams({ cursor: query.cursor || '', search: query.search || '' })}`),
  relatedFollowups: (kind: 'customer' | 'project', id: string, query: RelatedRecordsQuery = {}) =>
    request<FollowupPage>(`${kind === 'customer' ? 'customers' : 'projects'}/${encodeURIComponent(id)}/followups?${new URLSearchParams({ cursor: query.cursor || '', search: query.search || '', scope: query.scope || 'all' })}`),
  customerContacts: (customerId: string, query: CustomerContactsQuery = {}) =>
    request<CrmPage>(`customers/${encodeURIComponent(customerId)}/contacts?${new URLSearchParams({ cursor: query.cursor || '' })}`),
  session: () => request<CrmSession>('session'),
  summary: () => request<CrmSummary>('summary'),
  overview: (scope: ProjectScope) => request<ProjectOverview>(`overview?scope=${scope}`),
  list: (kind: EntityKind, cursor = '', search = '', project?: { scope: ProjectScope; projectFilter: ProjectFilter }) =>
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
