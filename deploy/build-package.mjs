// Package a committed revision; never include local credentials or deployment state.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readJson, runProcess, sha, writeJson } from './core.mjs';
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== '--output')) throw new Error('用法：node deploy/build-package.mjs [--output 新目录]');
const git = (...args) => {
 const r = runProcess('git', args, {cwd:root});
 if(r.status!==0) throw new Error('Git 打包检查失败');
 return r.stdout.trim();
};
if(git('status','--porcelain','--untracked-files=normal')) throw new Error('请先提交工作区改动，部署包只包含已提交版本');
const sourceCommit = git('rev-parse','HEAD');
const output = args.length ? path.resolve(args[1]) : path.join(root,'deploy/.packages',`crm-${sourceCommit.slice(0,12)}`);
if(fs.existsSync(output)) throw new Error('输出目录已存在，指定新的 --output');
fs.mkdirSync(output,{recursive:true});
const toolFiles=git('ls-files','deploy','deploy.ps1').split('\n').filter(Boolean);
if(!toolFiles.includes('deploy/runtime.mjs')) throw new Error('部署工具尚未纳入 Git');
for(const file of toolFiles){
 const target=path.join(output,file);fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(path.join(root,file),target);
}
const configFile=path.join(output,'deploy/tenants/company-b.example.json');
const config=readJson(configFile);config.sourceCommit=sourceCommit;writeJson(configFile,config);
// Explicit runtime source trees + root build configuration only. No docs, exports or source bindings.
const roots=['client','server','shared','scripts'];
const rootFiles=git('ls-tree','--name-only',sourceCommit).split('\n').filter(f=>
 /^(package(?:-lock)?\.json|vite\.config\.ts|tsconfig(?:\.[a-z]+)?\.json|nest-cli\.json|eslint\.config\.js|\.stylelintrc\.js|postcss\.config\.js|tailwind\.config\.ts|components\.json|\.gitignore|\.prettierrc)$/.test(f));
const archive=path.join(output,'deploy/source.tar');
git('archive','--format=tar',`--output=${archive}`,sourceCommit,...roots,...rootFiles,':(exclude)server/capabilities');
writeJson(path.join(output,'deploy/source-manifest.json'),{version:2,sourceCommit,sha256:sha(fs.readFileSync(archive)),excludesCredentialsAndSourceIdentity:true});
const files={};
const walk=dir=>{for(const e of fs.readdirSync(dir,{withFileTypes:true})){const f=path.join(dir,e.name);if(e.isDirectory())walk(f);else files[path.relative(output,f).split(path.sep).join('/')]=sha(fs.readFileSync(f));}};
walk(output);writeJson(path.join(output,'package-checksums.json'),{sourceCommit,files});
console.log(JSON.stringify({status:'packaged',directory:output,sourceCommit,files:Object.keys(files).length,command:'powershell -File ./deploy.ps1 -Config ./deploy/tenants/company-b.json -Apply -Publish'},null,2));
