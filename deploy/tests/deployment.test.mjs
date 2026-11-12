import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Cli, CliError, Journal, capability, parseJsonOutput, readJson, releaseState, sha, unwrap, validateConfig, verifyIdentity, within, writeJson } from '../core.mjs';
import { parseArgs } from '../run.mjs';
import { Deployment } from '../engine.mjs';

const root = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const blueprint = readJson(path.join(root, 'deploy/blueprint.json'));
const config = () => { const { warnings, ...c } = validateConfig({ ...readJson(path.join(root, 'deploy/tenants/company-b.example.json')), accessMode: 'admin-only', expectedCliAppId: 'cli_target', expectedUserOpenId: 'ou_target', expectedTenantKey: 'tenantTarget', expectedEnterpriseDisplayId: 'ENTB' }, true); return c; };
const temp = t => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-deploy-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true })); return dir; };

test('preview does not create directories or run any process', t => {
  const dir = temp(t);
  const before = fs.readdirSync(dir);
  const plan = new Deployment({ root: dir, config: config(), blueprint, options: { publish: true }, cli: { call() { throw new Error('must not call'); } } }).plan();
  assert.equal(plan.counts.tables, 5);
  assert.equal(plan.counts.dashboardBlocks, 14);
  assert.deepEqual(fs.readdirSync(dir), before);
});
test('placeholder config may preview but cannot apply', () => {
  const example = readJson(path.join(root, 'deploy/tenants/company-b.example.json'));
  assert.ok(validateConfig(example).warnings.length);
  assert.throws(() => validateConfig(example, true), /真实配置/);
});
test('unknown keys, secrets, path traversal and public scope fail closed', () => {
  assert.throws(() => validateConfig({ ...config(), appSecret: 'secret' }), /不支持/);
  assert.throws(() => validateConfig({ ...config(), deploymentKey: '../original' }), /deploymentKey/);
  assert.throws(() => validateConfig({ ...config(), accessMode: 'public' }), /admin-only/);
  assert.throws(() => within('/task/run', '/task/original'), /路径/);
});
test('argument parser rejects unsafe ambiguity and requires explicit publish intent', () => {
  assert.throws(() => parseArgs(['--config', 'a', '--publish']), /Apply/);
  assert.throws(() => parseArgs(['--config', 'a', '--config', 'b']), /重复/);
  assert.throws(() => parseArgs(['--config', 'a', '--inspect-identity', '--apply']), /不能/);
  assert.throws(() => parseArgs(['--config', 'a', '--retry-action', 'anything']), /哈希/);
  assert.equal(parseArgs(['--config', 'a', '--apply', '--publish']).publish, true);
});
test('identity checks app, open ID, user identity and tenant key independently', () => {
  const c = config(), identity = { appId: c.expectedCliAppId, identity: 'user', available: true, onBehalfOf: { openId: c.expectedUserOpenId } }, user = { open_id: c.expectedUserOpenId, tenant_key: c.expectedTenantKey };
  assert.equal(verifyIdentity(c, identity, user).tenantKey, 'tenantTarget');
  assert.throws(() => verifyIdentity(c, { ...identity, appId: 'cli_other' }, user));
  assert.throws(() => verifyIdentity(c, { ...identity, identity: 'bot' }, user));
  assert.throws(() => verifyIdentity(c, identity, { ...user, tenant_key: 'other' }));
  assert.throws(() => verifyIdentity(c, identity, { ...user, tenant_key: undefined }));
});
test('JSON contract accepts ok:true, handles init progress, and rejects missing success envelope', () => {
  assert.equal(parseJsonOutput('', '-> progress\n{"ok":false,"error":{"type":"validation"}}').ok, false);
  const calls = [];
  const cli = new Cli('target', { cliPath: '/cli/run.js', execute(exe, args) { calls.push(args); return { status: 0, stdout: '{"ok":true,"data":{"id":1}}', stderr: '' }; } });
  assert.equal(cli.call(['apps', '+get', '--app-id', 'app_target']).data.id, 1);
  assert.deepEqual(calls[0].slice(-4), ['--as', 'user', '--profile', 'target']);
  const bad = new Cli('target', { cliPath: '/cli/run.js', execute: () => ({ status: 0, stdout: '{"code":0}', stderr: '' }) });
  assert.throws(() => bad.call(['apps', '+get']), /ok:true/);
});
test('CLI error never echoes credential-like upstream error text', () => {
  const error = new CliError(1, { error: { type: 'network', message: 'access_token=secret-token', hint: 'Authorization: secret' } });
  assert.ok(!error.message.includes('secret'));
});
test('completed mutation is not issued twice; changed command refuses replay', t => {
  const j = new Journal(temp(t), 'fingerprint'); let count = 0;
  j.effect('create', ['apps', '+create', 'a'], () => ({ id: ++count }));
  const resumed = new Journal(j.dir, 'fingerprint');
  assert.equal(resumed.effect('create', ['apps', '+create', 'a'], () => ++count).id, 1);
  assert.equal(count, 1);
  assert.throws(() => resumed.effect('create', ['apps', '+create', 'b'], () => 2), /变化/);
});
test('unknown write outcome blocks retry until exact hash explicitly supplied', t => {
  const dir = temp(t), args = ['apps', '+create', '--name', 'isolated'];
  const j = new Journal(dir, 'f');
  assert.throws(() => j.effect('create', args, () => { throw new Error('network'); }));
  let called = false;
  assert.throws(() => new Journal(dir, 'f').effect('create', args, () => { called = true; }), /结果不确定/);
  assert.equal(called, false);
  assert.equal(new Journal(dir, 'f', { retryAction: sha(args) }).effect('create', args, () => 'approved-retry'), 'approved-retry');
});
test('exit 10 does not silently add yes; approval is bound to exact argv', t => {
  const dir = temp(t), args = ['base', '+role-update', '--base-token', 'new']; let calls = [];
  const perform = yes => { calls.push(yes); if (!yes) throw new CliError(10, { error: { type: 'confirmation', subtype: 'confirmation_required' } }); return 'updated'; };
  assert.throws(() => new Journal(dir, 'f').effect('role', args, perform), /ApproveAction/);
  assert.deepEqual(calls, [false]);
  const approved = new Journal(dir, 'f', { approveAction: sha(args) });
  assert.equal(approved.effect('role', args, perform), 'updated');
  assert.deepEqual(calls, [false, false, true]);
});
test('config drift and concurrent deployment are rejected', t => {
  const dir = temp(t), j = new Journal(dir, 'f'); j.save();
  assert.throws(() => new Journal(dir, 'changed'), /配置/);
  const release = j.lock();
  assert.throws(() => new Journal(dir, 'f').lock(), /锁定/);
  release();
});
test('capability regenerates target IDs and preserves writable-field protection', () => {
  const cap = capability('access', 'newBase', 'newTable', [{ id: 'newField', name: '成员标识', type: 'text' }, { id: 'newRole', name: '待配置角色', type: 'select', multiple: false, options: [{ name: '员工' }, { name: '管理员' }] }]);
  assert.equal(cap.formValue.fields[0].writeable, false);
  assert.equal(cap.formValue.fields[1].writeable, true);
  assert.equal(cap.formValue.appToken, 'newBase');
  const attachment = { id: 'attachment', name: '附件', type: 'attachment' };
  assert.equal(capability('followup', 'newBase', 'newTable', [attachment]).formValue.fields[0].writeable, true);
  assert.equal(capability('customer', 'newBase', 'newTable', [attachment]).formValue.fields[0].writeable, false);
  assert.throws(() => capability('customer', 'new', 'table', [{ id: 'x', name: 'bad', type: 'unknown' }]));
});
test('release terminal state wins over stale PENDING node; wrong commit fails', () => {
  assert.equal(releaseState({ status: 'finished', commit_id: 'a', current_node_info: { current_status: 'PENDING' } }, 'a'), 'finished');
  assert.equal(releaseState({ status: 'publishing', current_node_info: { current_status: 'PENDING' } }, 'a'), 'awaiting-approval');
  assert.equal(releaseState({ status: 'strange' }, 'a'), 'unknown');
  assert.equal(releaseState({ status: 'failed' }, 'a'), 'failed');
  assert.throws(() => releaseState({ status: 'finished', commit_id: 'wrong' }, 'a'), /提交/);
});
test('blueprint has no source IDs or text components; action views use automatic followup rules', () => {
  assert.equal(blueprint.dashboard.length, 14);
  assert.ok(!blueprint.dashboard.some(b => b.type === 'text'));
  assert.ok(!/CJLFbJHZ|ou_[A-Za-z0-9]|tbl[A-Za-z0-9]{8}|fld[A-Za-z0-9]{8}|示例员工甲/.test(JSON.stringify(blueprint)));
  for (const kind of ['customer', 'project']) {
    const today = blueprint.views.find(v => v.table === kind && v.name === '今日跟进');
    const overdue = blueprint.views.find(v => v.table === kind && v.name === '逾期');
    assert.ok(today.conditions.some(c => c[0] === '跟进状态' && c[2] === '今日跟进'));
    assert.ok(overdue.conditions.some(c => c[0] === '逾期' && c[2] === 'true'));
    for (const view of [today, overdue]) assert.ok(!view.conditions.some(c => c[0] === '核查标记'));
  }
});

