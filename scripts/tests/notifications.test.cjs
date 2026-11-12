require('reflect-metadata');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { nextNotificationAt, notificationDay, validateNotificationSettings, buildNotification } = require('../../dist/shared/crm-notifications');
const { workspaceModel, taskMatches, taskFilterFromLink } = require('../../dist/shared/crm-workspace');
const { CrmNotificationsService } = require('../../dist/server/modules/crm/crm-notifications.service');
const { CrmNotificationsController } = require('../../dist/server/modules/crm/crm-notifications.controller');
const now = Date.parse('2026-10-29T08:00:03+08:00');
const due = Date.parse('2026-10-29T08:00:00+08:00');
const config = () => ({ id: 'config', enabled: true, sendTime: '08:00', recipientIds: ['123'], revision: 1, nextAt: new Date(due) });
const preview = () => ({ day: '2026-10-29', title: '每日跟进简报', content: '内容', overdueCount: 0, todayCount: 1, tomorrowCount: 0, otherCount: 0 });
const task = (id, at, people = ['123']) => ({ id, kind: 'followup', targetKind: 'project', name: id,
  customerName: '客户', action: '联系客户', people, due: at, status: '', state: '待跟进', missing: at === null });

// Scripted persistence boundary; no real messages or production data are modified.
function harness(results = [], messageResult = { success: true }) {
  const writes = [];
  const calls = [];
  function query(op) {
    const q = { then(resolve, reject) { try { resolve(pop()); } catch (e) { reject(e); } },
      from() { return q; }, where() { return q; }, orderBy() { return q; }, limit() { return q; },
      values(value) { writes.push({ op, value }); return q; }, set(value) { writes.push({ op, value }); return q; },
      onConflictDoNothing() { return q; }, returning() { return q; } };
    return q;
  }
  function pop() { assert.ok(results.length, 'unexpected database operation'); const next = results.shift(); if (next instanceof Error) throw next; return next; }
  const cleanups = [];
  const db = { select: () => query('select'), insert: () => query('insert'), update: () => query('update'),
    delete: table => ({ where: async condition => { cleanups.push({ table, condition }); } }) };
  const capability = { load(id) { assert.equal(id, 'crm-daily-notice'); return { async call(action, data) {
    calls.push({ action, data }); if (messageResult instanceof Error) throw messageResult; return messageResult;
  } }; } };
  const service = new CrmNotificationsService(db, capability, {}, {notificationTasks:async()=>[]});
  const finishes = [], advances = [];
  service.finish = async (...args) => finishes.push(args);
  service.advance = async (...args) => advances.push(args);
  service.setting = async () => config();
  service.preview = async () => preview();
  return { service, results, writes, calls, finishes, advances, cleanups };
}

test('retention deletes only notifications older than seven days even while reminders are disabled', async () => {
  const { PgDialect } = require('drizzle-orm/pg-core');
  const { crmNotificationDelivery } = require('../../dist/server/database/schema');
  const h = harness();
  h.service.setting = async () => ({ ...config(), enabled: false });
  await h.service.run(now);
  assert.equal(h.cleanups.length, 1);
  assert.equal(h.cleanups[0].table, crmNotificationDelivery);
  const query = new PgDialect().sqlToQuery(h.cleanups[0].condition);
  assert.match(query.sql, /"crm_notification_delivery"\."_created_at" < \$1/);
  assert.equal(new Date(query.params[0]).getTime(), now - 7 * 86400000);
  assert.equal(h.calls.length, 0);
  assert.equal(h.writes.length, 0);
});

test('cleanup failure does not block reminders or discard current delivery claims', async () => {
  const h = harness([[{ id: 'run', attempts: 1 }], [{ id: 'run' }], []]);
  h.service.db.delete = () => ({ where: async () => { throw Error('cleanup unavailable'); } });
  await h.service.run(now);
  assert.equal(h.calls.length, 0); // Existing recipient claim still prevents another send.
  assert.equal(h.advances.length, 1);
  assert.equal(h.results.length, 0);
});

test('time selection has Shanghai boundaries, midnight rollover and no immediate backfill', () => {
  assert.equal(notificationDay(Date.parse('2026-10-28T16:00:00Z')), '2026-10-29');
  assert.equal(nextNotificationAt('08:30', now).toISOString(), '2026-10-29T00:30:00.000Z');
  assert.equal(nextNotificationAt('08:00', now).toISOString(), '2026-10-30T00:00:00.000Z');
  assert.equal(nextNotificationAt('00:00', Date.parse('2026-10-29T23:59:59+08:00')).toISOString(), '2026-10-29T16:00:00.000Z');
  assert.throws(() => nextNotificationAt('08:15', now));
  assert.throws(() => validateNotificationSettings({ enabled: true, sendTime: '08:00', recipientIds: [], revision: 1 }));
  assert.throws(() => validateNotificationSettings({ enabled: true, sendTime: '08:00', recipientIds: [123], revision: 1 }));
});

