import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';

export const sha = value => crypto.createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value)).digest('hex');
export const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
export function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
  fs.renameSync(tmp, file);
}
export function within(root, file) {
  const relative = path.relative(path.resolve(root), path.resolve(file));
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('路径必须位于独立部署目录内');
  return path.resolve(file);
}
export function validateConfig(config, applying = false) {
  const allowed = new Set(['deploymentKey', 'profile', 'expectedEnterpriseDisplayId', 'expectedTenantKey', 'expectedCliAppId', 'expectedUserOpenId', 'expectedUserName', 'appName', 'timeZone', 'accessMode', 'sourceCommit', 'releaseReason', 'memberQueries', 'employeeOpenIds']);
  for (const key of Object.keys(config)) if (!allowed.has(key)) throw new Error(`不支持的配置项：${key}；凭据不得写入配置`);
  for (const key of ['deploymentKey', 'profile', 'expectedEnterpriseDisplayId', 'expectedTenantKey', 'expectedCliAppId', 'expectedUserOpenId', 'appName', 'sourceCommit', 'releaseReason']) {
    if (typeof config[key] !== 'string' || !config[key].trim()) throw new Error(`缺少配置：${key}`);
    if (/[\r\n\x00]/.test(config[key])) throw new Error(`配置含非法字符：${key}`);
  }
  if (!/^[a-z][a-z0-9-]{1,47}$/.test(config.deploymentKey)) throw new Error('deploymentKey 仅支持小写字母、数字和短横线，长度 2–48');
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(config.profile)) throw new Error('profile 格式无效');
  if (!/^cli_[A-Za-z0-9_]+$/.test(config.expectedCliAppId) || !/^ou_[A-Za-z0-9_]+$/.test(config.expectedUserOpenId)) throw new Error('CLI App ID 或用户 Open ID 格式无效');
  if (!/^[a-f0-9]{40}$/.test(config.sourceCommit)) throw new Error('sourceCommit 必须是固定的完整 Git SHA');
  if (!['admin-only', 'specified-members', 'tenant'].includes(config.accessMode) || config.timeZone !== 'Asia/Shanghai') throw new Error('仅支持 admin-only、specified-members 或 tenant，以及 Asia/Shanghai');
  const employees = config.employeeOpenIds || [];
  if (!Array.isArray(employees) || employees.length > 99 || employees.some(id => typeof id !== 'string' || !/^ou_[A-Za-z0-9]+$/.test(id) || id === config.expectedUserOpenId) || new Set(employees).size !== employees.length) throw new Error('employeeOpenIds 须为不重复的员工 Open ID，不含管理员，最多99人');
  if (config.accessMode === 'admin-only' && employees.length) throw new Error('配置员工访问时 accessMode 应为 specified-members');
  if (config.accessMode === 'specified-members' && !employees.length) throw new Error('specified-members 需要 employeeOpenIds');
  if (config.appName.length > 80 || config.releaseReason.length > 1000) throw new Error('应用名称或发布理由过长');
  if (config.memberQueries !== undefined && (!Array.isArray(config.memberQueries) || config.memberQueries.some(q => typeof q !== 'string' || !q.trim() || q.length > 50))) throw new Error('memberQueries 必须是有效的姓名关键词数组');
  const placeholders = Object.entries(config).filter(([, v]) => typeof v === 'string' && /REPLACE|待填写|目标企业编号/.test(v)).map(([key]) => key);
  if (applying && placeholders.length) throw new Error(`先填写真实配置：${placeholders.join(', ')}`);
  return { ...config, memberQueries: config.memberQueries || [], warnings: placeholders.map(k => `待填写：${k}`) };
}

