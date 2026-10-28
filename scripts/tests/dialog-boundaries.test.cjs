const {test}=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),ts=require('typescript'),vm=require('node:vm');
const root=path.resolve(__dirname,'../../client/src/pages/crm');
const compile=s=>ts.transpileModule(s,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
function find(file,predicate){const ast=ts.createSourceFile(file,fs.readFileSync(path.join(root,file),'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);let result;function walk(n){if(predicate(n,ast))result=n;ts.forEachChild(n,walk);}walk(ast);assert.ok(result);return{node:result,ast,text:result.getText(ast)};}
function handler(file,name,context){const {text}=find(file,(n,a)=>ts.isVariableDeclaration(n)&&n.name.getText(a)===name);vm.createContext(context);vm.runInContext(compile(`const ${text};globalThis.handler=${name};`),context);return context.handler;}
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};};
test('cancelling an uncertain save keeps the source parent, while standalone cancel still closes',()=>{
 for(const parent of [null,{kind:'customer',row:{id:'recParent'},tab:'contacts'}]){
  const selected=[],restored=[];let reloads=0;
  const c={savingRef:{current:false},uploadingRef:{current:false},uncertain:true,suspendedEditor:{current:null},resumeFollowup:()=>false,
   editorOrigin:{current:parent},setEditor:()=>{},setSelection:r=>selected.push(r),setDetailRevision:()=>{},restoreLocation:r=>restored.push(r),reload:()=>reloads++};
  handler('CrmPage.tsx','closeEditor',c)();assert.equal(reloads,1);
  assert.equal(restored.length,parent?1:0);assert.equal(selected.length,parent?0:1);
 }
});
function workspace(){const read=deferred(),calls=[],errors=[];const c={opening:{current:false},transitioning:{current:false},generation:{current:0},selection:{kind:'customer'},setOpeningId:()=>{},setError:e=>errors.push(e),message:e=>e.message,
 api:{get:()=>read.promise},onOpen:row=>calls.push(['open',row.id]),onClose:()=>calls.push(['close'])};return{c,read,calls,errors,open:handler('WorkspaceRecords.tsx','openRecord',c)};}
test('workspace waits for successful detail read before closing the summary',async()=>{
 const h=workspace();const p=h.open({id:'recRow'});assert.deepEqual(h.calls,[]);
 h.read.resolve({id:'recRow',record:{}});await p;assert.deepEqual(h.calls,[['open','recRow'],['close']]);
});
test('workspace keeps summary and reports errors when detail read fails',async()=>{
 const h=workspace();const p=h.open({id:'recRow'});h.read.reject(Error('network unavailable'));await p;
 assert.deepEqual(h.calls,[]);assert.equal(h.errors.at(-1),'network unavailable');assert.equal(h.c.opening.current,false);
});
test('closing summary during a pending read prevents a late detail from opening',async()=>{
 const h=workspace();const p=h.open({id:'recRow'});h.c.generation.current++;
 h.read.resolve({id:'recRow',record:{}});await p;assert.deepEqual(h.calls,[]);
});
test('day rollover refreshes data without clearing dialogs or drafts and runs once per day',()=>{
 const {node,ast}=find('CrmPage.tsx',(n,a)=>ts.isCallExpression(n)&&n.expression.getText(a)==='useEffect'&&n.arguments[0]?.getText(a).includes('lastRefreshDay.current === currentDay'));
 let refreshes=0;const c={lastRefreshDay:{current:10},currentDay:11,reload:()=>refreshes++,setSelection:()=>assert.fail('parent cleared'),setEditor:()=>assert.fail('editor cleared'),setDraft:()=>assert.fail('draft cleared')};
 vm.createContext(c);vm.runInContext(compile(`const effect=${node.arguments[0].getText(ast)};effect();effect();`),c);assert.equal(refreshes,1);
 const reload=find('CrmPage.tsx',(n,a)=>ts.isVariableDeclaration(n)&&n.name.getText(a)==='reload');
 assert.ok(!reload.node.initializer.arguments[1].getText(reload.ast).includes('currentDay'));
});
test('background workspace reload does not clear existing overview data and collapse its dialog',async()=>{
 const {node,ast}=find('CrmPage.tsx',(n,a)=>ts.isVariableDeclaration(n)&&n.name.getText(a)==='reload');
 const updates=[];const c={authorized:true,active:'home',requestVersion:{current:0},setLoading:()=>{},setError:()=>{},setOverview:v=>updates.push(v),api:{workspace:async()=>({scope:'all',total:1})},scope:'all'};
 vm.createContext(c);vm.runInContext(compile(`globalThis.reload=${node.initializer.arguments[0].getText(ast)};`),c);await c.reload();
 assert.equal(updates.length,1);assert.ok(updates[0]);
});