function fixture(t) {
  const dir = temp(t), c = config();
  const cloud = { calls: [], tables: [], views: {}, blocks: [], records: {}, roles: [], users: [], roleMembers: {}, commit: 'a'.repeat(40), releaseCreates: 0, scope: null, status: 'finished' };
  fs.cpSync(path.join(root, 'deploy/templates'), path.join(dir, 'deploy/templates'), { recursive: true });
  let next = 1;
  const envelope = data => ({ ok: true, identity: 'user', data });
  const cli = { call(argv) {
    cloud.calls.push(argv);
    const [domain, cmd] = argv;
    const arg = name => argv[argv.indexOf(name) + 1];
    const json = argv.includes('--json') ? JSON.parse(arg('--json')) : null;
    const table = () => cloud.tables.find(t => t.id === arg('--table-id'));
    const view = () => cloud.views[arg('--view-id')];
    if (domain === 'whoami') return { identity: 'user', available: true, appId: c.expectedCliAppId, onBehalfOf: { openId: c.expectedUserOpenId } };
    if (domain === 'api') return envelope({ open_id: c.expectedUserOpenId, tenant_key: c.expectedTenantKey });
    if (domain === 'contact') return envelope({ users: [{ open_id: argv.includes('--user-ids') ? arg('--user-ids') : c.expectedUserOpenId, localized_name: '目标成员', is_cross_tenant: false, is_activated: true }], has_more: false });
    if (domain === 'base') {
      if (cmd === '+base-create') {
        cloud.name = arg('--name');
        cloud.tables.push({ id: `tbl${next++}`, name: arg('--table-name'), fields: JSON.parse(arg('--fields')).map(f => ({ ...f, id: `fld${next++}` })) });
        return envelope({ base: { base_token: 'newBase', url: 'https://target.feishu.cn/base/newBase' }, table: cloud.tables[0] });
      }
      if (cmd === '+base-get') return envelope({ base: { name: cloud.name, is_advanced: !!cloud.advanced, url: 'https://target.feishu.cn/base/newBase' } });
      if (cmd === '+table-list') return envelope({ tables: cloud.tables.map(({ id, name }) => ({ id, name })), has_more: false });
      if (cmd === '+table-create') { const t = { id: `tbl${next++}`, name: arg('--name'), fields: JSON.parse(arg('--fields')).map(f => ({ ...f, id: `fld${next++}` })) }; cloud.tables.push(t); return envelope({ table: t }); }
      if (cmd === '+table-get') return envelope({ fields: table().fields });
      if (cmd === '+field-create') {
        const f = { ...json, id: `fld${next++}` }; table().fields.push(f);
        if (f.bidirectional) cloud.tables.find(t => t.id === f.link_table).fields.push({ name: f.bidirectional_link_field_name, type: 'link', link_table: table().id, bidirectional: true, id: `fld${next++}` });
        return envelope({ field: f });
      }
      if (cmd === '+view-list') return envelope({ views: Object.values(cloud.views).filter(v => v.table === table().id), has_more: false });
      if (cmd === '+view-create') { for (const spec of json) { const v = { ...spec, id: `vew${next++}`, table: table().id }; cloud.views[v.id] = v; } return envelope({}); }
      for (const [suffix, key, input] of [['filter', 'filter', null], ['visible-fields', 'visible_fields', 'visible_fields'], ['sort', 'sort', 'sort_config'], ['group', 'group', 'group_config']]) {
        if (cmd === `+view-get-${suffix}`) return envelope({ [key]: view()[key] || (suffix === 'filter' ? { logic: 'and', conditions: [] } : []) });
        if (cmd === `+view-set-${suffix}`) { view()[key] = input ? json[input] : json; return envelope({}); }
      }
      if (cmd === '+dashboard-list') return envelope({ items: cloud.dashboard ? [cloud.dashboard] : [], has_more: false });
      if (cmd === '+dashboard-create') { cloud.dashboard = { dashboard_id: 'blkNew', name: arg('--name') }; return envelope({ dashboard: cloud.dashboard }); }
      if (cmd === '+dashboard-block-list') return envelope({ items: cloud.blocks, has_more: false });
      if (cmd === '+dashboard-block-create') { const b = { block_id: `cht${next++}`, name: arg('--name'), type: arg('--type'), data_config: JSON.parse(arg('--data-config')) }; cloud.blocks.push(b); return envelope({ block: b }); }
      if (cmd === '+dashboard-block-get') return envelope({ block: cloud.blocks.find(b => b.block_id === arg('--block-id')) });
      if (cmd === '+dashboard-arrange') return envelope({ arranged: true });
      if (cmd === '+advperm-enable') { cloud.advanced = true; return envelope({}); }
      if (cmd === '+role-list') return envelope({ base_roles: [{ role_id: 'reader' }], total: 1 });
      if (cmd === '+role-get') return envelope(cloud.baseRole || { role_name: 'Reader', role_type: 'reader', table_rule_map: {} });
      if (cmd === '+role-update') { cloud.baseRole = json; return envelope({}); }
      if (cmd === '+record-list') {
        const filter = JSON.parse(arg('--filter-json'));
        const entries = Object.entries(cloud.records).filter(([, row]) => row['成员标识'] === filter.conditions[0][2]);
        const values = entries.map(([, row]) => row);
        const names = values.length ? Object.keys(values[0]) : [];
        return envelope({ has_more: false, record_id_list: entries.map(([id]) => id), fields: names, data: values.map(v => names.map(n => v[n])) });
      }
      if (cmd === '+record-batch-create') { const id = `rec${next++}`; cloud.records[id] = Object.fromEntries(json.fields.map((name, i) => [name, json.rows[0][i]])); return envelope({ record_id_list: [id] }); }
    }
    if (domain === 'apps') {
      if (cmd === '+create') { cloud.app = { app_id: 'app_target', name: arg('--name'), app_type: 'full_stack' }; return envelope({ app: cloud.app }); }
      if (cmd === '+get') return envelope({ app: cloud.app });
      if (cmd === '+role-list') return envelope({ items: cloud.roles, has_more: false });
      if (cmd === '+role-create') { const role = { role_id: arg('--role-id'), name: arg('--name') }; cloud.roles.push(role); return envelope({ role }); }
      if (cmd === '+role-member-list') return envelope({ users: cloud.roleMembers[arg('--role-id')] || [], departments: [], chats: [] });
      if (cmd === '+role-member-add') { cloud.roleMembers[arg('--role-id')] = arg('--users').split(','); return envelope({}); }
      if (cmd === '+role-match-list') return envelope({ roles: cloud.roles.filter(role => cloud.roleMembers[role.role_id]?.includes(arg('--user-id'))) });
      if (cmd === '+access-scope-set') { cloud.scope = arg('--scope') === 'tenant' ? {scope:'Tenant',require_login:true} : { scope: 'Range', require_login: true, users: JSON.parse(arg('--targets')).map(t => t.id), apply_config: { enabled: false } }; return envelope({}); }
      if (cmd === '+access-scope-get') return envelope(cloud.scope);
      if (cmd === '+init') { writeJson(path.join(arg('--dir'), '.spark/meta.json'), { app_id: 'app_target' }); return envelope({ clone_path: arg('--dir') }); }
      if (cmd === '+db-execute') return envelope({ command: 'COMMIT' });
      if (cmd === '+env-list') return envelope({ items: [...(cloud.missingToken ? [] : [{ key: 'FEISHU_BASE_PERSONAL_TOKEN' }]), ...(cloud.publicUrl ? [{key:'CRM_PUBLIC_URL',value:cloud.publicUrl}] : [])] });
      if (cmd === '+env-set') { cloud.publicUrl=arg('--value'); return envelope({}); }
      if (cmd === '+automation-list') return envelope({ items: cloud.trigger ? [cloud.trigger] : [] });
      if (cmd === '+automation-create') { cloud.trigger = {name: 'crmDailyReminder', status:'disabled', trigger_type:'cron', trigger_condition:{cron:'*/30 * * * *',timezone:'Asia/Shanghai'}}; return envelope({trigger:cloud.trigger}); }
      if (cmd === '+automation-get') return envelope({trigger:cloud.trigger});
      if (cmd === '+automation-enable') {cloud.trigger.status='enabled';return envelope({});}
      if (cmd === '+plugin-install') return envelope({});
      if (cmd === '+release-create') { cloud.releaseCreates++; return envelope({ release_id: 'releaseNew' }); }
      if (cmd === '+release-get') return envelope({ release_id: 'releaseNew', status: cloud.status, commit_id: cloud.commit, online_url: 'https://target.feishu.link/app/app_target', ...(cloud.status === 'pending' ? { current_node_info: { current_status: 'PENDING' } } : {}) });
    }
    throw new Error(`Unexpected fake call ${domain} ${cmd}`);
  } };
  const execute = (exe, argv, options) => {
    if (exe === 'git' && argv[0] === 'rev-parse') return { status: 0, stdout: argv[1] === 'HEAD' ? cloud.commit : c.sourceCommit };
    if (exe === 'git' && argv[0] === 'ls-remote') return { status: 0, stdout: `${cloud.commit}\trefs/heads/sprint/default` };
    if (exe === 'tar' && argv[0] === '-xf') {
      const snapshot = argv[argv.indexOf('-C') + 1];
      fs.cpSync(path.join(root, 'server/database'), path.join(snapshot, 'server/database'), {recursive:true});
      const notice = path.join(snapshot, 'server/modules/crm/crm-notifications.service.ts');
      fs.mkdirSync(path.dirname(notice),{recursive:true});
      fs.writeFileSync(notice, "const APP_URL = process.env.CRM_PUBLIC_URL || 'https://source.example/app/source';");
      fs.mkdirSync(path.join(snapshot, 'shared'), { recursive: true });
      fs.writeFileSync(path.join(snapshot, 'shared/crm.ts'), "export const BASE_URL = 'https://source.feishu.cn/base/sourceBase';\n");
      for (const file of ['.env.local', '.npmrc']) fs.writeFileSync(path.join(snapshot, file), 'DO_NOT_COPY_SECRET');
      fs.mkdirSync(path.join(snapshot, 'scripts/tests'), { recursive: true });
      fs.writeFileSync(path.join(snapshot, 'scripts/tests/fixture.test.cjs'), '// test fixture');
      return { status: 0, stdout: '' };
    }
    return { status: 0, stdout: '' };
  };
  const create = (options = {}) => new Deployment({ root: dir, config: c, blueprint, cli, process: execute, npmPath: '/fake/npm.js', options: { publish: true, ...options }, log() {} });
  return { create, cloud, dir, c };
}

