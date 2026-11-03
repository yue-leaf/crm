require('reflect-metadata');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { CrmService } = require('../../dist/server/modules/crm/crm.service.js');
const { prepareEdit } = require('../../dist/server/modules/crm/crm-edit.js');
const { forms } = require('../../dist/shared/crm.js');
const { requiredField, missingFields } = require('../../dist/shared/crm-interaction.js');

const bodies = {
  contact: { 所属企业: ['recCustomer'], 姓名: 'Contact', 职务: 'Engineer', 电话: '123456' },
  project: { 所属企业: ['recCustomer'], 项目名称: 'Project', 项目类型: 'MRT', '目标 / 需求摘要': 'Goal' },
  followup: { 跟进归属: '客户直接跟进', 直接客户: ['recCustomer'], 记录类型: '外部沟通',
    '沟通 / 推进方式': '电话', 实际发生时间: '2026-10-01T10:00', '内容 / 推进结论': 'Discussed',
    后续安排: '无后续动作', 无后续动作结论: 'Done' },
};
const optional = { contact: ['维护人'], project: ['项目负责人'], followup: ['实际跟进人', '客户联系人'] };

for (const kind of Object.keys(bodies)) test(`${kind}: optional people can be omitted, left empty, cleared, and assigned later`, async () => {
  let saved;
  const service = new CrmService({
    getCapability: () => ({ formValue: { fields: [] } }),
    load: () => ({ call: async (action, input) => {
      assert.equal(action, 'batchAddRecords');
      const record = { ...input.records[0].record };
      for (const field of forms[kind]) if (field.type === 'relation' && Array.isArray(record[field.key]))
        record[field.key] = { link_record_ids: record[field.key] };
      saved = { id: 'recSaved', record };
      return { records: [saved] };
    } }),
  }, { getBatchLarkUserIds: async () => assert.fail('empty people must not query identities') });
  service.get = async (_kind, id) => id === 'recCustomer'
    ? { id, record: { 企业全称: 'Customer' } } : saved;
  for (const empty of [undefined, [], null]) {
    const body = { ...bodies[kind] };
    for (const key of optional[kind]) if (empty !== undefined) body[key] = empty;
    assert.deepEqual(missingFields(forms[kind].map(f => requiredField(f, kind, 'create', body)), body), {});
    assert.equal((await service.create(kind, body)).id, 'recSaved');
    if (kind === 'followup') assert.equal(saved.record.跟进主题, body['内容 / 推进结论']);
  }
  // Editing must persist explicit clears rather than silently retain old people.
  for (const key of optional[kind]) {
    const old = key === '客户联系人' ? { link_record_ids: ['recContact'] } : [123];
    const row = { ...saved, record: { ...saved.record, [key]: old } };
    const cleared = prepareEdit(kind, row, { changes: { [key]: [] } }, {}, '123');
    assert.deepEqual(cleared.writes[key], []);
    const value = key === '客户联系人' ? ['recContact'] : ['123'];
    const filled = prepareEdit(kind, saved, { changes: { [key]: value } }, {}, '123');
    assert.deepEqual(filled.writes[key], key === '客户联系人' ? value : [123]);
  }
});

test('optional contact still must belong to selected customer when provided', async () => {
  const service = new CrmService({}, {});
  service.get = async (kind, id) => ({ id, record: kind === 'contact'
    ? { 所属企业: { link_record_ids: ['recOther'] }, 联系人状态: '有效' } : {} });
  await assert.rejects(service.relationChecks('followup', { ...bodies.followup, 客户联系人: ['recContact'] },
    { 实际发生时间: Date.parse('2026-10-01T10:00:00+08:00') }), /联系人不属于/);
});
