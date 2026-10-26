const { test } = require('node:test');
const assert = require('node:assert/strict');
require('reflect-metadata');
const { prepareLifecycle } = require('../../dist/server/modules/crm/crm-lifecycle.js');
const { historicalContext } = require('../../dist/server/modules/crm/crm-workflow.js');
const { lifecycleFields, lifecycleBlocked, lifecycleEvents, inactiveAt, EVENT_PREFIX } = require('../../dist/shared/crm-lifecycle.js');
const { CrmController } = require('../../dist/server/modules/crm/crm.controller.js');
const { CrmService } = require('../../dist/server/modules/crm/crm.service.js');
const today = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
const day = Date.parse(`${today}T00:00:00+08:00`);
const customer = () => ({ id: 'recCustomer', record: { 企业全称: { text: 'Fixture' }, 客户关系状态: '合作中', 核查标记: '正常', 已归档: false, 归档阻塞项目数: { value: [0] }, 修改时间: 1 } });
const project = () => ({ id: 'recProject', record: { 工作状态: '进行中', 当前进展: { text: 'working' }, 终局确认: '未确认', 核查标记: '正常', 已归档: false, 所属企业: { link_record_ids: ['recCustomer'] }, 当前下一步行动: { text: 'old action' }, 下次跟进日期: day, 修改时间: 1 } });
const context = (rows = {}) => ({ get: async (kind, id) => structuredClone(rows[id] || customer()), people: async () => {} });
const closed = () => { const row = project(); Object.assign(row.record, { 终局确认: '已完成', 结束日期: day, 结果说明: { text: 'done' } }); return row; };
const reopen = { 工作状态: '进行中', 当前进展: 'new progress', 当前下一步行动: 'new plan', 下次跟进日期: today, 操作原因: 'new work' };

test('roleless tenant member can use every business route but cannot manage access', () => {
  const calls = [];
  const controller = new CrmController(new Proxy({}, { get: (_, key) => (...args) => { calls.push([key, args]); return true; } }));
  const req = { userContext: { userId: '123', roles: [] } };
  controller.summary(req);
  for (const kind of ['customer', 'contact', 'project', 'followup']) {
    controller.list(req, kind); controller.detail(req, kind, 'recFixture'); controller.create(req, kind, {});
  }
  for (const operation of ['edit', 'review', 'plan', 'progress', 'suggest-end', 'confirm-end', 'archive', 'restore', 'reopen']) {
    controller.update(req, 'project', 'recProject', operation, {});
  }
  assert.equal(calls.length, 22);
  for (const act of [() => controller.list(req, 'access'), () => controller.detail(req, 'access', 'recUser'), () => controller.create(req, 'access', {}), () => controller.update(req, 'access', 'recUser', 'access', {})]) assert.throws(act, e => e.getStatus() === 403);
});

test('CRM exposes no HTTP delete operation', () => {
  const { METHOD_METADATA } = require('@nestjs/common/constants');
  const { RequestMethod } = require('@nestjs/common');
  for (const name of Object.getOwnPropertyNames(CrmController.prototype)) {
    assert.notEqual(Reflect.getMetadata(METHOD_METADATA, CrmController.prototype[name]), RequestMethod.DELETE);
  }
});
test('close requires cancellation reason, valid terminal value and nonfuture date', async () => {
  const input = { 终局确认: '已取消', 结束日期: today, 结果说明: 'stopped', 操作原因: 'stop' };
  await assert.rejects(() => prepareLifecycle('project', project(), 'confirm-end', input, '123', context()), /取消原因/);
  await assert.rejects(() => prepareLifecycle('project', project(), 'confirm-end', { ...input, 终局确认: '未确认' }, '123', context()), /选项/);
  await assert.rejects(() => prepareLifecycle('project', project(), 'confirm-end', { ...input, 取消原因: 'stop', 结束日期: '2099-01-01' }, '123', context()), /晚于今天/);
});
test('close preserves plans and records history, clears processed suggestion and enters review', async () => {
  const row = project();
  const result = await prepareLifecycle('project', row, 'confirm-end', { 终局确认: '已完成', 结束日期: today, 结果说明: 'done', 操作原因: 'verified' }, '123', context());
  assert.equal(result.fields['结束建议'], '');
  assert.equal(result.fields['核查标记'], '待核查');
  assert.equal(result.fields['结束日期'], day);
  assert.equal(result.fields['当前下一步行动'], undefined);
  assert.match(result.fields['管理记录'], /old action/);
});