test('full simulated deployment creates isolated resources, rebinds source and publishes exact commit', async t => {
  const { create, cloud } = fixture(t);
  const deployment = create();
  const result = await deployment.run();
  assert.equal(result.status, 'finished');
  assert.equal(cloud.tables.length, 5);
  assert.equal(cloud.blocks.length, 14);
  assert.equal(cloud.releaseCreates, 2);
  assert.ok(fs.readFileSync(path.join(deployment.work, 'shared/crm.ts'), 'utf8').includes('target.feishu.cn/base/newBase'));
  assert.equal(fs.existsSync(path.join(deployment.work, '.env.local')), false);
  for (const kind of Object.keys(blueprint.schemas)) assert.equal(readJson(path.join(deployment.work, `server/capabilities/crm-${kind}.json`)).formValue.appToken, 'newBase');
});
test('second full run verifies live resources and does not create resources or publish twice', async t => {
  const { create, cloud } = fixture(t);
  await create().run();
  const createsBefore = cloud.calls.filter(a => /create|enable|add/.test(a[1])).length;
  await create().run();
  assert.equal(cloud.calls.filter(a => /create|enable|add/.test(a[1])).length, createsBefore);
  assert.equal(cloud.releaseCreates, 2);
});
test('approval wait resumes the same release without creating a new release', async t => {
  const { create, cloud } = fixture(t); cloud.status = 'pending';
  assert.equal((await create().run()).status, 'awaiting-approval');
  assert.equal(cloud.releaseCreates, 1);
  cloud.status = 'finished';
  assert.equal((await create().run()).status, 'finished');
  assert.equal(cloud.releaseCreates, 2);
});
test('identity mismatch performs no remote writes', async t => {
  const { create, cloud } = fixture(t);
  const deploy = create(); deploy.config = { ...deploy.config, expectedTenantKey: 'wrong' };
  await assert.rejects(() => deploy.run(), /tenant_key/);
  assert.ok(!cloud.calls.some(a => /create|update|set|add/.test(a[1])));
});
test('live scope drift cannot be hidden by completed checkpoints', async t => {
  const { create, cloud } = fixture(t);
  await create().run();
  cloud.scope.users.push('ou_unexpected');
  await assert.rejects(() => create().run(), /可见范围/);
});
test('recipient can deploy from a checked source archive without the original Git repository', async t => {
  const { create, cloud, dir, c } = fixture(t);
  const archive = Buffer.from('fixture archive');
  fs.mkdirSync(path.join(dir, 'deploy'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'deploy/source.tar'), archive);
  writeJson(path.join(dir, 'deploy/source-manifest.json'), { sourceCommit: c.sourceCommit, sha256: sha(archive) });
  const deployment = create();
  const original = deployment.execute;
  deployment.execute = (exe, args, options) => {
    if (exe === 'git' && (args[0] === 'archive' || (args[0] === 'rev-parse' && args[1] !== 'HEAD'))) throw new Error('source Git is unavailable to recipient');
    return original(exe, args, options);
  };
  assert.equal((await deployment.run()).status, 'finished');
  assert.equal(cloud.releaseCreates, 2);
});
test('tampered archive fails before any remote write', async t => {
  const { create, cloud, dir, c } = fixture(t);
  fs.mkdirSync(path.join(dir, 'deploy'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'deploy/source.tar'), 'changed archive');
  writeJson(path.join(dir, 'deploy/source-manifest.json'), { sourceCommit: c.sourceCommit, sha256: sha('original archive') });
  await assert.rejects(() => create().run(), /校验和/);
  assert.ok(!cloud.calls.some(a => /create|update|set|add/.test(a[1])));
});
test('completed view with remote filter drift stops instead of falsely passing checkpoint', async t => {
  const { create, cloud } = fixture(t);
  await create().run();
  Object.values(cloud.views).find(v => v.name === '今日跟进').filter = { logic: 'and', conditions: [] };
  const writesBefore = cloud.calls.filter(a => a[1] === '+view-set-filter').length;
  await assert.rejects(() => create().run(), /漂移/);
  assert.equal(cloud.calls.filter(a => a[1] === '+view-set-filter').length, writesBefore);
});
test('tenant deployment admits the enterprise without creating or assigning employee roles', async t => {
  const {create,cloud,c}=fixture(t);
  c.accessMode='tenant';
  assert.equal((await create().run()).status,'finished');
  assert.equal(cloud.scope.scope,'Tenant');
  assert.equal(cloud.scope.require_login,true);
  assert.deepEqual(cloud.roleMembers.crm_admin,['ou_target']);
  assert.equal(cloud.roles.some(r=>r.role_id==='crm_employee'),false);
  assert.ok(!cloud.calls.some(a=>a[1]==='+role-member-add'&&a.includes('crm_employee')));
  cloud.scope={scope:'All',require_login:true};
  await assert.rejects(()=>create().run(),/本企业/);
});

