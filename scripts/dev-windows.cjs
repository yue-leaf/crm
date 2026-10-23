// Uses env-pull output only. Never fabricates login identity or roles.
const { spawn } = require('node:child_process');
const dotenv = require('dotenv');
require('node:dns').setDefaultResultOrder('ipv4first');
dotenv.config({ path: '.env.local', quiet: true });
dotenv.config({ path: '.env', quiet: true });
if (process.env.SUDA_WEBUSER) {
  try {
    JSON.parse(process.env.SUDA_WEBUSER);
  } catch {
    const value = process.env.SUDA_WEBUSER.replace(/\\"/g, '"');
    JSON.parse(value);
    process.env.SUDA_WEBUSER = value;
  }
}
process.env.MIAODA_LOCAL_DEV = '1';
process.env.NODE_ENV = 'development';
process.env.NODE_OPTIONS = [
  process.env.NODE_OPTIONS,
  '--dns-result-order=ipv4first',
]
  .filter(Boolean)
  .join(' ');
process.env.SERVER_HOST = '127.0.0.1';
process.env.SERVER_PORT = '3007';
const mode = process.argv[2] || 'server';
const args =
  mode === 'client'
    ? ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '4177']
    : ['node_modules/@nestjs/cli/bin/nest.js', 'start', '--watch'];
const child = spawn(process.execPath, args, {
  stdio: 'inherit',
  env: process.env,
});
child.on('exit', (code) => process.exit(code || 0));
