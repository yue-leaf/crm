require('reflect-metadata');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { CrmService } = require('../../dist/server/modules/crm/crm.service.js');
const { prepareEdit } = require('../../dist/server/modules/crm/crm-edit.js');

test('customer without owner saves and reads back without invoking identity mapping', async () => {
  let stored;
  const service = new CrmService({
    getCapability: () => ({ formValue: { fields: [] } }),
    load: () => ({ call: async (action, input) => {
      if (action === 'batchAddRecords') {
        stored = { id: 'recOwnerOptional', record: input.records[0].record };
        return { records: [stored] };
      }
      throw Error(`Unexpected action: ${action}`);
    } }),
  }, { getBatchLarkUserIds: async () => assert.fail('empty owner must not require employee conversion') });
  service.get = async () => stored;
  for (const owner of [undefined, [], null]) {
    const body = { 企业全称: 'Example', 行业: '材料', 地区: '上海' };
    if (owner !== undefined) body.客户负责人 = owner;
    assert.equal((await service.create('customer', body)).id, 'recOwnerOptional');
    assert.equal(Object.hasOwn(stored.record, '客户负责人'), false);
  }
});

test('customer owner may be cleared and assigned later without losing other fields', () => {
  const row = { id: 'recCustomer', record: { 企业全称: 'Example', 行业: '材料', 地区: '上海', 客户负责人: [123] } };
  const cleared = prepareEdit('customer', row, { changes: { 客户负责人: [] } }, {}, '123');
  assert.deepEqual(cleared.writes.客户负责人, []);
  assert.equal(Object.hasOwn(cleared.writes, '企业全称'), false);
  const assigned = prepareEdit('customer', { ...row, record: { ...row.record, 客户负责人: [] } },
    { changes: { 客户负责人: ['456'] } }, {}, '123');
  assert.deepEqual(assigned.writes.客户负责人, [456]);
});
