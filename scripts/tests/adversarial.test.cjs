const { identityFixture } = require('./helpers/identity.cjs');
// Adversarial service tests: SDK doubles are isolated here, never used by the app.
const { test } = require('node:test');
const assert = require('node:assert/strict');
require('reflect-metadata');
const { CrmService } = require('../../dist/server/modules/crm/crm.service.js');
const { CrmController } = require('../../dist/server/modules/crm/crm.controller.js');
const { crmSection } = require('../../dist/shared/crm.js');
const customer = () => ({ id: 'recCompany', record: {
  企业全称: { text: 'Example' }, 行业: '其他化学制药', 地区: { text: '上海' },
  客户负责人: [123], 客户关系状态: '待建立', 核查标记: '正常', 已归档: false, 修改时间: 1,
} });
function fixture(row = customer(), hook = () => {}) {
  const writes = [];
  const service = new CrmService({
    getCapability: () => ({ formValue: { fields: [] } }),
    load: (kind) => ({ call: async (action, input) => {
      const result = await hook(kind, action, input, row);
      if (result !== undefined) return result;
      if (action === 'getRecord') return structuredClone(row);
      if (action === 'searchRecords') return { records: [{ record: { 飞书成员: [123] } }], hasMore: false };
      if (action === 'batchUpdateRecords') {
        writes.push(input);
        Object.assign(row.record, input.records[0].record);
        return { records: [{ id: row.id }] };
      }
      assert.fail(`Unexpected ${action}`);
    } }),
  }, { ...identityFixture(), getBatchLarkUserIds: async (ids) => { await hook('identity', 'validatePeople', {}, row); return identityFixture().getBatchLarkUserIds(ids); } });
  return { service, writes, row };
}
const plan = { 当前下一步行动: 'Next', 下次跟进日期: '2026-10-25', 行动执行人: ['123'], expectedModifiedAt: 1 };

