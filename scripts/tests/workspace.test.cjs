require('reflect-metadata');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { workspaceModel, workspaceRecords, taskMatches, taskTab, taskFilterFromLink } = require('../../dist/shared/crm-workspace.js');
const { CrmService } = require('../../dist/server/modules/crm/crm.service.js');
const { CrmController } = require('../../dist/server/modules/crm/crm.controller.js');
const now = Date.parse('2026-10-27T10:00:00+08:00');
const t = value => Date.parse(value + 'T00:00:00+08:00');
const customer = (id, record = {}) => ({ id, record: { 企业全称: id, 创建时间: t('2026-09-01'),
  客户负责人: [1], 当前下一步行动: '联系客户', 下次跟进日期: t('2026-10-27'), ...record } });
const project = (id, customerId, record = {}) => ({ id, record: { 项目名称: id, 所属企业: { link_record_ids: [customerId] },
  创建时间: t('2026-10-01'), 工作状态: '进行中', 终局确认: '未确认', 当前下一步行动: '确认方案', 下次跟进日期: t('2026-10-28'), 项目负责人: [1], ...record } });
const followup = (id, kind, target, record = {}) => ({ id, record: { 跟进主题: id, 创建时间: t('2026-10-26'), 实际发生时间: t('2026-10-26'), 实际跟进人: [2],
  跟进归属: kind === 'customer' ? '客户直接跟进' : '项目跟进', [kind === 'customer' ? '直接客户' : '关联项目']: { link_record_ids: [target] },
  记录状态: '正常', '内容 / 推进结论': '已沟通', ...record } });

