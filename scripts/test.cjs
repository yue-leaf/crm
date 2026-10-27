// Rebuild before running the entire offline suite; never test stale dist files.
const {spawnSync}=require('node:child_process');
const {readdirSync}=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
function run(args){
  const result=spawnSync(process.execPath,args,{cwd:root,stdio:'inherit'});
  if(result.error)throw result.error;
  if(result.status!==0)process.exit(result.status??1);
}
run(['node_modules/@nestjs/cli/bin/nest.js','build']);
const files=readdirSync(path.join(__dirname,'tests')).filter(name=>name.endsWith('.test.cjs')).sort();
if(!files.length)throw Error('No regression tests found');
run(['--test',...files.map(name=>path.join(__dirname,'tests',name))]);
