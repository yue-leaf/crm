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
