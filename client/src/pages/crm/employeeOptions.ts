import { api } from '@/api/crm';
import type { UserSelectItemValue } from '@/components/business-ui/user-select/types';
/** Use the full CRM member directory, including when the search box is empty. */
export async function loadEmployeeOptions(search: string): Promise<UserSelectItemValue[]> {
  const members = await api.members();
  const query = search.trim().toLocaleLowerCase();
  return members.filter(member => !query || member.name.toLocaleLowerCase().includes(query))
    .map(member => ({ id: member.id, name: member.name,
      raw: { user_id: member.id, name: member.name } }));
}
