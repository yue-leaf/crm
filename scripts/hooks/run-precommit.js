#!/usr/bin/env node
// FULLSTACK_PRECOMMIT_V1
'use strict';

const { spawnSync } = require('node:child_process');

const SEP = '  ' + '─'.repeat(36);

function failAndExit(step, body) {
  process.stderr.write('\n✗ pre-commit failed: ' + step + '\n');
  process.stderr.write(SEP + '\n');
  if (body && body.length > 0) {
    process.stderr.write(body.replace(/\s+$/, '') + '\n');
  }
  process.stderr.write(SEP + '\n');
  process.stderr.write('  bypass: git commit --no-verify\n');
  process.exit(1);
}

function runLint() {
  const cwd = process.cwd();
  const res = spawnSync(process.execPath, ['scripts/lint.js'], {
    cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: process.env,
  });
  if (res.error) {
    failAndExit('lint', String(res.error.message || res.error));
  }
  if (res.status !== 0) {
    const stdout = res.stdout ? res.stdout.toString() : '';
    const stderr = res.stderr ? res.stderr.toString() : '';
    failAndExit('lint', stdout + '\n' + stderr);
  }
}

runLint();
const tests = spawnSync(process.execPath, ['scripts/test.cjs'], {
  cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'], env: process.env,
});
if (tests.error || tests.status !== 0) {
  failAndExit('regression tests', tests.error ? tests.error.message :
    String(tests.stdout || '') + '\n' + String(tests.stderr || ''));
}
