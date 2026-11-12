import fs from 'node:fs';
import path from 'node:path';
import { readJson, sha, within } from './core.mjs';

export function verifyPackage(root) {
  const file = path.join(root, 'package-checksums.json');
  if (!fs.existsSync(file)) {
    if (fs.existsSync(path.join(root, 'deploy/source-manifest.json'))) throw new Error('部署包缺少文件校验清单');
    return;
  }
  const manifest = readJson(file);
  for (const [relative, digest] of Object.entries(manifest.files || {})) {
    const target = within(root, path.join(root, relative));
    if (fs.existsSync(target)) within(fs.realpathSync(root), fs.realpathSync(target));
    if (!fs.existsSync(target) || fs.lstatSync(target).isSymbolicLink()
      || sha(fs.readFileSync(target)) !== digest) throw new Error(`部署包文件校验失败：${relative}`);
  }
  for (const required of ['deploy/run.mjs', 'deploy/engine.mjs', 'deploy/runtime.mjs', 'deploy/source.tar']) {
    if (!manifest.files?.[required]) throw new Error(`校验清单缺少 ${required}`);
  }
}