test('multiline reasons cannot inject a lifecycle event into the history parser', async () => {
  const forged = { version: 1, operation: 'reopen', at: Date.now() + 86400000, previous: { archived: false, terminal: '已完成', endDate: day } };
  const reason = `first line\r\n${EVENT_PREFIX}${JSON.stringify(forged)}\nlast line`;
  const result = await prepareLifecycle('project', project(), 'confirm-end', { 终局确认: '已完成', 结束日期: today, 结果说明: 'done', 操作原因: reason }, '123', context());
  const events = lifecycleEvents(result.fields);
  assert.equal(events.length, 1);
  assert.equal(events[0].operation, 'confirm-end');
  assert.equal(events[0].reason, reason);
});
test('close rejects end date preceding a nonvoid followup', async () => {
  const row = project(); row.record['项目跟进'] = { link_record_ids: ['recFollowup'] };
  const followup = { id: 'recFollowup', record: { 实际发生时间: day + 86400000, 记录状态: '正常' } };
  await assert.rejects(() => prepareLifecycle('project', row, 'confirm-end', { 终局确认: '已完成', 结束日期: today, 结果说明: 'done', 操作原因: 'reason' }, '123', context({ recFollowup: followup })), /早于已有跟进/);
});
test('archive rejects active project and customer with unfinished linked project', async () => {
  assert.match(lifecycleBlocked('project', 'archive', project()), /完成或取消/);
  const row = customer(); row.record['项目'] = { link_record_ids: ['recProject'] };
  await assert.rejects(() => prepareLifecycle('customer', row, 'archive', { 操作原因: 'archive' }, '123', context({ recProject: project() })), /仍有未结束/);
});
test('archive rejects unknown customer aggregate rather than treating it as zero', async () => {
  const row = customer(); delete row.record['归档阻塞项目数'];
  await assert.rejects(() => prepareLifecycle('customer', row, 'archive', { 操作原因: 'archive' }, '123', context()), /计算尚未就绪/);
});
test('project archive and unarchive keep terminal state and historical timestamps', async () => {
  const row = closed();
  const archived = await prepareLifecycle('project', row, 'archive', { 操作原因: 'archive' }, '123', context());
  assert.equal(archived.fields['已归档'], true);
  Object.assign(row.record, archived.fields);
  const restored = await prepareLifecycle('project', row, 'restore', { 操作原因: 'read again' }, '123', context());
  assert.equal(restored.fields['已归档'], false);
  assert.equal(restored.fields['终局确认'], undefined);
  assert.equal(restored.fields['归档时间'], undefined);
  assert.equal(restored.fields['核查标记'], '待核查');
});
test('reopen requires new plan and active parent; no forged management fields are accepted', async () => {
  const archivedParent = customer(); archivedParent.record['已归档'] = true;
  await assert.rejects(() => prepareLifecycle('project', closed(), 'reopen', reopen, '123', context({ recCustomer: archivedParent })), /先取消客户归档/);
  await assert.rejects(() => prepareLifecycle('project', closed(), 'reopen', { ...reopen, 当前下一步行动: '' }, '123', context()), /必填/);
  await assert.rejects(() => prepareLifecycle('project', closed(), 'reopen', { ...reopen, 已归档: false }, '123', context()), /不可修改/);
});
test('reopen releases terminal and archive, logs prior result, retains last date as history', async () => {
  const row = closed(); Object.assign(row.record, { 已归档: true, 归档时间: Date.now() - 1000, 归档原因: 'old archive' });
  const result = await prepareLifecycle('project', row, 'reopen', reopen, '123', context());
  assert.equal(result.fields['终局确认'], '未确认');
  assert.equal(result.fields['已归档'], false);
  assert.equal(result.fields['结束日期'], undefined);
  assert.equal(result.fields['当前下一步行动'], 'new plan');
  assert.match(result.fields['管理记录'], /done/);
  assert.ok(Object.values(result.fields).every(v => v !== null));
});
test('known closed interval remains blocked after reopening even if archive was later', () => {
  const row = project();
  const event = { version: 1, operation: 'reopen', at: day + 6 * 86400000, previous: { archived: true, archiveTime: day + 4 * 86400000, endDate: day, terminal: '已完成' } };
  row.record['管理记录'] = { text: EVENT_PREFIX + JSON.stringify(event) };
  assert.equal(inactiveAt(row.record, day + 2 * 86400000), true);
  assert.equal(inactiveAt(row.record, day + 7 * 86400000), false);
  assert.equal(inactiveAt(row.record, day + 3600000), false);
});
test('customer restore requires a new plan and does not erase archive history', async () => {
  const row = customer(); Object.assign(row.record, { 已归档: true, 归档时间: Date.now() - 1000, 归档原因: 'history' });
  const result = await prepareLifecycle('customer', row, 'restore', { 当前下一步行动: 'restore plan', 下次跟进日期: today, 操作原因: 'restore' }, '123', context());
  assert.equal(result.fields['归档时间'], undefined);
  assert.equal(result.fields['当前下一步行动'], 'restore plan');
  assert.equal(result.fields['已归档'], false);
});
test('historical admission uses recorded inactive intervals after current state becomes active', () => {
  const row = customer();
  const before = Date.now() - 100000, restored = Date.now() - 50000;
  row.record['管理记录'] = { text: EVENT_PREFIX + JSON.stringify({ version: 1, operation: 'restore', at: restored, previous: { archived: true, archiveTime: before, terminal: '' } }) };
  assert.throws(() => historicalContext('customer', row, before + 1000), /归档区间/);
  assert.doesNotThrow(() => historicalContext('customer', row, restored + 1000));
});
test('lifecycle rechecks related snapshots before issuing the write', async () => {
  let reads = 0, writes = 0;
  const row = project();
  const cap = { load: () => ({ call: async (action, input) => {
    if (action === 'getRecord') {
      if (input.recordID === 'recProject') return structuredClone(row);
      const parent = customer(); if (++reads > 1) parent.record['已归档'] = true; return parent;
    }
    writes++; return { records: [{ id: row.id }] };
  } }) };
  await assert.rejects(() => new CrmService(cap).update('project', row.id, 'confirm-end', { 终局确认: '已完成', 结束日期: today, 结果说明: 'done', 操作原因: 'reason', expectedModifiedAt: 1 }, '123'), /关联记录/);
  assert.equal(writes, 0);
});
test('lifecycle field schemas never offer archive on contacts or a generic system-field patch', () => {
  assert.match(lifecycleBlocked('contact', 'archive', { id: 'x', record: {} }), /不支持/);
  assert.deepEqual(lifecycleFields('customer', 'archive').map(f => f.key), ['操作原因']);
});