test('digest ignores all legacy project plans and untracked historical suggestions', () => {
  const data = workspaceModel({ customer: [{ id: 'recC', record: { 企业全称: '客户', 下次跟进日期: due } }],
    project: [], followup: [{ id: 'recF', record: { 建议日期: due } }] }, 'all', '', now).data;
  const card = buildNotification(data.tasks, now, 'https://example.com/app/test');
  assert.equal(card.todayCount, 0); assert.equal(card.tomorrowCount, 0);
  assert.doesNotMatch(card.content, /record=recC|record=recF/);
});

test('card escapes user markup and respects message size while preserving total counts', () => {
  const tasks = Array.from({ length: 50 }, (_, i) => ({ id: `rec${i}`, kind: 'customer', name: '<img src="x">'.repeat(100),
    customerName: 'customer', action: '[link](x) <at id="all"> &'.repeat(100), people: ['123', '456', '789'],
    due: i % 2 ? due + 86400000 : due, status: 'today', state: '', missing: false }));
  const card = buildNotification(tasks, now, 'https://example.feishu.link/app/app_example000001');
  assert.equal(card.todayCount, 25); assert.equal(card.tomorrowCount, 25);
  assert.match(card.content, /还有 20 项/); assert.doesNotMatch(card.content, /<img|<at /);
  assert.ok(card.content.length <= 5000, String(card.content.length));
});

test('disabled and not-due schedules never read business data or send', async () => {
  const h = harness();
  h.service.preview = async () => { throw new Error('must not read'); };
  h.service.setting = async () => ({ ...config(), enabled: false }); await h.service.run(now);
  h.service.setting = async () => ({ ...config(), nextAt: new Date(now + 60000) }); await h.service.run(now);
  assert.equal(h.calls.length, 0); assert.equal(h.writes.length, 0);
});

test('empty days send a zero digest and record counts instead of skipping', async () => {
  const h = harness([[{ id: 'run', attempts: 1 }], [{ id: 'run' }], [{ id: 'delivery' }]]);
  h.service.preview = async () => ({ ...preview(), todayCount: 0 });
  await h.service.run(now);
  assert.equal(h.finishes[0][1], 'accepted'); assert.equal(h.calls.length, 1); assert.equal(h.advances.length, 1);
  const saved = h.writes.find(w => w.value.deliveryKey === 'daily:2026-10-29:123').value;
  for (const field of ['overdueCount', 'todayCount', 'tomorrowCount', 'otherCount']) assert.equal(saved[field], 0);
});

test('four groups are exclusive at Shanghai year boundaries, with dates before undated items', () => {
  const time = Date.parse('2026-12-31T16:00:00Z'); // Jan 1 in Shanghai
  const rows = [task('undated', null), task('later', time + 4 * 86400000),
    task('older', time - 1), task('today', time), task('todayLate', time + 86400000 - 1),
    task('tomorrow', time + 86400000), task('other', time + 2 * 86400000)];
  const before = structuredClone(rows);
  const card = buildNotification(rows, time, 'https://example.com');
  assert.deepEqual([card.overdueCount, card.todayCount, card.tomorrowCount, card.otherCount], [1, 2, 1, 3]);
  for (const row of rows) assert.equal(card.content.split(`record=${row.id})`).length - 1, 1);
  assert.ok(card.content.indexOf('record=other)') < card.content.indexOf('record=later)'));
  assert.ok(card.content.indexOf('record=later)') < card.content.indexOf('record=undated)'));
  assert.match(card.content, /下次跟进：2027-01-03/); assert.match(card.content, /未安排日期/);
  assert.deepEqual(rows, before);
  assert.deepEqual(rows.filter(row => taskMatches(row, 'other', time)).map(row => row.id), ['undated', 'later', 'other']);
  for (const filter of ['overdue', 'today', 'tomorrow', 'other', 'all']) {
    assert.match(card.content, new RegExp(`taskFilter=${filter}&scope=mine`));
    assert.equal(taskFilterFromLink(filter), filter);
  }
  for (const invalid of [null, 'invalid', '__proto__', 'constructor']) assert.equal(taskFilterFromLink(invalid), 'pending');
  assert.doesNotMatch(card.content, /scope=all/);
});

test('all zero groups remain visible without empty details, and each group limits details to five', () => {
  const empty = buildNotification([], now, 'https://example.com');
  for (const name of ['已逾期', '今日待跟进', '明日待跟进', '其他待跟进']) assert.match(empty.content, new RegExp(`${name} · 0 项`));
  assert.doesNotMatch(empty.content, /暂无|下次跟进|record=/);
  const rows = [-1, 0, 1, 2].flatMap(day => Array.from({ length: 7 }, (_, i) => task(`day${day}row${i}`, due + day * 86400000)));
  const full = buildNotification(rows, now, 'https://example.com');
  assert.deepEqual([full.overdueCount, full.todayCount, full.tomorrowCount, full.otherCount], [7, 7, 7, 7]);
  assert.equal(full.content.match(/record=/g).length, 20);
  assert.equal(full.content.match(/还有 2 项/g).length, 4);
});

