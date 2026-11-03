const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),ts=require('typescript'),vm=require('node:vm');
const {RecordPageChanged}=require('../../dist/shared/crm-navigation');
function client(respond) {
 const source=fs.readFileSync(path.resolve(__dirname,'../../client/src/api/crm.ts'),'utf8');
 const context={exports:{},URLSearchParams,require:name=>{
  if(name==='axios')return {isAxiosError:e=>e?.isAxiosError===true};
  if(name==='@shared/crm-navigation')return {RecordPageChanged};
  if(name==='@lark-apaas/client-toolkit/utils/getAxiosForBackend')return {axiosForBackend:respond};
  throw Error(`Unexpected dependency ${name}`);
 }};
 vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,context);
 return context.exports;
}
test('both resolved and rejected GET conflicts preserve the stale-page signal without retrying writes',async()=>{
 for(const reject of [false,true]) {
  let calls=0;
  const c=client(async()=>{calls++;const response={status:409,data:{error:{message:'记录已变化'}}};
   if(reject)throw {isAxiosError:true,response};return response;});
  await assert.rejects(()=>c.api.customerProjects('recCustomer',{cursor:'old'}),RecordPageChanged);
  await assert.rejects(()=>c.api.edit('project','recProject',{changes:{项目名称:'新名称'},expectedModifiedAt:1}),
   e=>!(e instanceof RecordPageChanged)&&e.message==='记录已变化');
  assert.equal(calls,2);
 }
});
test('failed writes remain uncertain and are never classified as recoverable pagination',async()=>{
 for(const response of [undefined,{status:502,data:{error:{message:'保存回读未确认'}}}]) {
  let calls=0;const c=client(async()=>{calls++;throw {isAxiosError:true,response};});
  await assert.rejects(()=>c.api.create('followup',{}),c.SaveOutcomeUnknown);assert.equal(calls,1);
 }
});
