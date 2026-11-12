import fs from 'node:fs';
import { prepareRuntime, finishRuntime } from './runtime.mjs';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { Journal, capability, exactOne, idOf, readJson, releaseState, sha, unwrap, verifyIdentity, within, writeJson } from './core.mjs';
import { dashboardMatches, equal } from './support/reconcile.mjs';
import { upsertMember, directoryPatch, newMember, memberLookup } from './support/access-config.mjs';
import { normalizedCell } from './support/record-verification.mjs';

export class Deployment {
  constructor({ root, config, blueprint, cli, process: execute, npmPath, options = {}, log = console.log }) {
    Object.assign(this, { root, config, blueprint, cli, execute, npmPath, options, log });
    const { warnings, ...stableConfig } = config;
    this.fingerprint = sha({ toolVersion: 2, config: stableConfig, blueprint });
    this.stateDir = path.join(root, 'deploy/.state', config.deploymentKey);
    this.managedName = `${config.appName} [${config.deploymentKey}]`;
  }
  plan() {
    return { mode: 'preview', deploymentKey: this.config.deploymentKey, profile: this.config.profile, sourceCommit: this.config.sourceCommit, fingerprint: this.fingerprint, managedName: this.managedName, access: this.config.accessMode === 'tenant' ? '本企业已登录成员均可使用；无需逐个分配员工角色；权限配置仅管理员' : this.config.accessMode === 'specified-members' ? `部署管理员及${this.config.employeeOpenIds.length}名指定员工；业务共享；目录同步不授予权限` : '仅部署管理员；不导入业务记录；目录同步不授予权限', counts: { tables: Object.keys(this.blueprint.schemas).length, formulas: this.blueprint.formulas.length, views: this.blueprint.views.length, dashboardBlocks: this.blueprint.dashboard.length }, publishRequested: !!this.options.publish, releaseReason: this.config.releaseReason, stateDirectory: this.stateDir, warnings: this.config.warnings, steps: ['核对真实用户与 tenant_key', '创建空白 Base 与五张表', '创建关联、公式和视图', '创建协作概览并整理布局', '保护权限配置表并登记人员', '创建并限制妙搭应用访问', '初始化独立工程并重绑数据源', '初始化开发和线上数据库、通知设置及定时触发器', '核对目标附件授权配置', '检查、测试、构建、提交及推送', this.options.publish ? '发布并查询本轮结果' : '准备完毕；未要求发布'] };
  }
  call(args, cwd) { return this.cli.call(args, cwd); }
  base(command, args = [], body) { return this.call(['base', command, ...args, ...(body === undefined ? [] : ['--json', JSON.stringify(body)])]); }
  change(key, args, pick = envelope => unwrap(envelope), cwd) {
    return this.journal.effect(key, args, approved => pick(this.call([...args, ...(approved ? ['--yes'] : [])], cwd)));
  }
  bchange(key, command, args = [], body, pick) { return this.change(key, ['base', command, ...args, ...(body === undefined ? [] : ['--json', JSON.stringify(body)])], pick); }
  local(args, { cwd, input, binary = false, timeout, env } = {}) {
    const result = this.execute(args[0], args.slice(1), { cwd, input, binary, timeout, env });
    if (result.status !== 0) throw new Error(`本地检查失败：${path.basename(args[0])} ${args[1] || ''}（${result.status}）；未保存可能含凭据的原始输出`);
    return result.stdout;
  }
  gitRemote(args) {
    let result = this.execute('git', args, { cwd: this.work });
    if (result.status !== 0 && /authentication failed|could not read username|401|403|credential/i.test(String(result.stderr))) {
      // Credential response is kept in memory only, never journaled or printed.
      this.call(['apps', '+git-credential-init', '--app-id', this.state.resources.appId]);
      result = this.execute('git', args, { cwd: this.work });
    }
    if (result.status !== 0) throw new Error('Git 远端操作失败；保留工程与进度。不会 force-push 或覆盖远端分支');
    return result.stdout;
  }
  async identity() {
    const before = this.call(['whoami']);
    if (before.appId !== this.config.expectedCliAppId || before.onBehalfOf?.openId !== this.config.expectedUserOpenId || before.identity !== 'user' || before.available !== true) throw new Error('账号与配置不匹配或未登录；拒绝进行业务调用');
    // No auth endpoint shortcut exists. This public read also lets CLI refresh the token.
    const user = unwrap(this.call(['api', 'GET', '/open-apis/authen/v1/user_info']));
    const identity = verifyIdentity(this.config, this.call(['whoami']), user);
    this.identityVerified = identity;
    return identity;
  }
  async run() {
    await this.identity();
    this.local(['git', '--version']);
    this.local(['tar', '--version']);
    const source = this.root;
    const packageManifest = path.join(this.root, 'deploy/source-manifest.json');
    if (fs.existsSync(packageManifest)) {
      const manifest = readJson(packageManifest);
      const archive = path.join(this.root, 'deploy/source.tar');
      if (manifest.sourceCommit !== this.config.sourceCommit || sha(fs.readFileSync(archive)) !== manifest.sha256) throw new Error('部署包源码版本或校验和不匹配');
      this.sourceArchive = archive;
    } else {
      const commit = this.local(['git', 'rev-parse', `${this.config.sourceCommit}^{commit}`], { cwd: source }).trim();
      if (commit !== this.config.sourceCommit) throw new Error('找不到配置中固定的源码提交；其它机器请使用 build-package.mjs 生成的部署包');
    }
    this.journal = new Journal(this.stateDir, this.fingerprint, this.options);
    const unlock = this.journal.lock();
    this.state = this.journal.state;
    try {
      this.state.identity = this.identityVerified;
      this.journal.save();
      await this.dataLayer();
      await this.viewsAndDashboard();
      await this.permissionsAndMembers();
      await this.application();
      await this.prepareCode(source);
      await prepareRuntime(this);
      await this.validateAndPush();
      let result = this.options.publish ? await this.publish() : { status: 'prepared', message: '工程已检查并推送；尚未发布' };
      if (result.status === 'finished') result = await finishRuntime(this, result);
      this.report(result);
      return result;
    } catch (error) {
      this.report({ status: 'blocked', message: error.message });
      throw error;
    } finally { unlock(); }
  }
  async dataLayer() {
    this.log('1/7 创建或核对空白业务结构');
    const r = this.state.resources;
    if (this.options.adoptBaseToken) {
      if (r.baseToken || !['uncertain', 'in-flight'].includes(this.state.actions['base-create']?.status)) throw new Error('-AdoptBaseToken 仅用于创建响应丢失后的人工恢复');
      const base = unwrap(this.base('+base-get', ['--base-token', this.options.adoptBaseToken])).base;
      if (!base || base.name !== this.managedName) throw new Error('待接管 Base 名称不符合本次部署');
      r.baseToken = this.options.adoptBaseToken;
      r.baseUrl = base.url;
      this.journal.done('base-create', { baseToken: r.baseToken, baseUrl: r.baseUrl });
    }
    if (!r.baseToken) {
      const first = this.blueprint.schemas.customer;
      const created = this.bchange('base-create', '+base-create', ['--name', this.managedName, '--time-zone', this.config.timeZone, '--table-name', first.name, '--fields', JSON.stringify(first.fields)], undefined, e => {
        const d = unwrap(e);
        if (!d.base?.base_token || !d.base.url || !idOf(d.table)) throw new Error('建库响应缺少资源 ID，需人工核对创建结果');
        return { baseToken: d.base.base_token, baseUrl: d.base.url };
      });
      Object.assign(r, created);
      this.journal.save();
    }
    this.baseArgs = ['--base-token', r.baseToken];
    const base = unwrap(this.base('+base-get', this.baseArgs)).base;
    if (!base || base.name !== this.managedName) throw new Error('登记的 Base 已改名或不属于本部署');
    const parsedUrl = new URL(r.baseUrl || base.url);
    if (parsedUrl.protocol !== 'https:' || !parsedUrl.pathname.includes(`/base/${r.baseToken}`)) throw new Error('Base 返回的地址与登记资源不一致');
    r.baseUrl = parsedUrl.href;
    r.tables ||= {};
    let tables = this.listTables();
    for (const [kind, schema] of Object.entries(this.blueprint.schemas)) {
      let live = exactOne(tables, schema.name);
      if (!live && r.tables[kind]) throw new Error(`已登记表丢失：${schema.name}`);
      if (!live) {
        this.bchange(`table-create:${kind}`, '+table-create', [...this.baseArgs, '--name', schema.name, '--fields', JSON.stringify(schema.fields)]);
        tables = this.listTables();
        live = exactOne(tables, schema.name);
      }
      const id = idOf(live);
      if (!id || (r.tables[kind] && r.tables[kind].id !== id)) throw new Error(`表 ID 不一致：${kind}`);
      r.tables[kind] = { id, name: schema.name };
      this.journal.save();
      let fields = this.fields(kind);
      for (const field of schema.fields) {
        let actual = exactOne(fields, field.name);
        if (!actual) {
          this.bchange(`field:${kind}:${field.name}`, '+field-create', this.tableArgs(kind), field);
          fields = this.fields(kind);
          actual = exactOne(fields, field.name);
        }
        if (!actual || actual.type !== field.type) throw new Error(`原始字段缺失或类型变化：${schema.name}.${field.name}，不会自动覆盖已有字段`);
        if (field.options && !equal(actual.options?.map(o => o.name), field.options.map(o => o.name))) throw new Error(`字段选项变化：${schema.name}.${field.name}`);
      }
    }
    for (const [kind, name, target, reverse] of this.blueprint.links) {
      const actual = exactOne(this.fields(kind), name);
      if (actual) {
        if (actual.type !== 'link' || actual.link_table !== r.tables[target].id || !!actual.bidirectional !== !!reverse) throw new Error(`关联目标不一致：${kind}.${name}`);
      } else this.bchange(`link:${kind}:${name}`, '+field-create', this.tableArgs(kind), { type: 'link', name, link_table: r.tables[target].id, bidirectional: !!reverse, ...(reverse ? { bidirectional_link_field_name: reverse } : {}) });
    }
    // Inspect every cross-table schema before creating dependent formulas.
    for (const kind of Object.keys(r.tables)) this.fields(kind);
    for (const { table, ...field } of this.blueprint.formulas) {
      const actual = exactOne(this.fields(table), field.name);
      if (actual) {
        if (actual.type !== 'formula' || actual.expression !== field.expression) throw new Error(`公式变化：${table}.${field.name}，需独立迁移`);
      } else this.bchange(`formula:${table}:${field.name}`, '+field-create', [...this.tableArgs(table), '--i-have-read-guide'], field);
    }
    const verifiedFields = Object.fromEntries(Object.keys(r.tables).map(kind => [kind, this.fields(kind)]));
    for (const field of this.blueprint.formulas) {
      const actual = exactOne(verifiedFields[field.table], field.name);
      if (!actual || actual.type !== 'formula' || actual.expression !== field.expression) throw new Error(`公式最终回读不一致：${field.table}.${field.name}`);
    }
  }
  tableArgs(kind) { return [...this.baseArgs, '--table-id', this.state.resources.tables[kind].id]; }
  fields(kind) {
    const fields = unwrap(this.base('+table-get', this.tableArgs(kind))).fields;
    if (!Array.isArray(fields)) throw new Error(`目标表结构格式异常：${kind}`);
    return fields;
  }
  listTables() {
    const d = unwrap(this.base('+table-list', this.baseArgs));
    if (d.has_more) throw new Error('数据表列表被截断；停止以避免重复创建');
    return d.tables || d.items;
  }
  async viewsAndDashboard() {
    this.log('2/7 配置工作视图和协作概览');
    const adapted = JSON.parse(JSON.stringify(this.blueprint.views).replaceAll('$DEPLOYER_OPEN_ID', this.config.expectedUserOpenId));
    for (const [kind] of Object.entries(this.blueprint.schemas)) {
      const args = this.tableArgs(kind);
      const fields = this.fields(kind);
      const list = () => {
        const d = unwrap(this.base('+view-list', args));
        if (d.has_more) throw new Error('视图列表被截断');
        return d.views || d.items;
      };
      let views = list();
      for (const plan of adapted.filter(v => v.table === kind)) {
        let view = exactOne(views, plan.name);
        if (!view) {
          this.bchange(`view-create:${kind}:${plan.name}`, '+view-create', args, [{ name: plan.name, type: plan.type || 'grid' }]);
          views = list();
          view = exactOne(views, plan.name);
        }
        if (!view || view.type !== (plan.type || 'grid')) throw new Error(`视图类型不匹配：${plan.name}`);
        const viewArgs = [...args, '--view-id', idOf(view)];
        await this.configureView(kind, plan, fields, viewArgs);
      }
    }
    const r = this.state.resources;
    const dashboards = unwrap(this.base('+dashboard-list', this.baseArgs));
    if (dashboards.has_more) throw new Error('仪表盘列表被截断');
    let dashboard = exactOne(dashboards.items || dashboards.dashboards, '协作概览');
    if (!dashboard) dashboard = this.bchange('dashboard-create', '+dashboard-create', [...this.baseArgs, '--name', '协作概览'], undefined, e => unwrap(e).dashboard || unwrap(e));
    if (!idOf(dashboard) || (r.dashboardId && r.dashboardId !== idOf(dashboard))) throw new Error('仪表盘 ID 不一致');
    r.dashboardId = idOf(dashboard);
    this.journal.save();
    const args = [...this.baseArgs, '--dashboard-id', r.dashboardId];
    const listing = unwrap(this.base('+dashboard-block-list', [...args, '--page-size', '100']));
    if (listing.has_more) throw new Error('组件列表被截断');
    const blocks = listing.blocks || listing.items;
    for (const block of this.blueprint.dashboard) {
      let live = exactOne(blocks, block.name);
      if (!live) live = this.bchange(`block-create:${block.key}`, '+dashboard-block-create', [...args, '--name', block.name, '--type', block.type, '--data-config', JSON.stringify(block.config)], undefined, e => unwrap(e).block || unwrap(e));
      const detail = unwrap(this.base('+dashboard-block-get', [...args, '--block-id', idOf(live)]));
      const actual = detail.block || detail;
      if (actual.type !== block.type || !dashboardMatches(actual.data_config, block.config)) throw new Error(`图表配置回读不匹配：${block.name}`);
    }
    this.bchange('dashboard-arrange', '+dashboard-arrange', args);
  }
  async configureView(kind, plan, fields, args) {
    const byName = Object.fromEntries(fields.map(f => [f.name, f.id]));
    const byId = Object.fromEntries(fields.map(f => [f.id, f.name]));
    const fieldId = name => { if (!byName[name]) throw new Error(`视图字段不存在：${name}`); return byName[name]; };
    const sorts = plan.sorts || (plan.sort ? [{ field: plan.sort, desc: !!plan.desc }] : []);
    const definitions = {
      filter: { key: 'filter', desired: { logic: 'and', conditions: plan.conditions }, body: { logic: 'and', conditions: plan.conditions.map(([name, ...rest]) => [fieldId(name), ...rest]) } },
      'visible-fields': { key: 'visible_fields', desired: plan.columns || this.blueprint.columns[kind], body: { visible_fields: (plan.columns || this.blueprint.columns[kind]).map(fieldId) } },
      sort: { key: 'sort', desired: sorts, body: { sort_config: sorts.map(s => ({ ...s, field: fieldId(s.field) })) } },
      group: { key: 'group', desired: plan.group ? [{ field: plan.group, desc: false }] : [], body: { group_config: plan.group ? [{ field: fieldId(plan.group), desc: false }] : [] } },
    };
    const normalize = (key, value) => {
      if (key === 'filter') return { logic: value?.logic || 'and', conditions: (value?.conditions || []).map(([f, operator, ...rest]) => [byId[f] || f, operator, ...(['empty', 'non_empty'].includes(operator) ? [] : rest.map(v => Array.isArray(v) ? v.map(u => u && typeof u === 'object' && 'id' in u ? { id: u.id } : u) : v))]) };
      if (key === 'visible-fields') return (value || []).map(f => byId[f] || f);
      return (value || []).map(v => ({ field: byId[v.field] || v.field, desc: !!v.desc }));
    };
    for (const [suffix, spec] of Object.entries(definitions)) {
      const get = () => normalize(suffix, unwrap(this.base(`+view-get-${suffix}`, args))[spec.key]);
      if (!equal(get(), spec.desired)) {
        const key = `view-set:${kind}:${plan.name}:${suffix}`;
        if (this.state.actions[key]?.status === 'done') throw new Error(`视图配置发生漂移：${plan.name}/${suffix}，请先核对远端变更`);
        this.bchange(key, `+view-set-${suffix}`, args, spec.body);
      }
      const start = Date.now();
      while (!equal(get(), spec.desired)) { if (Date.now() - start > 15000) throw new Error(`视图回读不一致：${plan.name}/${suffix}`); await delay(1000); }
    }
  }
  async permissionsAndMembers() {
    this.log('3/7 保护权限配置表并登记目标企业人员');
    let base = unwrap(this.base('+base-get', this.baseArgs)).base;
    if (base.is_advanced === false) this.bchange('advperm-enable', '+advperm-enable', this.baseArgs);
    base = unwrap(this.base('+base-get', this.baseArgs)).base;
    if (base.is_advanced !== true) throw new Error('高级权限状态未确认，拒绝登记人员');
    const roles = unwrap(this.base('+role-list', this.baseArgs));
    if (!Array.isArray(roles.base_roles) || !roles.base_roles.length || roles.has_more || (roles.total != null && roles.total !== roles.base_roles.length)) throw new Error('Base 角色列表不完整');
    for (let role of roles.base_roles) {
      if (typeof role === 'string') role = JSON.parse(role);
      const args = [...this.baseArgs, '--role-id', role.role_id];
      const before = unwrap(this.base('+role-get', args));
      if (!['reader', 'editor', 'custom_role'].includes(before.role_type)) throw new Error('未知 Base 角色类型');
      const desired = Object.fromEntries(Object.values(this.blueprint.schemas).map(s => [s.name, { perm: 'no_perm' }]));
      const restricted = role => Object.keys(desired).every(name => role.table_rule_map?.[name]?.perm === 'no_perm') && role.base_rule_map?.copy === false && role.base_rule_map?.download === false && role.dashboard_rule_map?.['协作概览']?.perm === 'no_perm';
      if (!restricted(before)) this.bchange(`base-role:${role.role_id}`, '+role-update', args, { role_name: before.role_name, role_type: before.role_type, base_rule_map: { copy: false, download: false }, table_rule_map: desired, dashboard_rule_map: { 协作概览: { perm: 'no_perm' } } });
      const after = unwrap(this.base('+role-get', args));
      if (!restricted(after)) throw new Error('Base 权限回读不一致');
    }
    const response = unwrap(this.call(['contact', '+search-user', '--user-ids', this.config.expectedUserOpenId, '--exclude-external-users']));
    const users = new Map();
    const add = data => {
      if (data.has_more) throw new Error('人员搜索被截断，请缩小 memberQueries 后重新部署');
      if (!Array.isArray(data.users)) throw new Error('人员目录响应不完整');
      for (const user of data.users) { directoryPatch(user, '2026-01-01 00:00:00'); users.set(user.open_id, user); }
    };
    add(response);
    for (const openId of this.config.employeeOpenIds || []) {
      const found = unwrap(this.call(['contact', '+search-user', '--user-ids', openId, '--exclude-external-users']));
      add(found);
      if (!users.has(openId)) throw new Error('指定员工未通过本企业目录核验');
    }
    if (!users.has(this.config.expectedUserOpenId)) throw new Error('部署管理员未通过目标企业目录核验');
    for (const query of this.config.memberQueries) add(unwrap(this.call(['contact', '+search-user', '--query', query, '--exclude-external-users', '--page-size', '30'])));
    const args = this.tableArgs('access');
    const fields = this.fields('access');
    const stamp = this.state.directoryStamp ||= new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 19).replace('T', ' ');
    this.journal.save();
    // The shared upsert searches by Open ID and verifies each changed cell. No role is granted by these rows.
    for (const user of users.values()) {
      const values = newMember(user, stamp);
      if (user.open_id === this.config.expectedUserOpenId) Object.assign(values, { 待配置角色: '管理员', 备注: '部署账号为本 Base 创建者；妙搭管理员身份独立核验。' });
      else if ((this.config.employeeOpenIds || []).includes(user.open_id)) Object.assign(values, { 待配置角色: '员工', 备注: '部署配置已指定员工；业务无删除入口，权限配置仅管理员。' });
      const invoke = (command, a, body) => ['+record-batch-create', '+record-batch-update', '+record-upsert'].includes(command)
        ? this.bchange(`member:${user.open_id}`, command, a, body)
        : this.base(command, a, body);
      const previous = this.state.actions[`member:${user.open_id}`];
      const actual = memberLookup((command, a, body) => this.base(command, a, body), args, user.open_id);
      if (previous?.status === 'done') {
        if (!actual) throw new Error('已登记目录成员被删除，停止以免自动重新授权');
      } else if (actual && previous && ['uncertain', 'in-flight'].includes(previous.status) && Object.entries(values).every(([name, value]) => equal(normalizedCell(fields.find(f => f.name === name), actual.fields[name]), normalizedCell(fields.find(f => f.name === name), value)))) {
        this.journal.done(`member:${user.open_id}`, { recordId: actual.id, recoveredByReadback: true });
      } else await upsertMember(invoke, args, fields, user.open_id, values);
    }
    this.state.checks.directory = { importedVisibleMembers: users.size, completeEnterpriseRoster: false, configuredEmployeeCount: (this.config.employeeOpenIds || []).length, directorySyncGrantsPermissions: false };
    this.journal.save();
  }
  async application() {
    this.log('4/7 创建妙搭应用并配置管理员与指定员工权限');
    const r = this.state.resources;
    if (this.options.adoptAppId) {
      if (r.appId || !['uncertain', 'in-flight'].includes(this.state.actions['app-create']?.status)) throw new Error('-AdoptAppId 仅用于创建响应丢失后的恢复');
      const app = unwrap(this.call(['apps', '+get', '--app-id', this.options.adoptAppId])).app;
      if (!app || app.name !== this.managedName || app.app_type !== 'full_stack') throw new Error('待接管应用与本部署不一致');
      r.appId = this.options.adoptAppId;
      this.journal.done('app-create', { appId: r.appId });
    }
    if (!r.appId) Object.assign(r, this.change('app-create', ['apps', '+create', '--name', this.managedName, '--app-type', 'full_stack', '--description', `独立CRM；deploymentKey=${this.config.deploymentKey}`], e => {
      const app = unwrap(e).app;
      if (!/^app_[A-Za-z0-9]+$/.test(app?.app_id || '')) throw new Error('创建应用未返回 app_id');
      return { appId: app.app_id };
    }));
    this.journal.save();
    const args = ['--app-id', r.appId];
    const app = unwrap(this.call(['apps', '+get', ...args])).app;
    if (!app || app.name !== this.managedName) throw new Error('登记应用已改名或不属于本部署');
    const role = unwrap(this.call(['apps', '+role-list', ...args, '--name', 'CRM管理员', '--page-size', '100']));
    if (role.has_more) throw new Error('应用角色列表被截断');
    let admin = exactOne(role.items, 'CRM管理员');
    if (!admin) admin = this.change('app-admin-role', ['apps', '+role-create', ...args, '--name', 'CRM管理员', '--role-id', 'crm_admin', '--description', '独立CRM管理员，具备业务管理权限'], e => unwrap(e).role);
    if (admin?.role_id !== 'crm_admin') throw new Error('CRM管理员角色的真实 ID 与代码不一致');
    const members = unwrap(this.call(['apps', '+role-member-list', ...args, '--role-id', admin.role_id]));
    const memberIds = members.users?.map(u => typeof u === 'string' ? u : u.open_id || u.id);
    if (!Array.isArray(memberIds)) throw new Error('角色成员响应格式异常');
    if (members.departments?.length || members.chats?.length || memberIds.some(id => id !== this.config.expectedUserOpenId)) throw new Error('管理员角色含部署账号以外成员，停止发布');
    if (!memberIds.includes(this.config.expectedUserOpenId)) this.change('app-admin-member', ['apps', '+role-member-add', ...args, '--role-id', admin.role_id, '--users', this.config.expectedUserOpenId]);
    const match = unwrap(this.call(['apps', '+role-match-list', ...args, '--user-id', this.config.expectedUserOpenId]));
    if (!match.roles?.some(role => role.role_id === 'crm_admin')) throw new Error('管理员真实角色尚未生效');
    if (this.config.accessMode === 'tenant') {
      this.change('app-access', ['apps', '+access-scope-set', ...args, '--scope', 'tenant']);
      this.verifyRoles();
      this.verifyScope();
      return;
    }
    const employeeRoles = unwrap(this.call(['apps', '+role-list', ...args, '--name', '员工', '--page-size', '100']));
    if (employeeRoles.has_more) throw new Error('员工角色列表被截断');
    let employee = exactOne(employeeRoles.items, '员工');
    if (!employee) employee = this.change('app-employee-role', ['apps', '+role-create', ...args, '--name', '员工', '--role-id', 'crm_employee', '--description', '可使用业务和跟进操作，不能删除和管理权限'], e => unwrap(e).role);
    if (employee?.role_id !== 'crm_employee') throw new Error('员工角色 ID 与代码不一致');
    const employees = this.config.employeeOpenIds || [];
    const current = unwrap(this.call(['apps', '+role-member-list', ...args, '--role-id', employee.role_id]));
    if (!Array.isArray(current.users) || current.departments?.length || current.chats?.length || current.users.some(id => !employees.includes(typeof id === 'string' ? id : id.open_id || id.id))) throw new Error('员工角色存在未登记的成员范围');
    const assigned = current.users.map(id => typeof id === 'string' ? id : id.open_id || id.id);
    const missing = employees.filter(id => !assigned.includes(id));
    if (missing.length) this.change('app-employee-members', ['apps', '+role-member-add', ...args, '--role-id', employee.role_id, '--users', missing.join(',')]);
    for (const openId of employees) {
      const roles = unwrap(this.call(['apps', '+role-match-list', ...args, '--user-id', openId]));
      if (!roles.roles?.some(role => role.role_id === 'crm_employee') || roles.roles.some(role => role.role_id === 'crm_admin')) throw new Error('员工实际权限未按预期生效');
    }
    this.change('app-access', ['apps', '+access-scope-set', ...args, '--scope', 'specific', '--targets', JSON.stringify([this.config.expectedUserOpenId, ...employees].map(id => ({ type: 'user', id })))]);
    this.verifyRoles();
    this.verifyScope();
  }
  verifyRoles() {
    const args = ['--app-id', this.state.resources.appId];
    const roleMembers = [['crm_admin', [this.config.expectedUserOpenId]],
      ...(this.config.accessMode === 'tenant' ? [] : [['crm_employee', this.config.employeeOpenIds || []]])];
    for (const [roleId, expected] of roleMembers) {
      const members = unwrap(this.call(['apps', '+role-member-list', ...args, '--role-id', roleId]));
      const actual = members.users?.map(user => typeof user === 'string' ? user : user.open_id || user.id);
      if (members.has_more || !Array.isArray(actual) || members.departments?.length || members.chats?.length || !equal([...actual].sort(), [...expected].sort())) throw new Error(`平台角色成员与配置不一致：${roleId}`);
    }
    for (const openId of [this.config.expectedUserOpenId, ...(this.config.accessMode === 'tenant' ? [] : this.config.employeeOpenIds || [])]) {
      const expected = openId === this.config.expectedUserOpenId ? 'crm_admin' : 'crm_employee';
      const match = unwrap(this.call(['apps', '+role-match-list', ...args, '--user-id', openId]));
      if (!Array.isArray(match.roles) || !match.roles.some(role => role.role_id === expected) || (expected === 'crm_employee' && match.roles.some(role => role.role_id === 'crm_admin'))) throw new Error('平台实际角色与员工权限规则不一致');
    }
    this.state.checks.roles = { administrator: 'crm_admin', employee: this.config.accessMode === 'tenant' ? 'enterprise-default' : 'crm_employee', employeeCount: (this.config.employeeOpenIds || []).length, accessConfiguration: 'admin-only', deleteEndpoint: 'crm_admin-only' };
    this.journal.save();
  }
  verifyScope() {
    const scope = unwrap(this.call(['apps', '+access-scope-get', '--app-id', this.state.resources.appId]));
    if (this.config.accessMode === 'tenant') {
      if (scope.require_login !== true || !['Tenant', 'tenant'].includes(scope.scope)) throw new Error('妙搭运行时可见范围必须为本企业且要求登录');
      this.state.checks.accessScope = 'verified-tenant';
      this.journal.save();
      return;
    }
    const expected = [this.config.expectedUserOpenId, ...(this.config.employeeOpenIds || [])].sort();
    if (scope.require_login !== true || !['Range', 'specific'].includes(scope.scope) || !Array.isArray(scope.users) || !equal([...scope.users].sort(), expected) || scope.departments?.length || scope.chats?.length || scope.apply_config?.enabled === true) throw new Error('妙搭运行时可见范围与指定管理员和员工不一致');
    this.state.checks.accessScope = expected.length === 1 ? 'verified-admin-only' : 'verified-specified-members';
    this.journal.save();
  }
  async prepareCode(source) {
    this.log('5/7 初始化独立工程并生成目标数据源配置');
    const work = within(this.journal.dir, path.join(this.journal.dir, 'app'));
    this.work = work;
    const metadata = path.join(work, '.spark/meta.json');
    if (fs.existsSync(metadata) && readJson(metadata).app_id !== this.state.resources.appId) throw new Error('独立工程绑定了其它应用');
    if (!fs.existsSync(metadata)) {
      // +init owns scaffolding, env-pull and initial commit; never reuse the source repository.
      this.change('app-init', ['apps', '+init', '--app-id', this.state.resources.appId, '--dir', work], e => ({ initialized: !!unwrap(e).clone_path }));
    }
    if (!fs.existsSync(metadata) || readJson(metadata).app_id !== this.state.resources.appId) throw new Error('工程初始化未完成，保留目录供核对');
    const guide = path.join(work, '.agents/skills/plugin-guide/SKILL.md');
    if (fs.existsSync(guide)) fs.readFileSync(guide, 'utf8');
    if (this.state.checks.codePrepared) return;
    const archive = within(this.journal.dir, path.join(this.journal.dir, 'source.tar'));
    if (this.sourceArchive) fs.copyFileSync(this.sourceArchive, archive);
    else this.local(['git', 'archive', '--format=tar', `--output=${archive}`, this.config.sourceCommit], { cwd: source });
    const snapshot = within(this.journal.dir, path.join(this.journal.dir, 'source'));
    fs.mkdirSync(snapshot, { recursive: true });
    this.local(['tar', '-xf', archive, '-C', snapshot]);
    const excluded = new Set(['.git', '.spark', '.spark_project', '.env', '.env.local', '.npmrc', '.agents', '.githooks', 'node_modules', 'dist', 'README.md', 'deploy', 'deploy.ps1']);
    // Replace only the new target application's code trees; keep its startup credentials and metadata.
    for (const name of ['client', 'server', 'shared', 'scripts']) {
      const target = within(work, path.join(work, name));
      if (fs.existsSync(target)) {
        within(fs.realpathSync(work), fs.realpathSync(target));
        fs.rmSync(target, { recursive: true, force: true });
      }
    }
    for (const name of fs.readdirSync(snapshot)) {
      if (excluded.has(name) || name.startsWith('.env.')) continue;
      const from = path.join(snapshot, name);
      const to = within(work, path.join(work, name));
      fs.cpSync(from, to, { recursive: true, dereference: false, filter: file => { if (fs.lstatSync(file).isSymbolicLink()) throw new Error('源码含符号链接，拒绝迁入'); return true; } });
    }
    const shared = path.join(work, 'shared/crm.ts');
    const content = fs.readFileSync(shared, 'utf8');
    if (!/export const BASE_URL\s*=\s*'[^']+';/.test(content)) throw new Error('无法定位源码中的 BASE_URL');
    fs.writeFileSync(shared, content.replace(/export const BASE_URL\s*=\s*'[^']+';/, `export const BASE_URL = ${JSON.stringify(this.state.resources.baseUrl)};`));
    const noticeService = path.join(work, 'server/modules/crm/crm-notifications.service.ts');
    const noticeSource = fs.readFileSync(noticeService, 'utf8');
    const fallback = /process\.env\.CRM_PUBLIC_URL \|\| '[^']*'/;
    if (!fallback.test(noticeSource)) throw new Error('无法移除通知中的源应用地址');
    fs.writeFileSync(noticeService, noticeSource.replace(fallback, "process.env.CRM_PUBLIC_URL || ''"));
    // Only these non-secret switches are copied; startup identity remains target-owned.
    fs.writeFileSync(path.join(work, '.env'), 'LOG_REQUEST_BODY=false\nLOG_RESPONSE_BODY=false\n');
    for (const kind of Object.keys(this.blueprint.schemas)) writeJson(path.join(work, `server/capabilities/crm-${kind}.json`), capability(kind, this.state.resources.baseToken, this.state.resources.tables[kind].id, this.fields(kind)));
    this.change('plugin-install', ['apps', '+plugin-install', '--name', '@official-plugins/feishu-bitable', '--version', '1.0.22'], () => ({ installed: true }), work);
    writeJson(path.join(work, 'server/capabilities/crm-daily-notice.json'), readJson(path.join(this.root, 'deploy/templates/crm-daily-notice.json')));
    this.change('notice-plugin-install', ['apps', '+plugin-install', '--name', '@official-plugins/send-feishu-message', '--version', '1.0.33'], () => ({ installed: true }), work);
    this.state.checks.codePrepared = true;
    this.journal.save();
  }
  async validateAndPush() {
    this.log('6/7 检查、测试、构建与推送');
    for (const kind of Object.keys(this.blueprint.schemas)) {
      const cap = readJson(path.join(this.work, `server/capabilities/crm-${kind}.json`));
      if (cap.formValue.appToken !== this.state.resources.baseToken || cap.formValue.tableID !== this.state.resources.tables[kind].id) throw new Error('数据源仍指向非目标资源');
    }
    if (this.state.checks.pushedCommit) {
      const local = this.local(['git', 'rev-parse', 'HEAD'], { cwd: this.work }).trim();
      if (local !== this.state.checks.pushedCommit || this.local(['git', 'status', '--porcelain'], { cwd: this.work }).trim()) throw new Error('已推送工程的本地内容发生变化，请先核对');
      const remote = this.gitRemote(['ls-remote', 'origin', 'refs/heads/sprint/default']).trim().split(/\s/)[0];
      if (remote !== this.state.checks.pushedCommit) throw new Error('远端分支已变化，不能沿用旧发布提交');
      return;
    }
    const before = this.local(['git', 'status', '--porcelain'], { cwd: this.work });
    if (/\.env\.local|\.npmrc|\.spark\/meta\.json/.test(before)) throw new Error('身份或工程元数据出现修改，拒绝提交');
    const npm = (...args) => this.local([process.execPath, this.npmPath, ...args], { cwd: this.work, timeout: 900000 });
    npm('ci');
    npm('run', 'lint');
    this.local([process.execPath, 'node_modules/@nestjs/cli/bin/nest.js', 'build'], { cwd: this.work });
    const tests = fs.readdirSync(path.join(this.work, 'scripts/tests')).filter(name => name.endsWith('.test.cjs')).map(name => `scripts/tests/${name}`);
    if (!tests.length) throw new Error('部署源码缺少业务测试');
    this.local([process.execPath, '--test', ...tests], { cwd: this.work });
    this.local([process.execPath, 'node_modules/vite/bin/vite.js', 'build', '--config', 'vite.config.ts'], { cwd: this.work, env: { NODE_ENV: 'production' } });
    this.local(['git', 'add', '--', 'client', 'server', 'shared', 'scripts', 'package.json', 'package-lock.json', 'vite.config.ts', 'tsconfig.app.json', 'tsconfig.json', 'tsconfig.node.json', 'nest-cli.json', 'eslint.config.js', '.stylelintrc.js', 'postcss.config.js', 'tailwind.config.ts', 'components.json', '.gitignore', '.prettierrc', '.env'], { cwd: this.work });
    const staged = this.local(['git', 'diff', '--cached', '--name-only'], { cwd: this.work });
    if (staged.trim()) this.local(['git', 'commit', '-m', `Deploy isolated CRM ${this.config.deploymentKey}`], { cwd: this.work });
    const commit = this.local(['git', 'rev-parse', 'HEAD'], { cwd: this.work }).trim();
    this.state.checks.localCommit = commit;
    this.journal.save();
    this.gitRemote(['push', 'origin', 'HEAD:refs/heads/sprint/default']);
    const remote = this.gitRemote(['ls-remote', 'origin', 'refs/heads/sprint/default']).trim().split(/\s/)[0];
    if (remote !== commit) throw new Error('远端提交核对失败');
    this.state.checks.pushedCommit = commit;
    this.journal.save();
  }
  async publish(phase = 'release') {
    this.log('7/7 发布并查询同一轮发布结果');
    this.verifyRoles();
    this.verifyScope();
    const r = this.state.resources;
    const releaseKey = `${phase}Id`;
    if (!r[releaseKey]) {
      const release = this.change(`${phase}-create`, ['apps', '+release-create', '--app-id', r.appId, '--branch', 'sprint/default', '--apply-reason', this.config.releaseReason], e => {
        const d = unwrap(e); const release = d.release || d;
        if (!release.release_id) throw new Error('发布响应缺少 release_id，需人工核对后恢复');
        return { releaseId: release.release_id };
      });
      r[releaseKey] = release.releaseId; this.journal.save();
    }
    for (let poll = 0; poll < 16; poll++) {
      const d = unwrap(this.call(['apps', '+release-get', '--app-id', r.appId, '--release-id', r[releaseKey]]));
      const release = d.release || d;
      const status = releaseState(release, this.state.checks.pushedCommit);
      if (status === 'finished') { this.verifyRoles(); this.verifyScope(); return { status, releaseId: r[releaseKey], commit: release.commit_id, ...(release.online_url ? { onlineUrl: release.online_url } : {}) }; }
      if (status !== 'publishing') return { status, releaseId: r[releaseKey], platformStatus: release.status, message: status === 'awaiting-approval' ? '等待平台审批；处理后重新执行相同命令查询本轮发布' : status === 'failed' ? '本轮发布失败；保留资源与进度，先检查平台日志并制定重发方案，不自动创建新发布' : '平台返回未知状态，停止自动轮询' };
      if (poll < 15) await delay(20000);
    }
    return { status: 'publishing', releaseId: r[releaseKey], message: '等待超时，重新执行相同命令继续查询，不会创建新发布' };
  }
  report(result) {
    const report = { at: new Date().toISOString(), ...result, deploymentKey: this.config.deploymentKey, resources: this.state.resources, checks: this.state.checks, scope: this.config.accessMode === 'tenant' ? '本企业成员；权限配置仅限管理员' : this.config.accessMode === 'specified-members' ? '管理员及指定员工；员工共享业务数据，权限配置仅限管理员' : '仅部署管理员', pendingAcceptance: ['线上真实登录、人员选择和完整保存流程', '指定员工实际登录与业务操作、权限配置拒绝访问（若配置员工）'] };
    writeJson(path.join(this.journal.dir, 'report.json'), report);
  }
}
