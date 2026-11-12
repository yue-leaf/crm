import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Cli, findNpm, readJson, runProcess, unwrap, validateConfig } from './core.mjs';
import { Deployment } from './engine.mjs';
import { verifyPackage } from './verify-package.mjs';

export function parseArgs(argv) {
  const out = {};
  const switches = new Map([['--apply', 'apply'], ['--publish', 'publish'], ['--inspect-identity', 'inspectIdentity']]);
  const values = new Map([['--config', 'config'], ['--approve-action', 'approveAction'], ['--retry-action', 'retryAction'], ['--adopt-base-token', 'adoptBaseToken'], ['--adopt-app-id', 'adoptAppId']]);
  for (let i = 0; i < argv.length; i++) {
    const key = switches.get(argv[i]) || values.get(argv[i]);
    if (!key || key in out) throw new Error(`未知或重复参数：${argv[i]}`);
    if (switches.has(argv[i])) out[key] = true;
    else { if (!argv[i + 1] || argv[i + 1].startsWith('--')) throw new Error(`缺少参数值：${argv[i]}`); out[key] = argv[++i]; }
  }
  if (!out.config) throw new Error('必须指定 --config');
  if (out.publish && !out.apply) throw new Error('-Publish 必须同时指定 -Apply；默认预览不会发布');
  for (const key of ['approveAction', 'retryAction']) if (out[key] && !/^[a-f0-9]{64}$/.test(out[key])) throw new Error(`无效操作哈希：${key}`);
  if (out.adoptBaseToken && !/^[A-Za-z0-9]+$/.test(out.adoptBaseToken)) throw new Error('Base Token 格式无效');
  if (out.adoptAppId && !/^app_[A-Za-z0-9]+$/.test(out.adoptAppId)) throw new Error('应用 ID 格式无效');
  if (out.inspectIdentity && (out.apply || out.publish)) throw new Error('-InspectIdentity 不能同时写入或发布');
  return out;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
  verifyPackage(root);
  const config = validateConfig(readJson(path.resolve(options.config)), !!options.apply);
  const blueprint = readJson(path.join(root, 'deploy/blueprint.json'));
  if (options.inspectIdentity) {
    const cli = new Cli(config.profile, { cwd: root });
    const identity = cli.call(['whoami']);
    const user = unwrap(cli.call(['api', 'GET', '/open-apis/authen/v1/user_info']));
    console.log(JSON.stringify({ profile: config.profile, expectedCliAppId: identity.appId, expectedUserOpenId: user.open_id, expectedTenantKey: user.tenant_key, expectedUserName: user.name, note: '只读；企业编号需人工填写，tenant_key 才是脚本核验的企业标识；未保存凭据' }, null, 2));
    return;
  }
  // Preview has no external commands, authentication, directory creation or state mutation.
  if (!options.apply) {
    console.log(JSON.stringify(new Deployment({ root, config, blueprint, options }).plan(), null, 2));
    return;
  }
  if (Number(process.versions.node.split('.')[0]) < 22) throw new Error('实际部署需要 Node.js 22+；使用 -NodePath 指定正确版本');
  const cli = new Cli(config.profile, { cwd: root });
  if (process.stdin.isTTY && process.stdout.isTTY) options.confirmAction = ({ key, argv }) => {
    const preview = cli.call([...argv, '--dry-run']);
    console.log(JSON.stringify({ action: key, risk: 'high-risk-write', request: preview }, null, 2));
    process.stdout.write('确认执行以上高风险配置变更？输入 yes 继续，其它输入停止：');
    let answer = '';
    const byte = Buffer.alloc(1);
    while (fs.readSync(0, byte, 0, 1, null) > 0) { const char = byte.toString(); if (char === '\n') break; if (char !== '\r') answer += char; }
    return answer.trim() === 'yes';
  };
  // Check supported commands before any remote write. Help text is not logged.
  for (const args of [['base', '+dashboard-arrange'], ['base', '+role-update'], ['apps', '+role-member-add'], ['apps', '+user-id-convert'], ['apps', '+release-create'], ['apps', '+db-execute'], ['apps', '+automation-create'], ['apps', '+automation-get'], ['apps', '+automation-enable'], ['apps', '+env-list'], ['apps', '+env-set']]) {
    const check = runProcess(process.execPath, [cli.cliPath, ...args, '--help']);
    if (check.status !== 0) throw new Error(`CLI 缺少所需命令：${args.join(' ')}；请升级 CLI`);
  }
  // Formula acknowledgement is only passed after consulting the matching installed guide.
  for (const [skill, ref] of [['lark-base', 'references/lark-base-field-formula.md'], ['lark-base', 'references/lark-base-role-config.md'], ['lark-apps', 'references/lark-apps-local-dev.md']]) {
    const guide = runProcess(process.execPath, [cli.cliPath, 'skills', 'read', skill, ref]);
    if (guide.status !== 0) throw new Error(`读取 CLI 指南失败：${skill}/${ref}`);
  }
  const deploy = new Deployment({ root, config, blueprint, cli, process: runProcess, npmPath: findNpm(), options });
  console.log(`目标：${config.expectedEnterpriseDisplayId} / ${config.expectedTenantKey} / ${config.expectedUserOpenId}`);
  console.log(`发布理由：${config.releaseReason}`);
  const result = await deploy.run();
  console.log(JSON.stringify({ ...result, report: path.join(deploy.stateDir, 'report.json'), ...(result.status === 'finished' ? { access: config.accessMode === 'tenant' ? '本企业已登录成员可访问' : (config.employeeOpenIds || []).length ? '仅指定管理员和员工可访问' : '仅部署管理员可访问' } : {}) }, null, 2));
  if (result.status !== 'finished' && result.status !== 'prepared') process.exitCode = 2;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); if (error.scopes?.length) console.error(`缺少权限：${error.scopes.join(', ')}`); process.exitCode = 1; });
}
