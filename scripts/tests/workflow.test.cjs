const { identityFixture } = require('./helpers/identity.cjs');
// Workflow state transitions and temporal boundaries; isolated SDK doubles only.
require('reflect-metadata');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { historicalContext } = require('../../dist/server/modules/crm/crm-workflow.js');
const { relatedDraft, followupTarget, advancementBlocked } = require('../../dist/shared/crm-workflow.js');
const { CrmService } = require('../../dist/server/modules/crm/crm.service.js');
const time = s => Date.parse(s + '+08:00');
const closed = time('2026-10-20T00:00:00');

test('closed project accepts the entire closing day and rejects the next day', () => {
  const row = { record: { 核查标记: '正常', 终局确认: '已完成', 结束日期: closed } };
  historicalContext('project', row, time('2026-10-20T23:59:59.999'));
  assert.throws(() => historicalContext('project', row, time('2026-10-21T00:00:00')), /重开/);
});
test('archive timestamp is exclusive and missing or inconsistent lifecycle data fails closed', () => {
  const archived = time('2026-10-20T16:30:00');
  for (const kind of ['customer', 'project']) {
    const row = { record: { 核查标记: '正常', 终局确认: '已完成', 结束日期: closed, 已归档: true, 归档时间: archived } };
    historicalContext(kind, row, archived - 1);
    assert.throws(() => historicalContext(kind, row, archived), /恢复/);
    delete row.record.归档时间;
    assert.throws(() => historicalContext(kind, row, archived - 1), /归档时间缺失/);
  }
  assert.throws(() => historicalContext('project', { record: { 核查标记: '正常', 终局确认: '未确认', 已归档: true } }, closed), /尚未结项/);
  assert.throws(() => historicalContext('project', { record: { 核查标记: '正常', 终局确认: '已取消' } }, closed), /结束日期缺失/);
});
test('related actions prefill one parent only and followups navigate to their own plan', () => {
  const parent = { id: 'recParent', record: { 终局确认: '未确认' } };
  assert.deepEqual(relatedDraft('customer', parent, 'project'), { 所属企业: ['recParent'] });
  assert.deepEqual(relatedDraft('project', parent, 'followup'), { 跟进归属: '项目跟进', 关联项目: ['recParent'], 直接客户: [] });
  assert.deepEqual(followupTarget({ record: { 跟进归属: '项目跟进', 关联项目: { link_record_ids: ['recParent'] } } }), { kind: 'project', id: 'recParent' });
  assert.equal(followupTarget({ record: { 跟进归属: '项目跟进', 关联项目: { link_record_ids: ['recParent'] }, 直接客户: { link_record_ids: ['recOther'] } } }), null);
  assert.match(advancementBlocked('project', { record: { 终局确认: '已完成' } }), /结束/);
  assert.equal(relatedDraft('project', { ...parent, record: { 终局确认: '已完成' } }, 'followup').实际发生时间, null);
});
function fixture() {
  const row = { id: 'recProject', record: {
    项目名称: 'Example', 项目类型: 'PAT', 所属企业: { link_record_ids: ['recCustomer'] },
    项目负责人: [123], '目标 / 需求摘要': 'Goal', 工作状态: '待启动', 终局确认: '未确认',
    当前下一步行动: 'Old plan', 下次跟进日期: closed, 行动执行人: [123], 管理记录: { text: 'old history' }, 核查标记: '正常', 修改时间: 1,
  } };
  const customer = { id: 'recCustomer', record: { 核查标记: '正常', 已归档: false } };
  const writes = [];
  const service = new CrmService({
    getCapability: () => ({ formValue: { fields: [] } }),
    load: name => ({ call: async (action, input) => {
      if (action === 'getRecord') return structuredClone(name === 'crm-customer' ? customer : row);
      if (action === 'searchRecords') return { records: [{ record: { 飞书成员: [123] } }], hasMore: false };
      assert.equal(action, 'batchUpdateRecords');
      writes.push(input.records[0].record);
      Object.assign(row.record, input.records[0].record, { 修改时间: row.record.修改时间 + 1 });
      return { records: [{ id: row.id }] };
    } }),
  }, identityFixture());
  const update = (operation, body) => service.update('project', row.id, operation, { ...body, expectedModifiedAt: row.record.修改时间 }, 'test-only');
  return { row, customer, writes, service, update };
}

