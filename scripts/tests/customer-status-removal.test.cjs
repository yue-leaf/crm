const { test } = require('node:test');
const assert = require('node:assert/strict');
require('reflect-metadata');
const { editFields } = require('../../dist/shared/crm-edit.js');
const { recordReviewProblem } = require('../../dist/shared/crm-review.js');
const { workspaceModel } = require('../../dist/shared/crm-workspace.js');
const { prepareEdit } = require('../../dist/server/modules/crm/crm-edit.js');
const now = Date.parse('2026-10-27T12:00:00+08:00');
const customer = { id: 'recCustomer', record: { 企业全称: '客户', 行业: '制药', 地区: '上海', 客户负责人: ['123'],
  创建时间: now - 20 * 86400000, 当前下一步行动: '联系客户', 下次跟进日期: now - 86400000, 已归档: false } };
test('customers can be edited and validated without a customer status', () => {
  assert.ok(!editFields('customer').some(f => f.key === '客户关系状态'));
  assert.equal(recordReviewProblem('customer', customer.record, now), '');
  const result = prepareEdit('customer', customer, { changes: { 地区: '苏州' } }, {}, 'tester');
  assert.equal(result.writes.地区, '苏州');
  assert.ok(!Object.hasOwn(result.writes, '客户关系状态'));
});
test('removing customer status does not drop active customer tasks or stale-customer reminders', () => {
  for (const legacy of [undefined, '结束合作', '暂停合作']) {
    const row = { ...customer, record: { ...customer.record, ...(legacy ? { 客户关系状态: legacy } : {}) } };
    const { data } = workspaceModel({ customer: [row], project: [], followup: [] }, 'all', '123', now);
    assert.equal(data.counts.overdue, 1);
    assert.equal(data.tasks.length, 1);
    assert.equal(data.attentionTotal, 1);
    assert.equal(data.tasks[0].state, '');
  }
  const { data } = workspaceModel({ customer: [{ ...customer, record: { ...customer.record, 已归档: true } }], project: [], followup: [] }, 'all', '123', now);
  assert.equal(data.tasks.length, 1);
  assert.equal(data.attentionTotal, 1);
});
