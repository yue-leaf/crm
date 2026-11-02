const { test } = require('node:test');
const assert = require('node:assert/strict');
const { saveCustomerContacts } = require('../../dist/shared/crm-customer-create');
const contacts = ['a', 'b', 'c'].map(key => ({ key, draft: { 姓名: key, 职务: 'Engineer', 电话: '123', 所属企业: ['recWrong'] } }));
test('customer contacts: selected multiple contacts inherit new customer; unchecked contacts never written', async () => {
  const calls = []; const progress = { contacts: {} };
  const result = await saveCustomerContacts({ 企业全称: 'New' }, contacts, ['a', 'c'], progress, async (kind, fields) => {
    calls.push({ kind, fields }); return { id: kind === 'customer' ? 'recNew' : 'rec' + fields['姓名'], message: 'ok' };
  });
  assert.equal(result.id, 'recNew'); assert.equal(calls.length, 3);
  assert.deepEqual(calls.slice(1).map(c => c.fields['所属企业']), [['recNew'], ['recNew']]);
  assert.deepEqual(calls.slice(1).map(c => c.fields['姓名']), ['a', 'c']);
});
test('customer contacts: retry only failed contact, preserves customer and successful contacts', async () => {
  const calls = []; const progress = { contacts: {} }; let fail = true;
  const create = async (kind, fields) => {
    calls.push(kind + ':' + (fields['姓名'] || ''));
    if (fields['姓名'] === 'b' && fail) { fail = false; throw new Error('validation'); }
    return { id: kind === 'customer' ? 'recNew' : 'rec' + fields['姓名'], message: 'ok' };
  };
  await assert.rejects(saveCustomerContacts({}, contacts, ['a', 'b'], progress, create));
  assert.equal(progress.customer.id, 'recNew');
  await saveCustomerContacts({}, contacts, ['a', 'b'], progress, create);
  assert.deepEqual(calls, ['customer:', 'contact:a', 'contact:b', 'contact:b']);
});
test('customer contacts: preflight validates all selected drafts before creating customer', async () => {
  let writes = 0;
  await assert.rejects(saveCustomerContacts({}, [{ key: 'a', draft: { 姓名: 'a' } }], ['a'], { contacts: {} }, async () => { writes++; }));
  assert.equal(writes, 0);
});
test('editing customer preserves unchanged contacts, updates changed contacts and adds only new ones', async () => {
  const { recordDraft, editFields } = require('../../dist/shared/crm-edit');
  const original = { id: 'recOld', record: { 姓名: 'Old', 职务: 'Engineer', 电话: '123', 联系人状态: '有效', 修改时间: 123 } };
  const old = { key: original.id, original, draft: recordDraft(original.record, editFields('contact')) };
  const row = { id: 'recCustomer', record: { 企业全称: 'Existing', 行业: '化工', 地区: '上海', 修改时间: 456 } };
  const draft = recordDraft(row.record, editFields('customer'));
  const creates = [], edits = [];
  const create = async (kind, fields) => { creates.push({ kind, fields }); return { id: 'recNew', message: 'ok' }; };
  const edit = async (kind, id, request) => { edits.push({kind,id,request}); return { id, message:'ok' }; };
  await saveCustomerContacts(draft, [old, contacts[0]], [old.key, 'a'], { contacts:{} }, create, {row,edit});
  assert.equal(edits.length,0); assert.equal(creates.length,1); assert.deepEqual(creates[0].fields['所属企业'],['recCustomer']);
  old.draft['电话']='456';
  await saveCustomerContacts(draft, [old], [old.key], {contacts:{}}, create, {row,edit});
  assert.equal(edits.length,1); assert.equal(edits[0].kind,'contact'); assert.equal(edits[0].request.expectedModifiedAt,123);
  assert.deepEqual(edits[0].request.changes, {电话:'456'});
});
test('edit contact loading includes all pages and rejects partial/repeated pagination', async () => {
  const { loadCustomerContactDrafts } = require('../../dist/shared/crm-customer-create');
  const loaded = await loadCustomerContactDrafts('recCustomer', async (_, {cursor}) => cursor
    ? {records:[{id:'recB',record:{姓名:'B'}}],hasMore:false}
    : {records:[{id:'recA',record:{姓名:'A'}}],hasMore:true,pageToken:'next'});
  assert.deepEqual(loaded.map(c=>c.key),['recA','recB']);
  await assert.rejects(loadCustomerContactDrafts('recCustomer',async()=>({records:[],hasMore:true,pageToken:'same'})));
});
