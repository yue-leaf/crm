const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const path = require('node:path');
const root = path.resolve(__dirname, '../../client/src/pages/crm');
const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => { resolve=a; reject=b; }); return {promise,resolve,reject}; };
const compile = source => ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React } }).outputText;
function button(onClick) {
  const slots=[]; let index=0, updates=0; const cleanups=[]; const errors=[];
  const react={ createElement:(type,props,...children)=>({type,props:{...props,children}}),
    useState(initial) { const n=index++; if (!(n in slots)) slots[n]=initial; return [slots[n],v=>{slots[n]=v; updates++;}]; },
    useRef(initial) { const n=index++; return slots[n] ||= {current:initial}; },
    useEffect(effect) { const n=index++; if (!(n in slots)) { slots[n]=true; cleanups.push(effect()); } } };
  const context={exports:{},require:name=> name==='react'?react:name==='lucide-react'?{LoaderCircle:'spinner'}:name==='sonner'?{toast:{error:e=>errors.push(e)}}:{Button:'button'}};
  vm.runInNewContext(compile(fs.readFileSync(path.join(root,'ActionButton.tsx'),'utf8')),context);
  const render=()=>{index=0; return context.exports.ActionButton({onClick,children:'编辑'});};
  return {render,errors,unmount:()=>cleanups.forEach(f=>f?.()),updates:()=>updates};
}
const event=()=>({preventDefault(){}});
test('only the clicked button loads; rapid repeat clicks make one request; label retains its layout slot',async()=>{
  const d=deferred();let calls=0;
  const a=button(()=>{calls++; return d.promise;});const b=button(()=>{});
  const before=a.render();const pending=before.props.onClick(event());
  await before.props.onClick(event());
  assert.equal(calls,1);assert.equal(a.render().props.disabled,true);assert.equal(b.render().props.disabled,false);
  assert.equal(a.render().props.children[0].props.children[0],'编辑');
  assert.equal(a.render().props.children[0].props.style.opacity,0);
  d.resolve();await pending;assert.equal(a.render().props.disabled,false);
});
test('failed action clears local loading and allows retry without affecting another button',async()=>{
  let calls=0;const a=button(async()=>{if(++calls===1)throw new Error('network failed');});
  await a.render().props.onClick(event());assert.equal(a.render().props.disabled,false);assert.equal(a.errors.length,1);
  await a.render().props.onClick(event());assert.equal(calls,2);assert.equal(a.errors.length,1);
});
test('unmounted action does not update state or show a stale error',async()=>{
 const d=deferred();const a=button(()=>d.promise);const p=a.render().props.onClick(event());a.unmount();const updates=a.updates();
 d.reject(new Error('late'));await p;assert.equal(a.updates(),updates);assert.equal(a.errors.length,0);
});
function navigation() {
 const source=fs.readFileSync(path.join(root,'CrmPage.tsx'),'utf8');const ast=ts.createSourceFile('CrmPage.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
 const wanted=new Set(['edit','detail','workspaceAction']);const bodies=[];
 function walk(node){if(ts.isVariableDeclaration(node)&&wanted.has(node.name.getText(ast))) bodies.push(`const ${node.getText(ast)};`);ts.forEachChild(node,walk);}walk(ast);
 const reads=[];const opened=[];const selected=[];const errors=[];const ref=()=>({current:0});
 const context={active:'customer',savingRef:{current:false},uploadingRef:{current:false},requestVersion:ref(),editorRequestVersion:ref(),detailVersion:ref(),
 api:{get:(kind,id)=>{const d=deferred();reads.push({kind,id,...d});return d.promise;}},
 editBlockedReason:()=>'',advancementBlocked:()=>'',message:e=>e.message,toast:{error:e=>errors.push(e)},
 openEditor:(kind,op,row)=>{context.editorRequestVersion.current++;context.detailVersion.current++;opened.push({kind,op,id:row?.id});},
 currentLocation:()=>null,setDetailTrail:()=>{},setScrollRequest:()=>{},setReceipt:()=>{},setSelectionKind:()=>{},setDetailTab:()=>{},linkIds:()=>[],setCustomerContext:()=>{},setSelection:row=>selected.push(row.id),
 recordDraft:()=>({}),planFields:[],relatedDraft:()=>({})};
 vm.createContext(context);vm.runInContext(compile(bodies.join('\n')+'\nglobalThis.handlers={edit,detail,workspaceAction};'),context);
 return {context,reads,opened,selected,errors,...context.handlers};
}
const row=id=>({id,record:{}});
test('switching to another edit accepts the latest choice and ignores a late earlier response',async()=>{
 const n=navigation();const a=n.edit(row('a'));const b=n.edit(row('b'));assert.equal(n.reads.length,2);
 n.reads[1].resolve(row('b'));await b;n.reads[0].resolve(row('a'));await a;
 assert.deepEqual(n.opened,[{kind:'customer',op:'edit',id:'b'}]);
});
test('switching between view and edit cannot open the previous action afterward',async()=>{
 for(const order of [['edit','detail'],['detail','edit']]){
  const n=navigation();const a=n[order[0]](row('a'));const b=n[order[1]](row('b'));
  n.reads[0].resolve(row('a'));await a;assert.equal(n.opened.length+n.selected.length,0);
  n.reads[1].resolve(row('b'));await b;assert.equal(n.opened.length+n.selected.length,1);
 }
});
test('workspace plan supersedes an earlier followup; obsolete failures stay quiet',async()=>{
 const n=navigation();const a=n.workspaceAction('customer','a','followup');const b=n.workspaceAction('customer','b','plan');
 n.reads[0].reject(new Error('old'));await a;assert.equal(n.errors.length,0);
 n.reads[1].resolve(row('b'));await b;assert.deepEqual(n.opened,[{kind:'customer',op:'plan',id:'b'}]);
});
