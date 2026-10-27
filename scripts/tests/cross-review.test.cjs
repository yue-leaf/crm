const { identityFixture } = require('./helpers/identity.cjs');
require('reflect-metadata');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { CrmService } = require('../../dist/server/modules/crm/crm.service.js');
const { prepareEdit } = require('../../dist/server/modules/crm/crm-edit.js');
const { historicalContext } = require('../../dist/server/modules/crm/crm-workflow.js');

function fixture() {
  const row = { id: 'recProject', record: {
    项目名称: 'Example', 项目类型: 'MRT', 所属企业: { link_record_ids: ['recCustomer'] },
    项目负责人: [123], '目标 / 需求摘要': 'Goal', 工作状态: '待启动', 终局确认: '未确认',
    当前下一步行动: 'Plan', 下次跟进日期: Date.parse('2026-10-20T00:00:00+08:00'),
    预计金额: 100, 币种: 'CNY', 金额含税口径: '含税', 核查标记: '待核查', 修改时间: 1,
  } };
  const writes = [];
  const service = new CrmService({
    getCapability: () => ({ formValue: { fields: [] } }),
    load: name => ({ call: async (action, input) => {
      if (action === 'getRecord') return structuredClone(name === 'crm-customer'
        ? { id: 'recCustomer', record: { 核查标记: '正常', 已归档: false } } : row);
      if (action === 'searchRecords') return { records: [{ record: { 飞书成员: [123] } }], hasMore: false };
      assert.equal(action, 'batchUpdateRecords');
      writes.push(input.records[0].record);
      Object.assign(row.record, input.records[0].record, { 修改时间: row.record.修改时间 + 1 });
      return { records: [{ id: row.id }] };
    } }),
  }, identityFixture());
  const update = (operation, body) => service.update('project', row.id, operation,
    { ...body, expectedModifiedAt: row.record.修改时间 }, 'test-only');
  return { row, writes, service, update };
}
test('paused project without plan remains editable without a review workflow', async () => {
  const f = fixture();
  Object.assign(f.row.record, { 工作状态: '暂停', 暂停原因: 'Waiting' });
  delete f.row.record.当前下一步行动;
  delete f.row.record.下次跟进日期;
  assert.equal(require('../../dist/shared/crm-review.js').recordReviewProblem('project', f.row.record), '');
  await f.update('edit', { changes: { 项目名称: 'Renamed' }, reason: 'Rename while paused' });
  assert.equal(require('../../dist/shared/crm-review.js').recordReviewProblem('project', f.row.record), '');
  assert.equal(f.row.record.项目名称, 'Renamed');
  assert.equal(f.row.record.当前下一步行动, undefined);
});
test('switching MRT to PAT retains historical money without rewriting it', async () => {
  const f = fixture();
  await f.update('edit', { changes: { 项目类型: 'PAT' }, reason: 'Work category changed' });
  assert.equal(f.row.record.预计金额, 100);
  assert.equal(Object.hasOwn(f.writes[0], '预计金额'), false);
  assert.equal(f.row.record.项目类型, 'PAT');
  await assert.rejects(() => f.update('edit', { changes: { 预计金额: 200 }, reason: 'Must reject new commerce' }), /商务/);
});
test('invalid lifecycle states and incomplete cancellation data fail the current quality gate', () => {
  const {recordReviewProblem}=require('../../dist/shared/crm-review.js');
  for(const patch of [{终局确认:'未知状态'},{工作状态:'未知状态'},
    {终局确认:'已取消'},{终局确认:'已取消',结束日期:Date.now()-86400000,结果说明:'Stopped'},
    {工作状态:'已签合同'}]) {
    const f=fixture();Object.assign(f.row.record,patch);
    assert.ok(recordReviewProblem('project',f.row.record));assert.equal(f.writes.length,0);
  }
});

test('invalid terminal states do not allow ordinary edits', () => {
  const f = fixture();f.row.record.终局确认 = '未知状态';
  assert.throws(() => prepareEdit('project', f.row, { changes: { 项目名称: 'Changed' }, reason: 'x' }, {}, 'test'));
});
test('retired archive metadata does not block customer followups', () => {
  assert.doesNotThrow(() => historicalContext('customer', {record:{已归档:true,归档时间:Date.now()+3600000}},Date.now()-1000));
});

test('cancelled records need no plan and retired review cannot write them', async () => {
  const f=fixture();Object.assign(f.row.record,{终局确认:'已取消',结束日期:Date.now()-86400000,结果说明:'Stopped',取消原因:'Stopped'});
  delete f.row.record.当前下一步行动;delete f.row.record.下次跟进日期;
  assert.equal(require('../../dist/shared/crm-review.js').recordReviewProblem('project',f.row.record),'');
  await assert.rejects(()=>f.update('review',{核查说明:'old client'}),/不支持/);
  assert.equal(f.writes.length,0);
});
