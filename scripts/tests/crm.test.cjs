// Offline boundary tests. No network, credentials or simulated runtime login.
const { test } = require('node:test');
const assert = require('node:assert/strict');
require('reflect-metadata');
const {
  parseDraft,
  dateMillis,
} = require('../../dist/server/modules/crm/crm-validation.js');
const {
  CrmCapabilityGuard,
} = require('../../dist/server/modules/crm/crm-capability.guard.js');
const {
  CrmController,
} = require('../../dist/server/modules/crm/crm.controller.js');
const { CrmService } = require('../../dist/server/modules/crm/crm.service.js');

test('reject system fields, invalid options and missing mandatory fields', () => {
  const spec = [
    { key: 'name', type: 'text', required: true },
    { key: 'state', type: 'select', options: ['valid'] },
  ];
  assert.throws(() => parseDraft({ name: 'A', 核查标记: '正常' }, spec, {}));
  assert.throws(() => parseDraft({ name: 'A', state: 'invalid' }, spec, {}));
  assert.throws(() => parseDraft({}, spec, {}));
});
test('dates are real Shanghai calendar dates and timestamps', () => {
  assert.equal(
    dateMillis('2024-02-29', 'date'),
    Date.parse('2024-02-29T00:00:00+08:00'),
  );
  for (const value of ['2025-02-29', '2026-04-31'])
    assert.throws(() => dateMillis(value, 'date'));
  for (const value of ['2026-10-24T24:00', '2026-10-24T12:60'])
    assert.throws(() => dateMillis(value, 'date', true));
});
test('person identifiers preserve precision and relation writes use SDK string arrays', () => {
  const spec = [
    { key: 'person', type: 'person' },
    { key: 'relation', type: 'relation' },
  ];
  assert.deepEqual(
    parseDraft(
      { person: ['1878742870963257'], relation: ['recTest'] },
      spec,
      {},
    ).fields,
    { person: [1878742870963257], relation: ['recTest'] },
  );
  assert.throws(() => parseDraft({ person: ['9007199254740993'] }, spec, {}));
  assert.throws(() => parseDraft({ person: ['1', '2'] }, spec, {}));
  assert.throws(() =>
    parseDraft({ relation: ['recTest', 'recTest'] }, spec, {}),
  );
});
test('amount rejects negative, fractional cents and unsafe precision', () => {
  const spec = [{ key: 'amount', type: 'number' }];
  for (const amount of [-1, 0.001, Infinity, Number.MAX_SAFE_INTEGER])
    assert.throws(() => parseDraft({ amount }, spec, {}));
  assert.equal(parseDraft({ amount: 12.34 }, spec, {}).fields.amount, 12.34);
});
test('raw capability controllers are denied independently of encoded URL path', () => {
  const guard = new CrmCapabilityGuard();
  const ctx = (path, name) => ({
    switchToHttp: () => ({ getRequest: () => ({ path }) }),
    getClass: () => ({ name }),
  });
  for (const [path, name] of [
    ['/app/a/api/capability/x', 'Unknown'],
    ['/app/a/__innerapi__/capability/x', 'Unknown'],
    ['/%61pi/capability/x', 'WebhookController'],
    ['/anything', 'DebugController'],
  ]) {
    assert.throws(
      () => guard.canActivate(ctx(path, name)),
      (e) => e.getStatus() === 403,
    );
  }
  assert.equal(
    guard.canActivate(ctx('/api/crm/records/customer', 'CrmController')),
    true,
  );
});
test('all business controller methods reject absent or non-admin roles before calling service', () => {
  const c = new CrmController(
    new Proxy(
      {},
      { get: () => () => assert.fail('service must not be reached') },
    ),
  );
  for (const roles of [undefined, [], ['employee']]) {
    const req = { userContext: { userId: 'test-only', roles } };
    for (const invoke of [
      () => c.summary(req),
      () => c.list(req, 'customer'),
      () => c.detail(req, 'customer', 'recTest'),
      () => c.create(req, 'customer', {}),
      () => c.update(req, 'customer', 'recTest', 'plan', {}),
    ])
      assert.throws(invoke, (e) => e.getStatus() === 403);
  }
});
test('review revalidates existing contact facts before issuing any write', async () => {
  const row = {
    id: 'recContact',
    record: {
      姓名: { text: 'Example' },
      职务: { text: 'Engineer' },
      所属企业: { link_record_ids: ['recCompany'] },
      维护人: [123],
      修改时间: 1,
      核查标记: '待核查',
      邮箱: { text: 'invalid' },
    },
  };
  let calls = 0;
  const cap = {
    getCapability: () => ({ formValue: { fields: [] } }),
    load: () => ({
      call: async (action) => {
        calls++;
        assert.equal(action, 'getRecord');
        return row;
      },
    }),
  };
  const service = new CrmService(cap);
  await assert.rejects(
    () =>
      service.update(
        'contact',
        'recContact',
        'review',
        { expectedModifiedAt: 1, 核查说明: 'review' },
        'test-only',
      ),
    /邮箱/,
  );
  assert.equal(calls, 1);
  delete row.record.邮箱;
  await assert.rejects(
    () =>
      service.update(
        'contact',
        'recContact',
        'review',
        { expectedModifiedAt: 1, 核查说明: 'review' },
        'test-only',
      ),
    /联系方式/,
  );
  assert.equal(calls, 2);
});
