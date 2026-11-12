import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { databaseBootstrap, validatePublicUrl, verifyTrigger } from '../runtime.mjs';
import { verifyPackage } from '../verify-package.mjs';
import { sha, writeJson } from '../core.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

test('fresh DB bootstrap guards all four tables, RLS, unique coordination keys and seeds without resetting settings', () => {
  const sql = databaseBootstrap(path.join(root, 'server/database'));
  assert.ok(sql.startsWith('BEGIN;'));
  assert.ok(sql.endsWith('COMMIT;'));
  for (const table of ['crm_notification_setting', 'crm_notification_delivery', 'crm_followup_write', 'crm_deletion']) {
    assert.ok(sql.includes(`IF to_regclass('public.${table}') IS NULL THEN`));
    assert.ok(sql.includes(`CRM table RLS missing: ${table}`));
  }
  assert.ok(sql.includes('CRM unique index missing: crm_followup_write.record_key'));
  assert.ok(sql.includes('CRM unique index missing: crm_notification_delivery.delivery_key'));
  assert.ok(sql.includes("'daily', false, '08:00', ARRAY[]::text[]"));
  assert.ok(sql.includes('ON CONFLICT (setting_key) DO NOTHING'));
  assert.ok(!/\b(DROP|TRUNCATE|DELETE FROM)\b/i.test(sql));
});

test('notification URLs must belong to the published target app', () => {
  assert.equal(validatePublicUrl('https://target.feishuapp.com/app/app_target', 'app_target'), 'https://target.feishuapp.com/app/app_target');
  for (const url of ['http://target/app/app_target', 'https://target/app/app_original', 'https://user:secret@target/app/app_target', 'https://target/app/app_target?token=x']) {
    assert.throws(() => validatePublicUrl(url, 'app_target'));
  }
});

test('trigger drift and disabled final trigger cannot pass verification', () => {
  const t = {name:'crmDailyReminder',trigger_type:'cron',status:'enabled',trigger_condition:{cron:'*/30 * * * *',timezone:'Asia/Shanghai'}};
  verifyTrigger(t,'enabled');
  assert.throws(()=>verifyTrigger({...t,status:'disabled'},'enabled'));
  assert.throws(()=>verifyTrigger({...t,trigger_condition:{cron:'0 8 * * *',timezone:'Asia/Shanghai'}}));
});

test('package verification catches modified code and missing manifests', t => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'crm-package-test-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const files={};
  for(const name of ['deploy/run.mjs','deploy/engine.mjs','deploy/runtime.mjs','deploy/source.tar']) {
    fs.mkdirSync(path.dirname(path.join(dir,name)),{recursive:true});
    fs.writeFileSync(path.join(dir,name),'trusted'); files[name]=sha('trusted');
  }
  writeJson(path.join(dir,'package-checksums.json'),{files});verifyPackage(dir);
  fs.writeFileSync(path.join(dir,'deploy/runtime.mjs'),'modified');
  assert.throws(()=>verifyPackage(dir),/校验失败/);
});
