require('reflect-metadata');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { changeFilter, contactChoiceProblem, followupTime, actionDraft, suggestedPlan } = require('../../dist/shared/crm-ux.js');
const { detailGroups } = require('../../dist/shared/crm-presentation.js');
const { lifecycleFields } = require('../../dist/shared/crm-lifecycle.js');
const { progressFields } = require('../../dist/shared/crm-workflow.js');
const { parseDraft } = require('../../dist/server/modules/crm/crm-validation.js');
const { CrmService } = require('../../dist/server/modules/crm/crm.service.js');
const { CrmController } = require('../../dist/server/modules/crm/crm.controller.js');

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

test('simplified progress and completion forms still satisfy the audited write contract', () => {
  const progress = actionDraft('progress', { 工作状态: '进行中', 当前进展: '完成评审', 当前下一步行动: '提交方案', 下次跟进日期: '2026-10-28' });
  assert.ok(parseDraft(progress, progressFields, {}).fields['变更说明']);
  const complete = actionDraft('confirm-end', { 终局确认: '已完成', 结束日期: '2026-10-20', 结果说明: '交付验收通过', 取消原因: '' });
  assert.equal(parseDraft(complete, lifecycleFields('project', 'confirm-end'), {}).fields['结果说明'], '交付验收通过');
  const cancel = actionDraft('confirm-end', { 终局确认: '已取消', 结束日期: '2026-10-20', 取消原因: '客户计划调整', 结果说明: '旧结果' });
  const parsed = parseDraft(cancel, lifecycleFields('project', 'confirm-end'), {}).fields;
  assert.equal(parsed['结果说明'], '客户计划调整');
  assert.match(parsed['操作原因'], /客户计划调整/);
  assert.throws(() => parseDraft(actionDraft('confirm-end', { 终局确认: '已取消', 结束日期: '2026-10-20' }), lifecycleFields('project', 'confirm-end'), {}), /必填/);
});

test('adopting a suggestion only prepares a separate plan and never invents its date', () => {
  const record = { 记录状态: '正常', 后续安排: '有下一步行动', 建议下一步行动: { text: '发出报价' }, 建议处理人: [123], 建议日期: Date.parse('2026-10-28T00:00:00+08:00') };
  const original = structuredClone(record);
  assert.deepEqual(suggestedPlan(record), { 当前下一步行动: '发出报价', 行动执行人: ['123'], 下次跟进日期: '2026-10-28' });
  assert.deepEqual(record, original);
  assert.equal(suggestedPlan({ ...record, 建议日期: undefined })['下次跟进日期'], '');
  assert.equal(suggestedPlan({ ...record, 记录状态: '已作废' }), null);
  assert.equal(suggestedPlan({ ...record, 后续安排: '无后续动作' }), null);
});

test('detail fields expose one project state and avoid duplicate direct-customer names', () => {
  const keys = detailGroups({ 工作状态: '进行中', 终局确认: '已完成', 直接客户: { link_record_ids: ['recCustomer'] }, 有效客户名称: '客户' })
    .flatMap(g => g.fields.map(([key]) => key));
  assert.ok(keys.includes('工作状态'));
  assert.ok(!keys.includes('终局确认'));
  assert.ok(!keys.includes('有效客户名称'));
});
