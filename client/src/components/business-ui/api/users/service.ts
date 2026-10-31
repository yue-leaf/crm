import {
  UserService,
  type AccountType,
  type SearchUsersParams,
  type SearchUsersResponse,
  type BatchGetUsersResponse,
  type ConvertExternalContactResponse,
} from '@lark-apaas/client-toolkit/tools/services';
import { employeeOptions } from '@shared/crm-people';

const userService = new UserService();

/**
 * 搜索用户
 */
export async function searchUsers(
  params: SearchUsersParams,
): Promise<SearchUsersResponse> {
  const response = await userService.searchUsers({ ...params, searchExternalContact: false });
  // CRM person fields represent employees. Keep external identities available
  // for historical display via listUsersByIds, but never offer them for selection.
  if (response.data?.userList) response.data.userList = employeeOptions(response.data.userList);
  return response;
}

/**
 * 批量根据用户 ID 查询用户信息
 */
export async function listUsersByIds(
  userIds: string[],
): Promise<BatchGetUsersResponse> {
  const numericIds = userIds.filter((id) => !isNaN(Number(id)));
  return userService.listUsersByIds(numericIds);
}

/**
 * 调用开户接口，将外部联系人的 larkUserID 转换为已注册用户
 */
export async function convertExternalContact(
  larkUserID: string,
): Promise<ConvertExternalContactResponse> {
  return userService.convertExternalContact(larkUserID);
}

export type { AccountType, SearchUsersParams, SearchUsersResponse, BatchGetUsersResponse, ConvertExternalContactResponse };
