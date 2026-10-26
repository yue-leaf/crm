require('reflect-metadata');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { CrmService } = require('../../dist/server/modules/crm/crm.service.js');
const { CrmController } = require('../../dist/server/modules/crm/crm.controller.js');
const { parseDraft } = require('../../dist/server/modules/crm/crm-validation.js');
const { forms } = require('../../dist/shared/crm.js');
const { relatedDraft } = require('../../dist/shared/crm-workflow.js');
const customer = { id: 'recCustomer', record: { 企业全称: { text: '客户 A' } } };
const contact = { id: 'recPerson', record: { 姓名: { text: '张三' }, 所属企业: { link_record_ids: [customer.id] } } };
function service(page) {
  return new CrmService({ load: name => ({ call: async (action, input) => {
    if (action === 'getRecord') { assert.equal(name, 'crm-customer'); assert.equal(input.recordID, customer.id); return customer; }
    assert.equal(name, 'crm-contact'); assert.equal(action, 'searchRecords');
    assert.deepEqual(input.filter, { conjunction: 'and', conditions: [{ fieldName: '所属企业', operator: 'contains', value: [customer.id] }] });
    return page(input);
  } }) });
}
test('customer contacts query filters by exact relation ID and preserves pagination', async () => {
  const s = service(input => ({ records: [contact], hasMore: !input.pageToken, ...(!input.pageToken ? { pageToken: 'next' } : {}) }));
  const first = await s.customerContacts(customer.id); assert.equal(first.records[0].id, contact.id);
  assert.equal(first.pageToken, 'next'); assert.equal((await s.customerContacts(customer.id, 'next')).hasMore, false);
});
test('customer contacts includes pending/inactive history; empty customers remain empty', async () => {
  const pending = { ...contact, record: { ...contact.record, 核查标记: '待核查', 联系人状态: '停用' } };
  assert.equal((await service(() => ({ records: [pending], hasMore: false })).customerContacts(customer.id)).records.length, 1);
  assert.deepEqual((await service(() => ({ records: [], hasMore: false })).customerContacts(customer.id)).records, []);
});
test('rejects wrong customer, malformed ID/cursor and broken pagination', async () => {
  const bad = { ...contact, record: { 所属企业: { link_record_ids: ['recOther'] } } };
  await assert.rejects(() => service(() => ({ records: [bad], hasMore: false })).customerContacts(customer.id), /归属/);
  const s = service(() => ({ records: [], hasMore: true }));
  await assert.rejects(() => s.customerContacts('invalid'), /标识/);
  await assert.rejects(() => s.customerContacts(customer.id, {}), /分页/);
  await assert.rejects(() => s.customerContacts(customer.id), /分页/);
});
test('employee/admin can read customer contacts; anonymous/unassigned roles cannot', async () => {
  const roles = ['crm_admin', 'crm_employee'];
  const c = new CrmController(service(() => ({ records: [], hasMore: false })));
  for (const role of roles) await c.customerContacts({ userContext: { userId: '123', roles: [role] } }, customer.id);
  for (const context of [undefined, { userId: '123', roles: [] }]) assert.throws(() => c.customerContacts({ userContext: context }, customer.id), e => e.getStatus() === 403);
});
test('contact create requires exactly one customer and customer detail presets it', () => {
  const draft = { 姓名: '张三', 职务: '经理', 电话: '13800000000', 维护人: ['123'] };
  for (const value of [undefined, [], ['recA', 'recB'], ['invalid']]) assert.throws(() => parseDraft({ ...draft, 所属企业: value }, forms.contact, {}), /所属企业/);
  const preset = relatedDraft('customer', customer, 'contact');
  assert.deepEqual(preset['所属企业'], [customer.id]);
  assert.deepEqual(parseDraft({ ...draft, ...preset }, forms.contact, {}).fields['所属企业'], [customer.id]);
});
