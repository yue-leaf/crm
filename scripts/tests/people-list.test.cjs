const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const ts=require('typescript');
const root=require('node:path').resolve(__dirname,'../../client/src/components/business-ui/entity-combobox');
function hook(options){
 const effects=[],calls=[];
 const react={useState:()=>[undefined,()=>{}],useCallback:f=>f,useEffect:f=>effects.push(f)};
 const context={exports:{},require:n=>n==='react'?react:{logger:{error:()=>{}}}};
 vm.runInNewContext(ts.transpileModule(fs.readFileSync(root+'/use-fetch-data.tsx','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,context);
 const result=context.exports.useFetchData({...options,fetchFn:async query=>{calls.push(query);return{items:[]};}});
 return {result,calls,effects};
}
test('owner picker requests initial list without typing; legacy search-only pickers stay unchanged',async()=>{
 const owner=hook({enabled:true,search:'',loadOnOpen:true}); await owner.result.refetch();assert.deepEqual(owner.calls,['']);
 const legacy=hook({enabled:true,search:''}); await legacy.result.refetch();assert.deepEqual(legacy.calls,[]);
 const closed=hook({enabled:false,search:'',loadOnOpen:true}); await closed.result.refetch();assert.deepEqual(closed.calls,[]);
});