export function parseJsonOutput(stdout, stderr = '') {
  try { return JSON.parse(stdout.trim()); } catch { /* +init may put progress before its error envelope. */ }
  for (const source of [stderr, stdout]) {
    for (let i = source.lastIndexOf('\n{'); i >= 0; i = source.lastIndexOf('\n{', i - 1)) {
      try { return JSON.parse(source.slice(i + 1)); } catch { /* try preceding envelope */ }
    }
    try { return JSON.parse(source.trim()); } catch { /* no JSON */ }
  }
  throw new Error('CLI 未返回有效 JSON；原始输出未保存，以免泄漏凭据');
}
export function runProcess(executable, args, options = {}) {
  const result = spawnSync(executable, args, { cwd: options.cwd, input: options.input, encoding: options.binary ? undefined : 'utf8', windowsHide: true, shell: false, timeout: options.timeout || 180000, maxBuffer: 64 * 1024 * 1024, env: { ...process.env, LARKSUITE_CLI_NO_UPDATE_NOTIFIER: '1', LARKSUITE_CLI_NO_SKILLS_NOTIFIER: '1', ...options.env } });
  if (result.error) throw new Error(`进程启动或执行超时：${path.basename(executable)}；未记录原始输出`);
  return { status: result.status, stdout: result.stdout || '', stderr: result.stderr || '' };
}
export function findCli() {
  const candidates = [process.env.LARK_CLI_JS, path.join(path.dirname(process.execPath), 'node_modules/@larksuite/cli/scripts/run.js')];
  for (const dir of (process.env.PATH || '').split(path.delimiter)) candidates.push(path.join(dir, 'node_modules/@larksuite/cli/scripts/run.js'));
  const found = candidates.find(file => file && fs.existsSync(file));
  if (!found) throw new Error('找不到 lark-cli 的 scripts/run.js；请安装 CLI 或设置 LARK_CLI_JS');
  return found;
}
export function findNpm() {
  const candidates = [process.env.NPM_CLI_JS, path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js')];
  for (const dir of (process.env.PATH || '').split(path.delimiter)) candidates.push(path.join(dir, 'node_modules/npm/bin/npm-cli.js'));
  const found = candidates.find(file => file && fs.existsSync(file));
  if (!found) throw new Error('找不到 npm；请安装 Node.js 22+，或设置 NPM_CLI_JS');
  return found;
}
export class CliError extends Error {
  constructor(status, envelope) {
    const e = envelope?.error || {};
    super(`CLI ${e.action || ''} ${e.type || 'failed'}/${e.subtype || ''}（退出码 ${status}）；详见部署指南`);
    this.status = status;
    this.subtype = e.subtype;
    this.type = e.type;
    this.confirmation = status === 10 && e.subtype === 'confirmation_required';
    this.scopes = Array.isArray(e.missing_scopes) ? e.missing_scopes.filter(s => /^[\w:.-]+$/.test(s)) : [];
  }
}
export class Cli {
  constructor(profile, { execute = runProcess, cliPath = findCli(), cwd } = {}) { Object.assign(this, { profile, execute, cliPath, cwd }); }
  call(args, cwd = this.cwd) {
    const result = this.execute(process.execPath, [this.cliPath, ...args, '--as', 'user', '--profile', this.profile], { cwd, timeout: args.includes('+init') ? 900000 : 180000 });
    const envelope = parseJsonOutput(result.stdout, result.stderr);
    if (result.status !== 0 || envelope.ok === false) throw new CliError(result.status, envelope);
    if (args[0] !== 'whoami' && envelope.ok !== true) throw new Error('CLI 成功信封缺少 ok:true');
    return envelope;
  }
}
export function verifyIdentity(config, identity, user) {
  if (identity.identity !== 'user' || identity.available !== true || identity.appId !== config.expectedCliAppId || identity.onBehalfOf?.openId !== config.expectedUserOpenId) throw new Error('目标账号、CLI应用或身份不匹配；拒绝写入');
  if (user.open_id !== config.expectedUserOpenId || !user.tenant_key || user.tenant_key !== config.expectedTenantKey) throw new Error('目标企业 tenant_key 不匹配或缺失；拒绝写入');
  return { profile: config.profile, appId: identity.appId, openId: user.open_id, tenantKey: user.tenant_key, userName: user.name || identity.onBehalfOf.userName, enterpriseDisplayId: config.expectedEnterpriseDisplayId, enterpriseDisplayIdVerification: 'label-only; tenant_key verified through user_info' };
}
export function unwrap(value) {
  let body = value?.data ?? value;
  for (let n = 0; n < 4; n++) {
    if (typeof body === 'string') body = JSON.parse(body);
    else if (body && typeof body === 'object' && Object.keys(body).length === 1 && 'data' in body) body = body.data;
    else break;
  }
  return body;
}
export const idOf = value => value?.id || value?.table_id || value?.block_id || value?.dashboard_id;
export function exactOne(items, name, nameOf = item => item.name || item.table_name || item.block_name) {
  if (!Array.isArray(items)) throw new Error('资源列表格式异常');
  const found = items.filter(item => nameOf(item) === name);
  if (found.length > 1) throw new Error(`存在同名资源：${name}，请先消歧`);
  return found[0];
}

export class Journal {
  constructor(dir, fingerprint, options = {}) {
    fs.mkdirSync(dir, { recursive: true });
    this.dir = fs.realpathSync(dir);
    this.file = path.join(this.dir, 'state.json');
    this.options = options;
    this.state = fs.existsSync(this.file) ? readJson(this.file) : { version: 1, fingerprint, resources: {}, actions: {}, checks: {} };
    if (this.state.fingerprint !== fingerprint) throw new Error('部署配置、蓝图或源码版本已变；不能复用旧部署状态，请使用新的 deploymentKey');
  }
  lock() {
    const file = path.join(this.dir, 'run.lock');
    try { this.fd = fs.openSync(file, 'wx', 0o600); } catch { throw new Error('部署目录已锁定；确认无其它部署进程后，再人工移除 run.lock'); }
    fs.writeFileSync(this.fd, String(process.pid));
    return () => { fs.closeSync(this.fd); fs.unlinkSync(file); };
  }
  save() { writeJson(this.file, this.state); }
  done(key, result) { this.state.actions[key] = { ...this.state.actions[key], status: 'done', result }; this.save(); return result; }
  effect(key, argv, perform) {
    const digest = sha(argv);
    const previous = this.state.actions[key];
    if (previous && previous.digest !== digest) throw new Error(`操作参数变化：${key}`);
    if (previous?.status === 'done') return previous.result;
    if (['in-flight', 'uncertain'].includes(previous?.status) && this.options.retryAction !== digest) throw new Error(`上次操作结果不确定：${key}。核对云端后用 -RetryAction ${digest} 明确重试；不会盲目重复创建`);
    this.state.actions[key] = { digest, status: 'in-flight', command: argv.slice(0, 2), at: new Date().toISOString() };
    this.save();
    try { return this.done(key, perform(false)); }
    catch (error) {
      if (error.confirmation) {
        this.state.actions[key].status = 'awaiting-confirmation';
        this.save();
        writeJson(path.join(this.dir, 'pending-approval.json'), { key, actionHash: digest, risk: 'high-risk-write', argv, instruction: '先用相同参数加 --dry-run 核对，确认后重跑入口并加 -ApproveAction actionHash' });
        if (this.options.approveAction === digest || this.options.confirmAction?.({ key, digest, argv }) === true) {
          try { return this.done(key, perform(true)); }
          catch (approvedError) { this.state.actions[key].status = 'uncertain'; this.save(); throw approvedError; }
        }
        throw new Error(`需要确认高风险操作 ${key}；请求保存在 pending-approval.json。确认后加 -ApproveAction ${digest} 继续`);
      }
      this.state.actions[key].status = error instanceof CliError && ['validation', 'authorization', 'confirmation'].includes(error.type) ? 'failed' : 'uncertain';
      this.save();
      throw error;
    }
  }
}

const fieldTypes = { text: [1, 'Text'], number: [2, 'Number'], select: [3, 'SingleSelect'], datetime: [5, 'DateTime'], checkbox: [7, 'Checkbox'], user: [11, 'User'], link: [18, 'SingleLink'], formula: [20, 'Formula'], lookup: [19, 'Lookup'], attachment: [17, 'Attachment'], created_at: [1001, 'CreatedTime'], updated_at: [1002, 'ModifiedTime'], created_by: [1003, 'CreatedUser'], updated_by: [1004, 'ModifiedUser'], auto_number: [1005, 'AutoNumber'] };
export function capability(kind, baseToken, tableId, fields) {
  const accessWrite = ['待配置角色'];
  if (!Array.isArray(fields) || !fields.length) throw new Error('目标表结构为空');
  return { id: `crm-${kind}`, pluginKey: '@official-plugins/feishu-bitable', pluginVersion: '1.0.22', name: `CRM ${kind}`, description: '目标企业独立CRM数据源；仅受保护业务服务调用', paramsSchema: { type: 'object', properties: {} }, formValue: { appToken: baseToken, tableID: tableId, fields: fields.map(field => {
    const type = fieldTypes[field.type];
    if (!type || !field.id || !field.name) throw new Error(`无法映射字段：${field.name || 'unknown'}/${field.type}`);
    return { id: field.id, name: field.name, type: field.bidirectional ? 21 : field.type === 'select' && field.multiple ? 4 : type[0], bizType: field.bidirectional ? 'DuplexLink' : field.type === 'select' && field.multiple ? 'MultiSelect' : type[1], readable: true, writeable: kind === 'access' ? accessWrite.includes(field.name) : (['text', 'number', 'select', 'datetime', 'checkbox', 'user', 'link'].includes(field.type) || (kind === 'followup' && field.name === '附件' && field.type === 'attachment')), ...(field.options ? { enumValues: field.options.map(o => o.name) } : {}) };
  }) } };
}
export function releaseState(release, commit) {
  if (release.status === 'finished') {
    if (release.commit_id !== commit) throw new Error('发布提交与本轮推送不一致，不能报告成功');
    return 'finished';
  }
  if (release.status === 'failed') return 'failed';
  if (release.current_node_info?.current_status === 'PENDING' || release.status === 'pending') return 'awaiting-approval';
  return release.status === 'publishing' ? 'publishing' : 'unknown';
}
