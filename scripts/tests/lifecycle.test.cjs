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
const closed = () => { const row = project(); Object.assign(row.record, { 终局确认: '已取消', 取消原因: 'stop', 结束日期: day, 结果说明: { text: 'done' } }); return row; };
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
test('cancellation preserves plans and records history without the retired review gate', async () => {
  const row = project();
  const result = await prepareLifecycle('project', row, 'confirm-end', { 终局确认: '已取消', 取消原因: 'stop', 结束日期: today, 结果说明: 'done', 操作原因: 'verified' }, '123', context());
  assert.equal(result.fields['结束建议'], '');
  assert.ok(!Object.hasOwn(result.fields, '核查标记'));
  assert.equal(result.fields['结束日期'], day);
  assert.equal(result.fields['当前下一步行动'], undefined);
  assert.match(result.fields['管理记录'], /old action/);
});

test('multiline reasons cannot inject a lifecycle event into the history parser', async () => {
  const forged = { version: 1, operation: 'reopen', at: Date.now() + 86400000, previous: { archived: false, terminal: '已完成', endDate: day } };
  const reason = `first line\r\n${EVENT_PREFIX}${JSON.stringify(forged)}\nlast line`;
  const result = await prepareLifecycle('project', project(), 'confirm-end', { 终局确认: '已取消', 取消原因: 'stop', 结束日期: today, 结果说明: 'done', 操作原因: reason }, '123', context());
  const events = lifecycleEvents(result.fields);
  assert.equal(events.length, 1);
  assert.equal(events[0].operation, 'confirm-end');
  assert.equal(events[0].reason, reason);
});
test('close rejects end date preceding a nonvoid followup', async () => {
  const row = project(); row.record['项目跟进'] = { link_record_ids: ['recFollowup'] };
  const followup = { id: 'recFollowup', record: { 实际发生时间: day + 86400000, 记录状态: '正常' } };
  await assert.rejects(() => prepareLifecycle('project', row, 'confirm-end', { 终局确认: '已取消', 取消原因: 'stop', 结束日期: today, 结果说明: 'done', 操作原因: 'reason' }, '123', context({ recFollowup: followup })), /早于已有跟进/);
});
test('retired archive and restore operations reject all current and historical customer/project states',async()=>{
 for(const kind of ['customer','project'])for(const operation of ['archive','restore'])for(const row of [project(),closed(),customer()]) {
  assert.match(lifecycleBlocked(kind,operation,row),/已移除/);
  await assert.rejects(()=>prepareLifecycle(kind,row,operation,{操作原因:'old client'},'123',context()),/已移除/);
 }
});

test('retired operation rejection never loads relations or writes fields',async()=>{
 let reads=0;
 await assert.rejects(()=>prepareLifecycle('customer',customer(),'archive',{操作原因:'archive'},'123',{get:()=>{reads++;throw Error('must not read');}}),/已移除/);
 assert.equal(reads,0);
});

test('legacy archive events remain readable without creating inactive work intervals',()=>{
 const event={version:1,operation:'restore',at:day,previous:{archived:true,archiveTime:day-86400000,terminal:''}};
 const record={管理记录:EVENT_PREFIX+JSON.stringify(event)};
 assert.equal(lifecycleEvents(record)[0].operation,'restore');assert.equal(inactiveAt(record,day-1000),false);
});

test('reopen requires new plan and valid parent; no forged management fields are accepted', async () => {
  const archivedParent = customer(); archivedParent.record['数据检查'] = '客户资料缺失';
  await assert.rejects(() => prepareLifecycle('project', closed(), 'reopen', reopen, '123', context({ recCustomer: archivedParent })), /客户资料不完整/);
  await assert.rejects(() => prepareLifecycle('project', closed(), 'reopen', { ...reopen, 当前下一步行动: '' }, '123', context()), /当前计划/);
  await assert.rejects(() => prepareLifecycle('project', closed(), 'reopen', { ...reopen, 已归档: false }, '123', context()), /不可修改/);
});
test('reopen releases cancellation, logs prior result and retains last date as history', async () => {
  const row = closed(); Object.assign(row.record, { 已归档: true, 归档时间: Date.now() - 1000, 归档原因: 'old archive' });
  const result = await prepareLifecycle('project', row, 'reopen', reopen, '123', context());
  assert.equal(result.fields['终局确认'], '未确认');
  assert.ok(!Object.hasOwn(result.fields, '已归档'));
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
test('cancelled project may reopen despite legacy archive metadata on its parent',async()=>{
 const parent=customer();Object.assign(parent.record,{已归档:true,归档时间:day});
 const result=await prepareLifecycle('project',closed(),'reopen',reopen,'123',context({recCustomer:parent}));
 assert.equal(result.fields.终局确认,'未确认');assert.equal(result.fields.当前下一步行动,'new plan');
});

test('customer archival intervals are ignored, project cancellation intervals remain enforced',()=>{
 const row=customer();const before=Date.now()-100000,restored=Date.now()-50000;
 row.record.管理记录=EVENT_PREFIX+JSON.stringify({version:1,operation:'restore',at:restored,previous:{archived:true,archiveTime:before,terminal:''}});
 assert.doesNotThrow(()=>historicalContext('customer',row,before+1000));
 const p=project();p.record.管理记录=EVENT_PREFIX+JSON.stringify({version:1,operation:'reopen',at:Date.now()-1000,previous:{archived:false,terminal:'已取消',endDate:day-2*86400000}});
 assert.throws(()=>historicalContext('project',p,day-3600000),/取消区间/);
});

test('lifecycle rechecks related snapshots before issuing the write', async () => {
  let reads = 0, writes = 0;
  const row = project();
  const cap = { load: () => ({ call: async (action, input) => {
    if (action === 'getRecord') {
      if (input.recordID === 'recProject') return structuredClone(row);
      const parent = customer(); if (++reads > 1) parent.record['企业全称'] = 'Changed'; return parent;
    }
    writes++; return { records: [{ id: row.id }] };
  } }) };
  await assert.rejects(() => new CrmService(cap).update('project', row.id, 'confirm-end', { 终局确认: '已取消', 取消原因: 'stop', 结束日期: today, 结果说明: 'done', 操作原因: 'reason', expectedModifiedAt: 1 }, '123'), /关联记录/);
  assert.equal(writes, 0);
});
test('lifecycle field schemas never offer archive on contacts or a generic system-field patch', () => {
  assert.match(lifecycleBlocked('contact', 'archive', { id: 'x', record: {} }), /不支持/);
  assert.deepEqual(lifecycleFields('customer', 'archive').map(f => f.key), ['操作原因']);
});
