require('reflect-metadata');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { changeFilter, contactChoiceProblem, followupTime } = require('../../dist/shared/crm-ux.js');
const { missingFields } = require('../../dist/shared/crm-interaction.js');
const { dateMillis } = require('../../dist/server/modules/crm/crm-validation.js');
const { detailGroups } = require('../../dist/shared/crm-presentation.js');
const { CrmService } = require('../../dist/server/modules/crm/crm.service.js');
const { CrmController } = require('../../dist/server/modules/crm/crm.controller.js');

test('followup customer changes reset dependent project, independent project choice and reset retain unrelated query',()=>{
 const {changeFollowupListTarget}=require('../../dist/shared/crm-ux.js');
 const params=new URLSearchParams('customerId=recA&projectId=recP&other=keep');
 const changed=new URLSearchParams(changeFollowupListTarget(params,'customerId','recB'));
 assert.equal(changed.get('customerId'),'recB');assert.equal(changed.has('projectId'),false);
 assert.equal(changed.get('other'),'keep');
 assert.equal(new URLSearchParams(changeFollowupListTarget(params,'customerId','recA')).get('projectId'),'recP');
 assert.equal(new URLSearchParams(changeFollowupListTarget(params,'projectId','recQ')).get('customerId'),'recA');
 assert.equal(changeFollowupListTarget(params,'reset'),'other=keep');
 assert.equal(new URLSearchParams(changeFollowupListTarget(new URLSearchParams(),'projectId','recQ')).get('projectId'),'recQ');
});

test('followup list controller forwards both filters with login and rejects filters on other entities',async()=>{
 let received;const controller=new CrmController({followupList:async(...args)=>{received=args;return {records:[],hasMore:false};}});
 const req={userContext:{userId:'123'}};
 assert.throws(()=>controller.list({},'followup'),e=>e.getStatus()===403);
 await controller.list(req,'followup','cursor','query',undefined,undefined,undefined,'recC','recP');
 assert.deepEqual(received,['recC','recP','cursor','query']);
 assert.throws(()=>controller.list(req,'project',undefined,undefined,undefined,undefined,undefined,'recC','recP'),/仅用于跟进记录/);
});

test('scope and individual filter changes retain the other filters', () => {
  const params = new URLSearchParams('projectFilter=overdue&followupFilter=today&scope=mine');
  const scope = new URLSearchParams(changeFilter(params, 'scope', 'all'));
  assert.equal(scope.get('projectFilter'), 'overdue');
  assert.equal(scope.get('followupFilter'), 'today');
  assert.equal(scope.get('scope'), null);
  const filter = new URLSearchParams(changeFilter(params, 'projectFilter', 'all'));
  assert.equal(filter.get('scope'), 'mine');
  assert.equal(filter.get('followupFilter'), 'today');
  assert.equal(params.get('projectFilter'), 'overdue');
});

test('contact choices match the exact historical disable-time boundary', () => {
  const boundary = Date.now() - 86400000;
  const row = { id: 'recContact', record: { 联系人状态: '停用', 停用时间: boundary, 停用原因: '离职' } };
  assert.equal(contactChoiceProblem(row, boundary - 1), '');
  assert.match(contactChoiceProblem(row, boundary), /已停用/);
  assert.match(contactChoiceProblem(row, boundary + 1), /已停用/);
  assert.match(contactChoiceProblem(row, NaN), /填写跟进时间/);
  assert.equal(contactChoiceProblem({ ...row, record: { 联系人状态: '有效' } }, boundary), '');
  assert.match(contactChoiceProblem({ ...row, record: { 联系人状态: '有效', 停用原因: '未清理' } }, boundary), /残留/);
  assert.equal(followupTime('2026-10-20T10:00'), Date.parse('2026-10-20T02:00:00Z'));
  assert.ok(Number.isNaN(followupTime('2026-10-20')));
});

test('customer-scoped contact searches keep customer and name predicates on every page', async () => {
  const calls = [];
  const row = { id: 'recPerson', record: { 所属企业: { link_record_ids: ['recCustomer'] } } };
  const service = new CrmService({ load: () => ({ call: async (action, input) => {
    if (action === 'getRecord') return { id: input.recordID, record: {} };
    calls.push(input);
    return { records: [row], hasMore: !input.pageToken, ...(!input.pageToken ? { pageToken: 'second' } : {}) };
  } }) });
  const controller = new CrmController(service);
  const req = { userContext: { userId: '123' } };
  const first = await controller.customerContacts(req, 'recCustomer', undefined, '张');
  await controller.customerContacts(req, 'recCustomer', first.pageToken, '张');
  for (const call of calls) assert.deepEqual(call.filter.conditions, [
    { fieldName: '所属企业', operator: 'contains', value: ['recCustomer'] },
    { fieldName: '姓名', operator: 'contains', value: ['张'] },
  ]);
  await assert.rejects(() => controller.customerContacts(req, 'recCustomer', undefined, 'x'.repeat(201)), /搜索/);
  assert.throws(() => controller.customerContacts({ userContext: {} }, 'recCustomer'), e => e.getStatus() === 403);
});

test('detail fields expose one project state and avoid duplicate direct-customer names', () => {
  const keys = detailGroups({ 工作状态: '进行中', 终局确认: '已完成', 直接客户: { link_record_ids: ['recCustomer'] }, 有效客户名称: '客户' })
    .flatMap(g => g.fields.map(([key]) => key));
  assert.ok(keys.includes('工作状态'));
  assert.ok(!keys.includes('终局确认'));
  assert.ok(!keys.includes('有效客户名称'));
});

test('client rejects nonexistent dates and clock overflow before submission, matching server validation', () => {
  for (const value of ['2026-02-29T10:00', '2026-02-30T10:00', '2026-04-31T10:00',
    '2026-10-20T24:00', '2026-10-20T10:60', '2026-10-20T10:00:60']) {
    assert.ok(Number.isNaN(followupTime(value)), value);
    assert.ok(missingFields([{ key: '发生', type: 'datetime' }], { 发生: value }).发生, value);
    assert.throws(() => dateMillis(value, '发生', true));
  }
  for (const value of ['2024-02-29T23:59:59', '2026-10-20T00:00'])
    assert.equal(followupTime(value), dateMillis(value, '发生', true));
  assert.ok(missingFields([{ key: '计划日期', type: 'date' }], { 计划日期: '2026-02-30' }).计划日期);
  assert.deepEqual(missingFields([{ key: '计划日期', type: 'date' }], { 计划日期: '' }), {});
});