test('reject update when Base changes during employee validation, even with same timestamp', async () => {
  const f = fixture(customer(), (kind, action, input, row) => {
    if (action === 'validatePeople') row.record.已归档 = true;
  });
  await assert.rejects(() => f.service.update('customer', 'recCompany', 'plan', plan, 'test'), e => e.getStatus() === 409);
  assert.equal(f.writes.length, 0);
});
test('access configuration accepts only employee/admin and rejects removed fields', async () => {
  for (const role of ['员工', '管理员']) {
    const f = fixture({ id: 'recAccess', record: { 修改时间: 1 } });
    await f.service.update('access', 'recAccess', 'access', { expectedModifiedAt: 1, 待配置角色: role }, 'test');
    assert.equal(f.row.record.待配置角色, role);
  }
  for (const patch of [{ 待配置角色: '只读' }, { 待配置角色: '系统管理员' },
    { 待配置角色: '员工', 处理请求: '申请开通' }, { 待配置角色: '员工', 目录状态: '已激活' },
    { 待配置角色: '员工', 授权范围说明: 'old' }, { 待配置角色: '员工', 权限核验记录: 'old' }]) {
    const f = fixture({ id: 'recAccess', record: { 修改时间: 1 } });
    await assert.rejects(() => f.service.update('access', 'recAccess', 'access', { expectedModifiedAt: 1, ...patch }, 'test'));
    assert.equal(f.writes.length, 0);
  }
});
test('reject success when update response returns an ID but silently ignores fields', async () => {
  const f = fixture(customer(), (kind, action) => action === 'batchUpdateRecords' ? { records: [{ id: 'recCompany' }] } : undefined);
  await assert.rejects(() => f.service.update('customer', 'recCompany', 'plan', plan, 'test'), /回读/);
});
test('reject success when create response returns an ID but silently ignores fields', async () => {
  const f = fixture(customer(), (kind, action) => action === 'batchAddRecords' ? { records: [{ id: 'recCompany' }] } : undefined);
  await assert.rejects(() => f.service.create('customer', { 企业全称: 'New', 行业: '其他化学制药', 地区: '北京', 客户负责人: ['123'] }), /回读/);
});
test('query objects and arrays are rejected before calling the SDK', async () => {
  const f = fixture();
  for (const value of [[], ['x'], { contains: 'x' }]) {
    await assert.rejects(() => f.service.list('customer', undefined, value), e => e.getStatus() === 400);
    await assert.rejects(() => f.service.list('customer', value), e => e.getStatus() === 400);
  }
});
test('malformed role contexts fail closed, including substring role strings', () => {
  const c = new CrmController({ summary: () => assert.fail('must not authorize') });
  for (const req of [{}, { userContext: null }, ...['not_crm_admin', null, {}].map(roles => ({ userContext: { userId: 'test', roles } }))])
    assert.throws(() => c.summary(req), e => typeof e.getStatus === 'function' && e.getStatus() === 403);
});
test('ambiguous project/contact enterprise links and unknown contact state cannot pass relation checks', async () => {
  const draft = { 跟进归属: '项目跟进', 关联项目: ['recProject'], 记录类型: '外部沟通', '沟通 / 推进方式': '电话', 客户联系人: ['recContact'], 后续安排: '无后续动作', 无后续动作结论: 'Done' };
  for (const broken of ['project', 'contact', 'status']) {
    const f = fixture(customer(), (kind, action) => {
      if (action !== 'getRecord') return;
      if (kind === 'crm-project') return { id: 'recProject', record: { 核查标记: '正常', 终局确认: '未确认', 所属企业: { link_record_ids: broken === 'project' ? ['recCompany', 'recOther'] : ['recCompany'] } } };
      if (kind === 'crm-contact') return { id: 'recContact', record: { 核查标记: '正常', 联系人状态: broken === 'status' ? '未知状态' : '有效', 停用时间: 1000, 所属企业: { link_record_ids: broken === 'contact' ? ['recCompany', 'recOther'] : ['recCompany'] } } };
    });
    await assert.rejects(() => f.service.relationChecks('followup', draft, { 实际发生时间: 1 }), e => e.getStatus() === 400);
  }
});
test('one process refuses overlapping updates to the same record', async () => {
  let release, entered;
  const gate = new Promise(resolve => { release = resolve; });
  const ready = new Promise(resolve => { entered = resolve; });
  const f = fixture(customer(), async (kind, action) => {
    if (action === 'validatePeople') { entered(); await gate; }
  });
  const first = f.service.update('customer', 'recCompany', 'plan', plan, 'test');
  await ready;
  try {
    await assert.rejects(() => f.service.update('customer', 'recCompany', 'plan', plan, 'test'), e => e.getStatus() === 409);
  } finally { release(); }
  await first;
  assert.equal(f.writes.length, 1);
});
test('prototype property route names fall back to home', () => {
  for (const name of ['__proto__', 'constructor', 'toString', undefined, 'unknown'])
    assert.equal(crmSection(name), 'home');
  assert.equal(crmSection('customer'), 'customer');
});
test('actual SDK controllers are blocked independently of URL spelling', () => {
  const { CrmCapabilityGuard } = require('../../dist/server/modules/crm/crm-capability.guard.js');
  const { DebugController, WebhookController } = require('@lark-apaas/nestjs-capability');
  for (const controller of [DebugController, WebhookController])
    assert.throws(() => new CrmCapabilityGuard().canActivate({
      getClass: () => controller,
      switchToHttp: () => ({ getRequest: () => ({ path: '/%61PI/CAPABILITY/x' }) }),
    }), e => e.getStatus() === 403);
});
test('valid historical contact remains usable only strictly before deactivation', async () => {
  const draft = { 跟进归属: '客户直接跟进', 直接客户: ['recCompany'], 记录类型: '外部沟通', '沟通 / 推进方式': '电话', 客户联系人: ['recContact'], 后续安排: '无后续动作', 无后续动作结论: 'Done' };
  const f = fixture(customer(), (kind, action) => kind === 'crm-contact' && action === 'getRecord'
    ? { record: { 核查标记: '正常', 联系人状态: '停用', 停用时间: 1000, 停用原因: 'Left company', 所属企业: { link_record_ids: ['recCompany'] } } } : undefined);
  await f.service.relationChecks('followup', draft, { 实际发生时间: 999 });
  await assert.rejects(() => f.service.relationChecks('followup', draft, { 实际发生时间: 1000 }), /有效期/);
});
