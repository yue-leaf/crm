require('reflect-metadata');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { CrmController } = require('../../dist/server/modules/crm/crm.controller.js');
const { CrmService } = require('../../dist/server/modules/crm/crm.service.js');
const spec = [{ key: '客户负责人', type: 'person', multiple: true }];

test('new employee can select verified self without secondary employee mapping', async () => {
  const service = new CrmService({}, { getBatchLarkUserIds: async () => assert.fail('self must not depend on secondary mapping') });
  await service.people({ 客户负责人: [123] }, spec, false, '123');
});

test('verified self never exempts another selected person', async () => {
  const batches = [];
  const service = new CrmService({}, { getBatchLarkUserIds: async ids => { batches.push(ids); return ids.map(() => null); } });
  await assert.rejects(service.people({ 客户负责人: [123, 456] }, spec, false, '123'), /无法核验/);
  assert.deepEqual(batches, [['456']]);
});

test('controller only trusts a tenant employee gateway context, not body or roles', () => {
  const calls = [];
  const controller = new CrmController({ create: (...args) => calls.push(args), update: (...args) => calls.push(args) });
  for (const context of [{}, { userType: '_externalUser', tenantId: 1 }, { userType: '_employee' }]) {
    controller.create({ userContext: { userId: '123', roles: ['crm_admin'], ...context } }, 'customer', { verifiedEmployeeId: '123' });
    assert.equal(calls.at(-1)[2], undefined);
  }
  const req = { userContext: { userId: '123', userType: '_employee', tenantId: 1 } };
  controller.create(req, 'customer', {});
  assert.equal(calls.at(-1)[2], '123');
  controller.update(req, 'customer', 'rec1', 'edit', {});
  assert.equal(calls.at(-1)[5], '123');
});