test('specified employees receive the employee role and access, never the administrator role', async t => {
  const { create, cloud, c } = fixture(t);
  c.accessMode = 'specified-members'; c.employeeOpenIds = ['ou_second'];
  assert.equal((await create().run()).status, 'finished');
  assert.deepEqual(cloud.roleMembers.crm_employee, ['ou_second']);
  assert.deepEqual(cloud.roleMembers.crm_admin, ['ou_target']);
  assert.deepEqual(cloud.scope.users.sort(), ['ou_second', 'ou_target']);
  const employee = Object.values(cloud.records).find(row => row['成员标识'] === 'ou_second');
  assert.deepEqual(employee['待配置角色'], ['员工']);
  assert.ok(!('授权范围说明' in employee));
  assert.ok(!('权限核验记录' in employee));
  assert.match(employee['备注'], /无删除入口/);
});

test('administrator role drift during build stops before release creation', async t => {
  const { create, cloud, c } = fixture(t);
  c.accessMode = 'specified-members'; c.employeeOpenIds = ['ou_second'];
  const deployment = create();
  const validate = deployment.validateAndPush.bind(deployment);
  deployment.validateAndPush = async () => { await validate(); cloud.roleMembers.crm_admin.push('ou_second'); };
  await assert.rejects(() => deployment.run(), /角色成员/);
  assert.equal(cloud.releaseCreates, 0);
});

