import { forms, type Draft } from './crm';
import { missingFields } from './crm-interaction';
import type { EntityKind, WriteResult } from './api.interface';
export interface PendingContact { key: string; draft: Draft }
export interface CustomerSaveProgress { customer?: WriteResult; contacts: Record<string, WriteResult> }
/** Checkpoints prevent re-creating successful records on a known failed child write. */
export async function saveCustomerContacts(
  draft: Draft, contacts: PendingContact[], selected: string[], progress: CustomerSaveProgress,
  create: (kind: EntityKind, fields: Draft) => Promise<WriteResult>,
): Promise<WriteResult> {
  for (const contact of contacts.filter(c => selected.includes(c.key) && !progress.contacts[c.key])) {
    const errors = missingFields(forms.contact.filter(f => f.key !== '所属企业'), contact.draft);
    if (Object.keys(errors).length) throw new Error(`${String(contact.draft['姓名'] || '联系人')}：${Object.values(errors).join('；')}`);
  }
  progress.customer ??= await create('customer', draft);
  for (const contact of contacts) {
    if (!selected.includes(contact.key) || progress.contacts[contact.key]) continue;
    progress.contacts[contact.key] = await create('contact', {
      ...contact.draft, 所属企业: [progress.customer.id],
    });
  }
  return { id: progress.customer.id, message: '客户及联系人已保存' };
}
