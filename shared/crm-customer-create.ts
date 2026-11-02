import { forms, type Draft } from './crm';
import { editFields, recordDraft, changedFields } from './crm-edit';
import { missingFields, requiredField } from './crm-interaction';
import type { EntityKind, WriteResult, CrmRecord, CrmPage, CrmEditRequest } from './api.interface';
export interface PendingContact { key: string; draft: Draft; original?: CrmRecord }
export interface CustomerSaveProgress { customer?: WriteResult; contacts: Record<string, WriteResult> }
/** Checkpoints prevent re-creating successful records on a known failed child write. */
export async function saveCustomerContacts(
  draft: Draft, contacts: PendingContact[], selected: string[], progress: CustomerSaveProgress,
  create: (kind: EntityKind, fields: Draft) => Promise<WriteResult>,
  existing?: { row: CrmRecord; edit: (kind: EntityKind, id: string, request: CrmEditRequest) => Promise<WriteResult> },
): Promise<WriteResult> {
  for (const contact of contacts.filter(c => selected.includes(c.key) && !progress.contacts[c.key] && contactDraftChanged(c))) {
    const errors = missingFields((contact.original ? editFields('contact') : forms.contact)
      .filter(f => f.key !== '所属企业').map(f => requiredField(f, 'contact', contact.original ? 'edit' : 'create', contact.draft)), contact.draft);
    if (Object.keys(errors).length) throw new Error(`${String(contact.draft['姓名'] || '联系人')}：${Object.values(errors).join('；')}`);
  }
  if (!progress.customer) {
    if (existing) {
      const changes = changedFields(recordDraft(existing.row.record, editFields('customer')), draft, editFields('customer'));
      progress.customer = Object.keys(changes).length
        ? await existing.edit('customer', existing.row.id, { changes, expectedModifiedAt: Number(existing.row.record['修改时间']) })
        : { id: existing.row.id, message: '客户资料未修改' };
    } else progress.customer = await create('customer', draft);
  }
  for (const contact of contacts) {
    if (!selected.includes(contact.key) || progress.contacts[contact.key]) continue;
    if (contact.original && existing) {
      const spec = editFields('contact');
      const changes = changedFields(recordDraft(contact.original.record, spec), contact.draft, spec);
      if (Object.keys(changes).length) progress.contacts[contact.key] = await existing.edit('contact', contact.original.id, {
        changes, expectedModifiedAt: Number(contact.original.record['修改时间']),
      });
      continue;
    }
    progress.contacts[contact.key] = await create('contact', {
      ...contact.draft, 所属企业: [progress.customer.id],
    });
  }
  return { id: progress.customer.id, message: '客户及联系人已保存' };
}

export function contactDraftChanged(contact: PendingContact): boolean {
  return !contact.original || Object.keys(changedFields(
    recordDraft(contact.original.record, editFields('contact')), contact.draft, editFields('contact'),
  )).length > 0;
}
export async function loadCustomerContactDrafts(customerId: string,
  read: (id: string, query: { cursor?: string }) => Promise<CrmPage>): Promise<PendingContact[]> {
  const rows = new Map<string, CrmRecord>();
  const cursors = new Set<string>();
  let cursor: string | undefined;
  do {
    const page = await read(customerId, { cursor });
    for (const row of page.records) rows.set(row.id, row);
    if (!page.hasMore) break;
    if (!page.pageToken || cursors.has(page.pageToken) || cursors.size >= 100)
      throw new Error('联系人列表未完整加载，请重试');
    cursor = page.pageToken; cursors.add(cursor);
  } while (cursor);
  return [...rows.values()].map(row => ({ key: row.id, original: row, draft: recordDraft(row.record, editFields('contact')) }));
}
