import fs from 'node:fs';
import path from 'node:path';
import { unwrap } from './core.mjs';

export const databaseFiles = ['notification.sql', 'followup-write.sql', 'deletion.sql'];
export const triggerName = 'crmDailyReminder';

// Fresh deployments only. Existing tables are verified, never replaced or truncated.
// Each table and all its policies are created atomically; a retry cannot duplicate policies.
export function databaseBootstrap(directory) {
  const blocks = [];
  for (const file of databaseFiles) {
    const sql = fs.readFileSync(path.join(directory, file), 'utf8');
    const tables = sql.split(/(?=CREATE TABLE IF NOT EXISTS )/).filter(s => s.trim());
    for (const section of tables) {
      const match = section.match(/^CREATE TABLE IF NOT EXISTS (crm_\w+)\s*\(([\s\S]*?)\);/);
      if (!match) throw new Error(`数据库初始化文件格式不支持：${file}`);
      const [, table, definition] = match;
      const columns = [...definition.matchAll(/(?:^|,\s*\n)(\w+)\s+([\s\S]*?)(?=,\s*\n|$)/g)];
      const policies = [...section.matchAll(/CREATE POLICY ("[^"]+"|\w+) ON/g)]
        .map(p => p[1].replaceAll('"', ''));
      if (!columns.length || !policies.length) throw new Error(`无法验证数据库定义：${table}`);
      blocks.push(`DO $crm$ BEGIN
IF to_regclass('public.${table}') IS NULL THEN
${section}
END IF;
IF NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='public' AND c.relname='${table}' AND c.relrowsecurity) THEN
  RAISE EXCEPTION 'CRM table RLS missing: ${table}'; END IF;
${columns.map(([, name, spec]) => {
        const type = spec.trim().match(/^(timestamp\(3\) with time zone|\w+(?:\(\d+\))?(?:\[\])?)/i)?.[0];
        const normalized = type?.toLowerCase().replace(/^varchar/, 'character varying').replace(/^timestamptz$/, 'timestamp with time zone').replace(/^timestamp\(3\) with time zone$/, 'timestamp(3) with time zone');
        if (!normalized) throw new Error(`无法验证字段类型：${table}.${name}`);
        return `IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid='public.${table}'::regclass
  AND attname='${name}' AND NOT attisdropped AND format_type(atttypid,atttypmod)='${normalized}'
  ${/NOT NULL|PRIMARY KEY/i.test(spec) ? 'AND attnotnull' : ''}) THEN
  RAISE EXCEPTION 'CRM column mismatch: ${table}.${name}'; END IF;`;
      }).join('\n')}
${policies.map(name => `IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public'
  AND tablename='${table}' AND policyname='${name}') THEN
  RAISE EXCEPTION 'CRM policy missing: ${table}.${name}'; END IF;`).join('\n')}
${columns.filter(([, , spec]) => /UNIQUE|PRIMARY KEY/i.test(spec)).map(([, name]) => `IF NOT EXISTS (
  SELECT 1 FROM pg_index i JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=ANY(i.indkey)
  WHERE i.indrelid='public.${table}'::regclass AND i.indisunique AND i.indisvalid AND i.indnkeyatts=1
  AND i.indpred IS NULL AND a.attname='${name}') THEN
  RAISE EXCEPTION 'CRM unique index missing: ${table}.${name}'; END IF;`).join('\n')}
END $crm$;`);
    }
  }
  const seed = fs.readFileSync(path.join(directory, 'notification-seed.sql'), 'utf8');
  return `BEGIN;\nSET LOCAL search_path = public;\n${blocks.join('\n')}\n${seed}\nCOMMIT;`;
}

export function verifyTrigger(trigger, status) {
  if (!trigger || trigger.name !== triggerName || trigger.trigger_type !== 'cron'
    || trigger.trigger_condition?.cron !== '*/30 * * * *'
    || trigger.trigger_condition?.timezone !== 'Asia/Shanghai'
    || (status && trigger.status !== status)) throw new Error('通知触发器配置不一致；不会覆盖已有配置');
}