test('employee role drift during release cannot be reported as a successful deployment', async t => {
  const { create, cloud, c } = fixture(t);
  c.accessMode = 'specified-members'; c.employeeOpenIds = ['ou_second'];
  const deployment = create();
  const call = deployment.cli.call;
  deployment.cli.call = args => {
    const response = call(args);
    if (args[1] === '+release-get') cloud.roleMembers.crm_employee.push('ou_unexpected');
    return response;
  };
  await assert.rejects(() => deployment.run(), /角色成员/);
  assert.equal(cloud.releaseCreates, 1);
});


test('missing attachment credential preserves progress and prevents push or release', async t => {
  const {create,cloud}=fixture(t); cloud.missingToken=true;
  await assert.rejects(()=>create().run(), /FEISHU_BASE_PERSONAL_TOKEN/);
  assert.equal(cloud.releaseCreates,0);
  assert.equal(cloud.trigger.status,'disabled');
  cloud.missingToken=false;
  assert.equal((await create().run()).status,'finished');
  assert.equal(cloud.tables.length,5);
});

test('deploys both database environments, notice plugin, target URLs and disables initial settings', async t => {
 const {create,cloud}=fixture(t); const deploy=create(); await deploy.run();
 for(const env of ['dev','online']) {
  assert.ok(cloud.calls.some(a=>a[1]==='+db-execute'&&a.includes(env)&&a.includes('--yes')));
  assert.ok(cloud.calls.some(a=>a[1]==='+env-set'&&a.includes(env)&&a.includes('CRM_PUBLIC_URL')&&a.includes('https://target.feishu.link/app/app_target')));
 }
 assert.ok(cloud.calls.some(a=>a[1]==='+plugin-install'&&a.includes('@official-plugins/send-feishu-message')));
 assert.equal(cloud.trigger.status,'enabled');
 assert.ok(!fs.readFileSync(path.join(deploy.work,'server/modules/crm/crm-notifications.service.ts'),'utf8').includes('source.example'));
 assert.equal(readJson(path.join(deploy.work,'server/capabilities/crm-daily-notice.json')).formValue.receiverUserList,'{{input.recipients}}');
});
