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
const { prepareEdit } = require('../../dist/server/modules/crm/crm-edit.js');
const {
  recordDraft,
  changedFields,
  editFields,
} = require('../../dist/shared/crm-edit.js');

test('reject system fields, invalid options and missing mandatory fields', () => {
  const spec = [
    { key: 'name', type: 'text', required: true },
    { key: 'state', type: 'select', options: ['valid'] },
  ];
  assert.throws(() => parseDraft({ name: 'A', 核查标记: '正常' }, spec, {}));
  assert.throws(() => parseDraft({ name: 'A', state: 'invalid' }, spec, {}));
  assert.throws(() => parseDraft({}, spec, {}));
});

const editableCustomer = () => ({
  id: 'recCompany',
  record: {
    企业全称: { text: 'Example' },
    行业: '其他化学制药',
    地区: { text: '上海' },
    客户负责人: [123],
    客户关系状态: '待建立',
    客户备注: { text: 'old' },
    核查标记: '正常',
    核查说明: { text: '原核查历史' },
    已归档: false,
  },
});
test('edit writes only changed fields, clears text and retains prior audit history', () => {
  const row = editableCustomer();
  const result = prepareEdit(
    'customer',
    row,
    { changes: { 地区: '北京', 客户备注: '' }, reason: '更新资料' },
    {},
    'unit-test',
  );
  assert.deepEqual(
    Object.keys(result.writes).sort(),
    ['地区', '客户备注', '核查标记', '核查说明'].sort(),
  );
  assert.equal(result.writes.客户备注, '');
  assert.equal(result.writes.核查标记, '待核查');
  assert.match(result.writes.核查说明, /原核查历史/);
  assert.match(result.writes.核查说明, /更新资料/);
  assert.equal(result.draft.企业全称, 'Example');
  assert.deepEqual(result.validationFields.客户负责人, [123]);
});
test('edit rejects management fields, parent migration and no changes; reason is optional', () => {
  const row = editableCustomer();
  for (const changes of [
    { 核查标记: '正常' },
    { 已归档: false },
    { 地区: null },
    {},
  ])
    assert.throws(() =>
      prepareEdit('customer', row, { changes, reason: 'x' }, {}, 'unit-test'),
    );
  assert.doesNotThrow(() =>
    prepareEdit(
      'customer',
      row,
      { changes: { 地区: '北京' } },
      {},
      'unit-test',
    ),
  );
  assert.throws(() =>
    prepareEdit(
      'customer',
      row,
      { changes: { 地区: '北京' }, reason: 'x', roles: ['crm_admin'] },
      {},
      'unit-test',
    ),
  );
  const contact = {
    id: 'recContact',
    record: {
      姓名: { text: 'Name' },
      职务: { text: 'Role' },
      所属企业: { link_record_ids: ['recCompany'] },
      电话: { text: '123' },
      维护人: [123],
      联系人状态: '有效',
    },
  };
  assert.throws(() =>
    prepareEdit(
      'contact',
      contact,
      { changes: { 所属企业: ['recOther'] }, reason: 'x' },
      {},
      'unit-test',
    ),
  );
});
test('archive, stopped contacts, ended projects and void followups cannot be edited', () => {
  const examples = [
    [
      'customer',
      {
        ...editableCustomer(),
        record: { ...editableCustomer().record, 已归档: true },
      },
    ],
    ['contact', { record: { 联系人状态: '停用' } }],
    ['project', { record: { 终局确认: '已完成' } }],
    ['followup', { record: { 记录状态: '已作废' } }],
  ];
  for (const [kind, row] of examples)
    assert.throws(() =>
      prepareEdit(kind, row, { changes: {}, reason: 'x' }, {}, 'unit-test'),
    );
});
test('edit prefill preserves zero amounts, people, relations and second precision', () => {
  const { forms } = require('../../dist/shared/crm.js');
  const original = recordDraft(
    {
      预计金额: 0,
      项目负责人: [123],
      所属企业: { link_record_ids: ['recCompany'] },
      目标完成日期: Date.parse('2026-10-25T00:00:00+08:00'),
    },
    forms.project,
  );
  assert.equal(original.预计金额, 0);
  assert.deepEqual(original.项目负责人, ['123']);
  assert.deepEqual(original.所属企业, ['recCompany']);
  assert.equal(original.目标完成日期, '2026-10-25');
  const time = recordDraft(
    { 实际发生时间: Date.parse('2026-10-24T12:13:14+08:00') },
    forms.followup,
  );
  assert.equal(time.实际发生时间, '2026-10-24T12:13:14');
  assert.deepEqual(
    changedFields(original, { ...original }, editFields('project')),
    {},
  );
});
test('unsupported date clearing fails before writing and leaves unchanged dates out of patch', () => {
  const row = {
    id: 'recProject',
    record: {
      项目名称: { text: 'Project' },
      项目类型: '技术验证',
      所属企业: { link_record_ids: ['recCompany'] },
      项目负责人: [123],
      '目标 / 需求摘要': { text: 'Goal' },
      当前下一步行动: { text: 'Plan' },
      下次跟进日期: Date.parse('2026-10-25T00:00:00+08:00'),
      目标完成日期: Date.parse('2026-10-26T00:00:00+08:00'),
      终局确认: '未确认',
      工作状态: '待启动',
    },
  };
  assert.throws(
    () =>
      prepareEdit(
        'project',
        row,
        { changes: { 目标完成日期: null }, reason: 'clear' },
        {},
        'unit-test',
      ),
    /不支持清空/,
  );
  const result = prepareEdit(
    'project',
    row,
    { changes: { 项目名称: 'Changed' }, reason: 'rename' },
    {},
    'unit-test',
  );
  assert.equal(result.writes.下次跟进日期, undefined);
  assert.equal(result.writes.目标完成日期, undefined);
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
test('all business controller methods reject anonymous requests before calling service', () => {
  const c = new CrmController(
    new Proxy(
      {},
      { get: () => () => assert.fail('service must not be reached') },
    ),
  );
  for (const req of [{}, {userContext:{}}, {userContext:{userId:''}}]) {
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
      联系人状态: '有效',
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