export async function prepareRuntime(deploy) {
  const d = deploy;
  const app = ['--app-id', d.state.resources.appId];
  d.log('初始化独立应用数据库和通知配置（不导入业务数据）');
  const sql = databaseBootstrap(path.join(d.work, 'server/database'));
  fs.writeFileSync(path.join(d.stateDir, 'runtime-init.sql'), sql, { mode: 0o600 });
  // Use the same non-destructive initialization in both independent environments.
  // Do not migrate unrelated pending schema changes from a target app.
  for (const environment of ['dev', 'online']) {
    d.call(['apps', '+db-execute', ...app, '--environment', environment,
      '--file', 'runtime-init.sql', '--yes'], d.stateDir);
    d.state.checks[`database:${environment}`] = 'schema-verified-and-seeded';
    d.journal.save();
  }
  const list = unwrap(d.call(['apps', '+automation-list', ...app, '--all']));
  if (list.has_more || !Array.isArray(list.items)) throw new Error('通知触发器列表格式异常');
  const matches = list.items.filter(t => t.name === triggerName);
  if (matches.length > 1) throw new Error('存在同名通知触发器');
  if (!matches.length) d.change('notice-trigger-create', ['apps', '+automation-create', ...app,
    '--name', triggerName, '--trigger-type', 'cron', '--cron', '*/30 * * * *',
    '--timezone', 'Asia/Shanghai', '--status', 'disabled']);
  verifyTrigger(unwrap(d.call(['apps', '+automation-get', ...app, '--name', triggerName])).trigger);

  const env = unwrap(d.call(['apps', '+env-list', ...app, '--environment', 'online']));
  if (!Array.isArray(env.items) || !env.items.some(item => item.key === 'FEISHU_BASE_PERSONAL_TOKEN')) {
    throw new Error(`请在目标妙搭应用 ${d.state.resources.appId} 的线上服务端环境变量配置 FEISHU_BASE_PERSONAL_TOKEN：使用目标账号获取的多维表格授权码。配置后重跑相同命令；不要填写到部署 JSON 中。`);
  }
  d.state.checks.attachmentCredential = 'key-present; upload acceptance required';
  d.journal.save();
}

export function validatePublicUrl(value, appId) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash
    || !url.pathname.split('/').includes(appId)) throw new Error('平台发布地址不属于目标应用');
  return url.href.replace(/\/$/, '');
}

export async function finishRuntime(d, firstRelease) {
  const appId = d.state.resources.appId;
  const url = validatePublicUrl(firstRelease.onlineUrl, appId);
  for (const environment of ['dev', 'online']) {
    d.change(`public-url:${environment}`, ['apps', '+env-set', '--app-id', appId,
      '--environment', environment, '--key', 'CRM_PUBLIC_URL', '--value', url,
      ...(environment === 'online' ? ['--yes'] : [])], () => ({ configured: true }));
    // Read values only in memory. Never journal/log the response (it can contain other secrets).
    const variables = unwrap(d.call(['apps', '+env-list', '--app-id', appId,
      '--environment', environment, '--include-values']));
    if (variables.has_more || !Array.isArray(variables.items)
      || variables.items.find(item => item.key === 'CRM_PUBLIC_URL')?.value !== url) {
      throw new Error(`CRM_PUBLIC_URL ${environment} 回读不一致；请核对目标应用设置后重跑`);
    }
  }
  // Release again so the runtime definitely loads the new online environment variable.
  // Both release IDs are checkpointed; reruns poll the same release instead of duplicating it.
  const result = await d.publish('runtime-release');
  if (result.status !== 'finished') return result;
  if (validatePublicUrl(result.onlineUrl, appId) !== url) throw new Error('两轮发布地址不一致，通知链接需要重新核对');
  d.change('notice-trigger-enable', ['apps', '+automation-enable', '--app-id', appId, '--name', triggerName]);
  verifyTrigger(unwrap(d.call(['apps', '+automation-get', '--app-id', appId, '--name', triggerName])).trigger, 'enabled');
  d.state.checks.notifications = 'trigger-enabled; administrator-must-enable-settings';
  d.state.checks.publicUrl = url;
  d.journal.save();
  return { ...result, notificationSettings: '首次部署默认关闭；管理员选择收件人及发送时间后启用' };
}