test('workspace preserves customer/project totals without converting legacy plans into reminders', () => {
  const src = { customer: [customer('recToday'), customer('recOverdue', { 下次跟进日期: t('2026-10-26'), 当前下一步行动: '' }),
    customer('recEnded', { 已归档: true }), customer('recArchived', { 已归档: true })],
    project: [project('recTomorrow', 'recToday'), project('recMissing', 'recToday', { 当前下一步行动: '', 下次跟进日期: null }),
      project('recClosed', 'recToday', { 工作状态: '已签合同', 签约日期: t('2026-10-26'), 已归档: true })], followup: [] };
  const { data } = workspaceModel(src, 'all', '1', now);
  assert.deepEqual(data.counts, { today: 0, tomorrow: 0, overdue: 0, missing: 0 });
  assert.equal(data.tasks.length, 0);
  assert.equal(data.totals.customer.total, 4); assert.equal(data.totals.project.total, 3);
  assert.equal(data.project.monthCompleted, 1); assert.equal(data.project.archived, undefined);
  assert.equal(data.project.states.已签合同, 1);
  assert.deepEqual(data.tasks.filter(row => taskMatches(row, 'priority', now)).map(row => row.id), []);
});
test('personal scope includes collaborators, executors, related customers and participant followups without inflating all-team totals', () => {
  const src = { customer: [customer('recC1', { 客户负责人: [2] }), customer('recC2', { 客户负责人: [3] }), customer('recC3', { 客户负责人: [3] })],
    project: [project('recP1', 'recC1', { 项目负责人: [2], 协同人员: [1] }), project('recP2', 'recC2', { 项目负责人: [3], 协同人员: [1] }), project('recP3', 'recC3', { 项目负责人: [3] })],
    followup: [followup('recF1', 'project', 'recP1'), followup('recF2', 'project', 'recP3'), followup('recF3', 'project', 'recP3', { 实际跟进人: [1] })] };
  const personal = workspaceModel(src, 'mine', '1', now);
  assert.deepEqual(personal.records.project.map(row => row.id), ['recP1', 'recP2']);
  assert.deepEqual(personal.records.customer.map(row => row.id), ['recC1', 'recC2']);
  assert.deepEqual(personal.records.followup.map(row => row.id), ['recF1', 'recF3']);
  assert.equal(workspaceModel(src, 'all', '1', now).data.totals.followup.total, 3);
});
test('recent valid project communication prevents stale-customer warnings even when a colleague owns the project', () => {
  const src = { customer: [customer('recC'), customer('recOld'), customer('recNew', { 创建时间: t('2026-10-25') })],
    project: [project('recP', 'recC', { 项目负责人: [9] })], followup: [followup('recF', 'project', 'recP'),
      followup('recVoid', 'customer', 'recOld', { 记录状态: '已作废' }), followup('recFuture', 'customer', 'recOld', { 实际发生时间: now + 86400000 }),
      followup('recInvalid', 'customer', 'recOld', { 数据检查: { text: '关联错误' } }), followup('recOrphan', 'customer', 'recMissing')] };
  const model = workspaceModel(src, 'mine', '1', now);
  assert.deepEqual(model.data.attention.map(row => row.id), ['recOld']);
  assert.equal(model.data.attention[0].lastAt, null);
  assert.equal(workspaceModel(src, 'all', '1', now).data.totals.followup.total, 1);
});
test('recent activity is ordered by occurrence, monthly additions by creation, using Shanghai month boundaries', () => {
  const localNow = Date.parse('2026-11-01T01:00:00+08:00');
  const src = { customer: [customer('recC')], project: [], followup: [
    followup('recHistorical', 'customer', 'recC', { 创建时间: Date.parse('2026-11-01T00:30:00+08:00'), 实际发生时间: t('2026-10-01') }),
    followup('recRecent', 'customer', 'recC', { 创建时间: Date.parse('2026-10-31T23:30:00+08:00'), 实际发生时间: Date.parse('2026-10-31T23:30:00+08:00') })] };
  const model = workspaceModel(src, 'all', '1', localNow);
  assert.equal(model.data.totals.followup.total, 2); assert.equal(model.data.totals.followup.monthNew, 1);
  assert.equal(model.data.recent[0].id, 'recRecent');
  assert.deepEqual(workspaceRecords(model, 'followup', 'month').map(row => row.id), ['recHistorical']);
});
test('every total and project status drills down with exactly the same scope and filters', () => {
  const src = { customer: [customer('recC')], project: [project('recP', 'recC'),
    project('recEnded', 'recC', { 工作状态: '已签合同', 签约日期: t('2026-10-26') }),
    project('recArchive', 'recC', { 工作状态: '已签合同', 签约日期: t('2026-10-26'), 已归档: true })], followup: [followup('recF', 'customer', 'recC')] };
  const m = workspaceModel(src, 'mine', '1', now);
  for (const kind of ['customer', 'project', 'followup']) {
    assert.equal(workspaceRecords(m, kind, 'all').length, m.data.totals[kind].total);
    assert.equal(workspaceRecords(m, kind, 'month').length, m.data.totals[kind].monthNew);
  }
  for (const state of Object.keys(m.data.project.states)) assert.equal(workspaceRecords(m, 'project', state).length, m.data.project.states[state]);
  assert.equal(workspaceRecords(m, 'project', 'completed-month').length, m.data.project.monthCompleted);
  assert.equal(workspaceRecords(m, 'project', 'active').length, m.data.project.active);
  assert.throws(() => workspaceRecords(m, 'project', 'archived'), /筛选无效/);
  assert.equal(workspaceRecords(m, 'customer', 'attention').length, m.data.attentionTotal);
  assert.throws(() => workspaceRecords(m, 'customer', 'active'), /筛选无效/);
});
test('tomorrow and calendar-week filters handle Sunday, Monday and cross-month correctly', () => {
  const sunday = Date.parse('2026-11-01T23:00:00+08:00');
  const m = workspaceModel({ customer: [customer('recMonday', { 下次跟进日期: t('2026-11-02') }), customer('recSunday', { 下次跟进日期: t('2026-11-01') })], project: [], followup: [
    followup('recSundayLog', 'customer', 'recSunday', { 后续处理: '待跟进', 后续安排: '有下一步行动', 建议日期: t('2026-11-01') }),
    followup('recMondayLog', 'customer', 'recMonday', { 后续处理: '待跟进', 后续安排: '有下一步行动', 建议日期: t('2026-11-02') })] }, 'all', '1', sunday);
  assert.equal(m.data.counts.tomorrow, 1);
  assert.deepEqual(m.data.tasks.filter(row => taskMatches(row, 'week', sunday)).map(row => row.id), ['recSundayLog']);
  assert.equal(taskMatches(m.data.tasks.find(row => row.id === 'recMondayLog'), 'week', t('2026-11-02')), true);
});
test('service traverses all three tables, pages drilldowns and rejects partial/inconsistent pages', async () => {
  const rows = Array.from({ length: 63 }, (_, index) => customer(`recC${index}`, { 创建时间: now - index * 1000 }));
  const service = new CrmService({}, {}, {}); const reads = [];
  service.list = async (kind, cursor) => { reads.push([kind, cursor]); return kind === 'customer'
    ? { records: cursor ? rows.slice(50) : rows.slice(0, 50), hasMore: !cursor, ...(cursor ? {} : { pageToken: 'next' }) } : { records: [], hasMore: false }; };
  assert.equal((await service.workspace('all', '1')).totals.customer.total, 63);
  assert.ok(reads.some(([kind, cursor]) => kind === 'customer' && cursor === 'next'));
  const page = await service.workspaceList('all', '1', 'customer', 'all', 'offset:20');
  assert.equal(page.total, 63); assert.equal(page.records.length, 20); assert.equal(page.pageToken, 'offset:40');
  assert.equal(page.records[0].id, 'recC20');
  await assert.rejects(service.workspaceList('all', '1', 'access', 'all'), /数据类型无效/);
  await assert.rejects(service.workspaceList('all', '1', 'customer', 'all', 'bad'), /分页标记无效/);
  service.list = async () => ({ records: [rows[0]], hasMore: true, pageToken: 'repeat' });
  await assert.rejects(service.workspace('all', '1'), /分页数据变化|分页不完整/);
  service.list = async () => { throw new Error('read failure'); };
  await assert.rejects(service.workspace('all', '1'), /read failure/);
});
test('workspace endpoints require login, accept ordinary employees and use the server identity', async () => {
  const calls = []; const controller = new CrmController({ workspace: (...args) => calls.push(args), workspaceList: (...args) => calls.push(args) });
  assert.throws(() => controller.workspace({}, 'all'), /登录/);
  controller.workspace({ userContext: { userId: '123', roles: [] } }, 'mine');
  assert.deepEqual(calls[0], ['mine', '123']);
  controller.workspaceRecords({ userContext: { userId: '123' } }, 'mine', 'followup', 'all');
  assert.deepEqual(calls[1].slice(0, 4), ['mine', '123', 'followup', 'all']);
});

