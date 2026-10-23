import { isAxiosError } from 'axios';
import { axiosForBackend } from '@lark-apaas/client-toolkit/utils/getAxiosForBackend';
import type {
  CrmPage,
  CrmRecord,
  CrmSession,
  CrmSummary,
  EntityKind,
  WriteResult,
} from '@shared/api.interface';
import type { Draft } from '@shared/crm';
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
      throw new Error('当前账号尚未获得 CRM 管理员权限，请联系管理员');
    if (r.status >= 400)
      throw new Error(r.data?.error?.message || '操作未完成');
    return r.data as T;
  } catch (e: unknown) {
    if (isAxiosError(e))
      throw new Error(
        e.response?.status === 403
          ? '当前账号尚未获得 CRM 管理员权限，请联系管理员'
          : e.response?.data?.error?.message ||
            (method === 'GET'
              ? '数据加载失败，请稍后重试'
              : '保存结果未确认，请刷新核对后再操作'),
      );
    throw e;
  }
}
export const api = {
  session: () => request<CrmSession>('session'),
  summary: () => request<CrmSummary>('summary'),
  list: (kind: EntityKind, cursor = '', search = '') =>
    request<CrmPage>(
      `records/${kind}?${new URLSearchParams({ cursor, search })}`,
    ),
  get: (kind: EntityKind, id: string) =>
    request<CrmRecord>(`records/${kind}/${encodeURIComponent(id)}`),
  create: (kind: EntityKind, draft: Draft) =>
    request<WriteResult>(`records/${kind}`, 'POST', draft),
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
