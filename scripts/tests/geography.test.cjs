require('reflect-metadata');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseCustomerRegion, formatCustomerRegion } = require('../../dist/shared/crm-region');
const { customerGeography, geographyMatches } = require('../../dist/shared/crm-geography');
const { CrmService } = require('../../dist/server/modules/crm/crm.service');
const { CrmController } = require('../../dist/server/modules/crm/crm.controller');
const { parseDraft } = require('../../dist/server/modules/crm/crm-validation');
const { prepareEdit } = require('../../dist/server/modules/crm/crm-edit');
const { forms } = require('../../dist/shared/crm');
const row = (id, record) => ({ id, record });
const link = id => ({ link_record_ids: [id] });

test('region compatibility recognizes province/city prefixes and preserves uncertain originals', () => {
  assert.deepEqual(parseCustomerRegion('江苏 苏州 工业园区'), { province: '江苏省', city: '苏州市', address: '工业园区' });
  assert.deepEqual(parseCustomerRegion('上海浦东新区'), { province: '上海市', city: '上海市', address: '浦东新区' });
  assert.deepEqual(parseCustomerRegion('吉林市'), { province: '吉林省', city: '吉林市', address: '' });
  assert.deepEqual(parseCustomerRegion('苏州市高新区'), { province: '江苏省', city: '苏州市', address: '高新区' });
  assert.deepEqual(parseCustomerRegion('广西/南宁'), { province: '广西壮族自治区', city: '南宁市', address: '' });
  for (const raw of ['华东地区', '上海路123号', '国外地址 / 未知城市', '  待确认  ', '']) {
    assert.deepEqual(parseCustomerRegion(raw), { province: '', city: '', address: raw });
  }
});

test('canonical region round trips preserve empty cities, full addresses, separators and typing spaces', () => {
  for (const region of [
    { province: '江苏省', city: '苏州市', address: '工业园区 / A楼 1层 ' },
    { province: '江苏省', city: '', address: '南京路1号' },
    { province: '江苏省', city: '', address: '' },
    { province: '上海市', city: '上海市', address: '' },
    { province: '其他地区', city: '', address: 'Singapore / Building A' },
  ]) assert.deepEqual(parseCustomerRegion(formatCustomerRegion(region)), region);
});

test('geography merges direct/project communication, excludes invalid contacts/logs and does not mutate records', () => {
  const source = {
    customer: [row('recC1', { 企业全称: 'A', 地区: '江苏苏州', 客户负责人: [123] }),
      row('recC2', { 企业全称: 'B', 地区: '江苏省' }), row('recC3', { 企业全称: 'C', 地区: '待核对' })],
    project: [row('recP1', { 所属企业: link('recC1') }), row('recP2', { 所属企业: link('recC1') })],
    contact: [row('recT1', { 所属企业: link('recC1'), 联系人状态: '有效', 姓名: '张', 电话: '123' }),
      row('recT2', { 所属企业: link('recC1'), 联系人状态: '停用' }),
      row('recT3', { 所属企业: link('recC1'), 联系人状态: '有效', 数据检查: '身份异常' })],
    followup: [
      row('recF1', { 跟进归属: '客户直接跟进', 直接客户: link('recC1'), 记录状态: '正常', 实际发生时间: 100, '内容 / 推进结论': '直接联系' }),
      row('recF2', { 跟进归属: '项目跟进', 关联项目: link('recP1'), 记录状态: '正常', 实际发生时间: 200, '内容 / 推进结论': '项目沟通' }),
      row('recF3', { 跟进归属: '项目跟进', 关联项目: link('recP1'), 记录状态: '已作废', 实际发生时间: 300 }),
      row('recF4', { 跟进归属: '项目跟进', 关联项目: link('recP1'), 记录状态: '正常', 实际发生时间: 9999 }),
      row('recF5', { 跟进归属: '客户直接跟进', 直接客户: link('recC1'), 记录状态: '正常', 数据检查: '异常', 实际发生时间: 300 }),
      row('recF6', { 跟进归属: '项目跟进', 关联项目: link('recMissing'), 记录状态: '正常', 实际发生时间: 300 }),
    ],
  };
  const before = structuredClone(source);
  const data = customerGeography(source, 1000);
  assert.deepEqual(source, before);
  const customer = data.customers.find(row => row.id === 'recC1');
  assert.equal(customer.projectCount, 2);
  assert.deepEqual(customer.contacts.map(row => row.id), ['recT1']);
  assert.deepEqual(customer.owners, ['123']);
  assert.equal(customer.latestFollowup.id, 'recF2');
  assert.equal(customer.originalRegion, '江苏苏州');
  const count = (province = '', city = '', search = '') => data.customers.filter(row => geographyMatches(row, province, city, search)).length;
  assert.equal(count(), 3); assert.equal(count('江苏省'), 2);
  assert.equal(count('江苏省', '苏州市'), 1); assert.equal(count('江苏省', '__missing__'), 1);
  assert.equal(count('__missing__'), 1); assert.equal(count('', '', '苏州'), 1);
  assert.equal(count('上海市', '', 'A'), 0);
});

test('geography reads every page and rejects partial snapshots; API requires existing login boundary', async () => {
  const service = new CrmService({}, {}, {});
  const customers = Array.from({ length: 51 }, (_, i) => row(`recC${i}`, { 企业全称: String(i), 地区: '上海市' }));
  service.list = async (kind, cursor) => kind === 'customer' ?
    { records: cursor ? customers.slice(50) : customers.slice(0, 50), hasMore: !cursor, pageToken: cursor ? undefined : 'next' } :
    { records: [], hasMore: false };
  assert.equal((await service.geography()).customers.length, 51);
  service.list = async () => ({ records: [], hasMore: true });
  await assert.rejects(service.geography(), /分页不完整/);
  let calls = 0;
  const controller = new CrmController({ geography: () => ++calls });
  assert.throws(() => controller.geography({}), /登录/);
  controller.geography({ userContext: { userId: '123', roles: [] } });
  assert.equal(calls, 1);
});

test('customer region is optional and edits preserve legacy values unless explicitly changed', () => {
  const input = { 企业全称: 'A', 行业: '化工' };
  assert.doesNotThrow(() => parseDraft(input, forms.customer, {}));
  const customer = row('recC', { ...input, 地区: '老地址原文', 客户备注: '' });
  const untouched = prepareEdit('customer', customer, { changes: { 客户备注: '新备注' } }, {}, '123');
  assert.equal(Object.hasOwn(untouched.writes, '地区'), false);
  const cleared = prepareEdit('customer', customer, { changes: { 地区: '' } }, {}, '123');
  assert.equal(cleared.writes.地区, '');
});