test('workspace tabs partition pending and overdue while week uses the calendar boundary', () => {
  const localNow = Date.parse('2026-11-01T23:59:00+08:00');
  const dates = [null, '2026-10-25', '2026-10-26', '2026-11-01', '2026-11-02'];
  const src = { customer: [customer('recC')], project: [], followup: dates.map((date, i) =>
    followup(`recF${i}`, 'customer', 'recC', { 后续处理: '待跟进', 后续安排: '有下一步行动',
      建议下一步行动: '继续沟通', 建议日期: date ? t(date) : null })) };
  const { data } = workspaceModel(src, 'all', '1', localNow);
  const ids = filter => data.tasks.filter(row => taskMatches(row, filter, localNow)).map(row => row.id).sort();
  assert.deepEqual(ids('pending'), ['recF0', 'recF3', 'recF4']);
  assert.deepEqual(ids('overdue'), ['recF1', 'recF2']);
  assert.deepEqual([...ids('pending'), ...ids('overdue')].sort(), ids('all'));
  assert.deepEqual(ids('week'), ['recF2', 'recF3']);
  assert.equal(taskFilterFromLink(null), 'pending');
  assert.equal(taskTab('week'), 'all');
  assert.equal(taskTab('overdue'), 'overdue');
  for (const filter of ['pending', 'today', 'tomorrow', 'other', 'missing']) {
    assert.equal(taskTab(filter), 'pending');
  }
});