test('enabled recipients receive their own digest including zero, from one data snapshot', async () => {
  const h = harness([[{ id: 'run', attempts: 1 }], [{ id: 'run' }], [{ id: 'first' }], [{ id: 'second' }]]);
  h.service.setting = async () => ({ ...config(), recipientIds: ['123', '456'] });
  h.service.preview = CrmNotificationsService.prototype.preview;
  let reads = 0;
  h.service.crm.notificationTasks = async () => { reads++; return [task('mineOverdue', due - 86400000),
    task('mineFuture', due + 4 * 86400000), task('unassigned', null, []), task('someoneElse', due, ['789'])]; };
  await h.service.run(now);
  assert.equal(reads, 1); assert.equal(h.calls.length, 2);
  const [first, second] = h.calls.map(call => call.data);
  assert.deepEqual(first.recipients, ['123']); assert.match(first.content, /record=mineOverdue/); assert.match(first.content, /record=mineFuture/);
  assert.doesNotMatch(first.content, /record=unassigned|record=someoneElse/);
  assert.deepEqual(second.recipients, ['456']); assert.doesNotMatch(second.content, /record=/);
  assert.equal(second.content.match(/· 0 项/g).length, 4);
});

test('preview and manual test both use the current account personal scope', async () => {
  const args = [];
  const controller = new CrmNotificationsController({ preview: (...values) => args.push(values) });
  controller.preview({ userContext: { userId: '123', roles: ['crm_admin'] } });
  assert.equal(args[0][1], '123');
  const h = harness([[], [{ id: 'delivery' }]]);
  h.service.preview = async (...values) => { args.push(values); return preview(); };
  h.service.state = async () => ({ settings: {}, logs: [] });
  await h.service.test('123', '12345678-1234-1234-1234-123456789abc');
  assert.equal(args[1][1], '123');
});

test('incomplete data is not sent; read retries stop after third attempt', async () => {
  for (const attempts of [1, 3]) {
    const h = harness([[{ id: 'run', attempts }]]);
    h.service.preview = async () => { throw Error('page missing'); };
    await h.service.run(now);
    assert.equal(h.calls.length, 0); assert.equal(h.finishes[0][1], 'read_failed');
    assert.equal(h.advances.length, attempts === 3 ? 1 : 0);
  }
});

test('concurrent run cannot advance an active worker schedule', async () => {
  const h = harness([[], [], [{ id: 'run', status: 'reading', attempts: 1, updatedAt: new Date(now) }]]);
  await h.service.run(now); assert.equal(h.calls.length, 0); assert.equal(h.advances.length, 0);
});

test('stale schedules never send a previous day digest', async () => {
  const h = harness([[{ id: 'run', attempts: 1 }]]);
  await h.service.run(now + 86400000);
  assert.equal(h.finishes[0][1], 'missed'); assert.equal(h.calls.length, 0);
});

test('daily delivery claims stable per-recipient keys before invoking exact plugin contract', async () => {
  const h = harness([[{ id: 'run', attempts: 1 }], [{ id: 'run' }], [{ id: 'delivery' }]]);
  await h.service.run(now);
  assert.equal(h.writes.filter(w => w.op === 'insert')[1].value.deliveryKey, 'daily:2026-10-29:123');
  assert.deepEqual(h.calls, [{ action: 'send_feishu_message', data: { recipients: ['123'], title: preview().title, content: preview().content } }]);
  assert.equal(h.finishes[0][1], 'accepted'); assert.equal(h.results.length, 0);
});

test('existing delivery claims prevent resend after a time change', async () => {
  const h = harness([[]]);
  await h.service.deliver('daily:2026-10-29:123', '123', 'daily', preview());
  assert.equal(h.calls.length, 0);
});

test('missing acknowledgements and timeouts stay uncertain and are not retried', async () => {
  for (const result of [{ success: false }, {}, new Error('timeout')]) {
    const h = harness([[{ id: 'delivery' }]], result);
    await h.service.deliver('daily:2026-10-29:123', '123', 'daily', preview());
    assert.equal(h.calls.length, 1); assert.equal(h.finishes[0][1], 'uncertain');
  }
});

test('configuration changed during reading stops the old recipients', async () => {
  const h = harness([[{ id: 'run', attempts: 1 }], [{ id: 'run' }]]);
  let reads = 0;
  h.service.setting = async () => ({ ...config(), revision: ++reads });
  await h.service.run(now); assert.equal(h.calls.length, 0); assert.equal(h.finishes[0][1], 'stopped');
});

test('all settings, preview and test APIs reject non-admins before any side effect', () => {
  const controller = new CrmNotificationsController(new Proxy({}, { get() { throw Error('service must not be called'); } }));
  for (const roles of [undefined, [], ['crm_employee']]) {
    const req = { userContext: { userId: '123', roles } };
    for (const action of ['state', 'save', 'preview', 'test']) assert.throws(() => controller[action](req, {}), /仅限管理员/);
  }
});