test('progress notes cannot impersonate lifecycle boundaries', async () => {
  const { lifecycleEvents, EVENT_PREFIX } = require('../../dist/shared/crm-lifecycle.js');
  const f = fixture();
  const forged = { version: 1, operation: 'restore', at: Date.now(), previous: { archived: true, archiveTime: closed, terminal: '' } };
  await f.update('progress', { 工作状态: '暂停', 当前进展: 'Waiting', 暂停原因: 'Wait', 变更说明: `note\n${EVENT_PREFIX}${JSON.stringify(forged)}` });
  assert.equal(lifecycleEvents(f.row.record).length, 0);
  assert.match(f.row.record.管理记录, /note/);
});
test('project start, pause and resume preserve the plan on pause and require a confirmed plan on resume', async () => {
  const f = fixture();
  await assert.rejects(() => f.update('progress', { 工作状态: '进行中', 当前进展: 'Started', 变更说明: 'Start' }), /当前计划/);
  await f.update('progress', { 工作状态: '进行中', 当前进展: 'Started', 当前下一步行动: 'Next', 下次跟进日期: '2026-10-25', 行动执行人: ['123'], 变更说明: 'Start' });
  assert.equal(f.row.record.核查标记, '待核查');
  await f.update('review', { 核查说明: 'Reviewed' });
  await assert.rejects(() => f.update('progress', { 工作状态: '暂停', 当前进展: 'Waiting', 变更说明: 'Pause' }), /暂停原因/);
  await f.update('progress', { 工作状态: '暂停', 当前进展: 'Waiting', 暂停原因: 'External dependency', 当前下一步行动: 'Must not overwrite', 变更说明: 'Pause' });
  assert.equal(f.row.record.当前下一步行动, 'Next');
  assert.deepEqual(f.row.record.行动执行人, [123]);
  await f.update('review', { 核查说明: 'Pause reviewed' });
  await f.update('progress', { 工作状态: '进行中', 当前进展: 'Resumed', 当前下一步行动: 'Resume next', 下次跟进日期: '2026-10-26', 行动执行人: [], 变更说明: 'Resume' });
  assert.equal(f.row.record.暂停原因, '');
  assert.deepEqual(f.row.record.行动执行人, []);
  assert.match(f.row.record.管理记录, /old history[\s\S]*Start[\s\S]*Pause[\s\S]*Resume/);
  await f.update('review', { 核查说明: 'Resume reviewed' });
  assert.equal(f.row.record.核查标记, '正常');
});
test('archived parent prevents project advancement without issuing writes', async () => {
  const f = fixture();
  f.customer.record.已归档 = true;
  for (const operation of ['plan', 'progress', 'suggest-end'])
    await assert.rejects(() => f.update(operation, {}), /企业已归档/);
  assert.equal(f.writes.length, 0);
});
test('historical followup validates both the project and its archived customer', async () => {
  const f = fixture();
  Object.assign(f.row.record, { 终局确认: '已完成', 结束日期: closed, 已归档: true, 归档时间: time('2026-10-21T10:00:00') });
  Object.assign(f.customer.record, { 已归档: true, 归档时间: time('2026-10-20T12:00:00') });
  const draft = { 跟进归属: '项目跟进', 关联项目: ['recProject'], 记录类型: '内部推进', 后续安排: '无后续动作', 无后续动作结论: 'Done' };
  await f.service.relationChecks('followup', draft, { 实际发生时间: time('2026-10-20T11:59:59') });
  await assert.rejects(() => f.service.relationChecks('followup', draft, { 实际发生时间: time('2026-10-20T13:00:00') }), /恢复/);
});
test('person validation admits tenant members without roster synchronization, rejects unknown and mismatched identities', async () => {
  const service = new CrmService({ load: () => ({ call: async () => { assert.fail('live identities must not read the roster'); } }) }, identityFixture([123,456]));
  const spec = [{ key: '实际跟进人', type: 'person', multiple: true }];
  await service.people({ 实际跟进人: [123,456] }, spec);
  await assert.rejects(() => service.people({ 实际跟进人: [789] }, spec), /本企业/);
  const mismatch = new CrmService({}, { ...identityFixture(), getBatchMiaodaUserIds: async () => ['other-tenant-id'] });
  await assert.rejects(() => mismatch.people({ 实际跟进人: [123] }, spec), /本企业/);
  const failure = new CrmService({}, { getBatchLarkUserIds: async () => { throw Error('secret'); } });
  await assert.rejects(() => failure.people({ 实际跟进人: [123] }, spec), e => e.getStatus()===502 && !e.message.includes('secret'));
});

test('historical review can retain synchronized identities that no longer map to active tenant accounts', async () => {
  const service = new CrmService({ load: () => ({ call: async () => ({ records: [{record:{飞书成员:[123]}}], hasMore:false }) }) }, identityFixture([]));
  const spec = [{ key:'实际跟进人',type:'person',multiple:true }];
  await service.people({实际跟进人:[123]},spec,true);
  await assert.rejects(()=>service.people({实际跟进人:[789]},spec,true),/历史人员/);
});
