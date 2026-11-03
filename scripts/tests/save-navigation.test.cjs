const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const ts=require('typescript');
const source=fs.readFileSync(require('node:path').resolve(__dirname,'../../client/src/pages/crm/CrmPage.tsx'),'utf8');
const ast=ts.createSourceFile('CrmPage.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
let saveSource;
const editorHandlers=[];
const keys={};
function walk(node){
 if(ts.isVariableDeclaration(node)&&node.name.getText(ast)==='save')saveSource=`const ${node.getText(ast)};`;
 if(ts.isVariableDeclaration(node)&&['openEditor','set'].includes(node.name.getText(ast)))editorHandlers.push(`const ${node.getText(ast)};`);
 if(ts.isJsxSelfClosingElement(node)&&['DetailToolbar','CustomerWorkspace','RecordDetails'].includes(node.tagName.getText(ast))){
  const key=node.attributes.properties.find(p=>p.name?.getText(ast)==='key');
  keys[node.tagName.getText(ast)]=key.initializer.expression.getText(ast);
 }
 ts.forEachChild(node,walk);
}
walk(ast);
function harness(kind='customer',origin=null){
 const selected=[],receipts=[],reads=[],restored=[],resumed=[],payloads=[];let refreshes=0,creates=0;
 const context={pendingContacts:[],selectedContacts:[],customerSave:{current:{contacts:{}}},
  saveCustomerContacts:require('../../dist/shared/crm-customer-create').saveCustomerContacts,editor:{kind,operation:'create'},draft:{},uncertain:false,projectResolution:{current:0},projectResolvingRef:{current:false},setProjectResolving:()=>{},draftCustomer:'',savingRef:{current:false},uploadingRef:{current:false},
  editorOrigin:{current:origin},suspendedEditor:{current:null},requestVersion:{current:0},detailVersion:{current:0},
  planSuggestion:{current:null},data:{records:[]},specs:()=>[],showField:()=>true,requiredField:x=>x,missingFields:()=>({}),
  actionDraft:(_,draft)=>draft,followupWriteDraft:d=>d,setFieldErrors:()=>{},setSaveError:()=>{},setSaving:()=>{},
  setEditor:()=>{},setSelection:row=>selected.push(row),setReceipt:row=>receipts.push(row),setDetailRevision:()=>{},
  setAdoptedSuggestions:()=>{},toast:{success:()=>{},info:()=>{}},message:e=>e.message,SaveOutcomeUnknown:class extends Error{},
  reload:async()=>{refreshes++;},resumeFollowup:id=>resumed.push(id),
  api:{create:async(kind,draft)=>{creates++;payloads.push(draft);return{id:'recNew',message:'saved'};},get:async(kind,id)=>{reads.push([kind,id]);return{id,record:{}};}},
  restoreLocation:(location,row)=>restored.push([location,row])};
 vm.createContext(context);
 vm.runInContext(ts.transpileModule(saveSource+'\nglobalThis.save=save;',{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,context);
 return{context,selected,receipts,reads,restored,resumed,payloads,save:context.save,counts:()=>({refreshes,creates})};
}
test('root create closes the editor and refreshes the list without opening a detail or receipt',async()=>{
 for(const kind of ['customer','contact','project','followup']){
  const h=harness(kind);await h.save();
  assert.deepEqual(h.selected,[null]);assert.deepEqual(h.receipts,[null]);assert.deepEqual(h.reads,[]);
  assert.equal(h.counts().refreshes,1);assert.equal(h.counts().creates,1);
 }
});
test('creating a related contact returns to its source customer without a saved/continue banner',async()=>{
 const origin={kind:'customer',row:{id:'recCustomer',record:{}},tab:'contacts'};
 const h=harness('contact',origin);await h.save();
 assert.equal(h.restored.length,2);assert.equal(h.restored[1][1].id,'recCustomer');
 assert.ok(!h.selected.includes(null));
 assert.equal(h.receipts.filter(x=>x&&typeof x!=='function').length,0);
});
test('inline contact creation still resumes the suspended followup draft',async()=>{
 const h=harness('contact');h.context.suspendedEditor.current={};await h.save();
 assert.deepEqual(h.resumed,['recNew']);assert.equal(h.counts().refreshes,0);
});
test('detail toolbar and workspace have distinct reconciliation keys on every clock refresh',()=>{
 assert.equal(Object.keys(keys).length,3);
 for(const selectionKind of ['customer','project','followup'])for(let tick=0;tick<20;tick++){
  const values=Object.values(keys).map(expression=>vm.runInNewContext(expression,{selectionKind,selection:{id:'recSame'},detailRevision:tick}));
  assert.equal(new Set(values).size,values.length,`duplicate sibling keys for ${selectionKind} at tick ${tick}`);
 }
});
test('source customer stays open while the list and parent refresh are delayed',async()=>{
 const origin={kind:'customer',row:{id:'recCustomer',record:{}},tab:'contacts',scroll:120};
 const h=harness('contact',origin);let finish;
 h.context.reload=()=>new Promise(resolve=>{finish=resolve;});
 const pending=h.save();await new Promise(resolve=>setImmediate(resolve));
 assert.equal(h.restored.length,1);assert.equal(h.restored[0][0].tab,'contacts');assert.deepEqual(h.selected,[]);
 finish();await pending;assert.equal(h.restored[1][1].id,'recCustomer');
});
test('successful contact creation keeps the source customer even if rereading its details fails',async()=>{
 const origin={kind:'customer',row:{id:'recCustomer',record:{}},tab:'contacts'};
 const h=harness('contact',origin);h.context.api.get=async()=>{throw Error('network unavailable');};
 await h.save();assert.equal(h.counts().creates,1);assert.equal(h.restored.length,1);
 assert.equal(h.restored[0][0].row.id,'recCustomer');assert.deepEqual(h.selected,[]);
});
test('customer context locks contact and project parents; standalone create remains selectable and lock resets',()=>{
 const context={projectResolution:{current:0},projectResolvingRef:{current:false},setProjectResolving:()=>{},draftCustomer:'',savingRef:{current:false},uploadingRef:{current:false},editorOrigin:{},currentLocation:()=>null,
  planSuggestion:{},editorRequestVersion:{current:0},detailVersion:{current:0},initialDraft:{},session:null,
  specs:()=>[],isLifecycle:()=>false,setFollowupCustomer:()=>{},setCustomerResolveError:()=>{},
  setSaveError:()=>{},setFieldErrors:()=>{},setUncertain:()=>{},structuredClone,
  changeDraft:require('../../dist/shared/crm-interaction.js').changeDraft,FOLLOWUP_CUSTOMER:'跟进客户'};
 context.setEditor=value=>{context.editor=value;};context.setDraft=value=>{context.draft=typeof value==='function'?value(context.draft):value;};
 vm.createContext(context);
 vm.runInContext(ts.transpileModule(editorHandlers.join('\n')+'\nglobalThis.handlers={openEditor,set};',{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,context);
 for(const kind of ['contact','project']) {
  context.handlers.openEditor(kind,'create',undefined,{所属企业:['recCustomer']});
  assert.equal(context.editor.fixedCustomerId,'recCustomer');context.handlers.set('所属企业',['recOther']);
  assert.equal(context.draft.所属企业[0],'recCustomer');
  context.handlers.openEditor(kind);assert.equal(context.editor.fixedCustomerId,undefined);
  context.handlers.set('所属企业',['recOther']);assert.equal(context.draft.所属企业[0],'recOther');
 }
 context.changeFollowupTarget=require('../../dist/shared/crm-followup-target.js').changeFollowupTarget;
 context.handlers.openEditor('followup','create',undefined,{跟进客户:['recCustomer'],直接客户:['recCustomer'],关联项目:[]});
 assert.equal(context.editor.fixedCustomerId,'recCustomer');context.handlers.set('跟进客户',['recOther']);
 assert.equal(context.draft.跟进客户[0],'recCustomer');
 context.handlers.set('关联项目',['recProject']);assert.equal(context.draft.关联项目[0],'recProject');
 assert.equal(context.draft.直接客户.length,0);
 context.handlers.set('关联项目',[]);assert.equal(context.draft.直接客户[0],'recCustomer');
 context.handlers.openEditor('followup');assert.equal(context.editor.fixedCustomerId,undefined);
 context.handlers.set('跟进客户',['recOther']);assert.equal(context.draft.跟进客户[0],'recOther');
 context.handlers.openEditor('followup','create',undefined,{跟进客户:['recCustomer'],关联项目:['recProject'],直接客户:[]});
 assert.equal(context.editor.fixedProjectId,'recProject');context.handlers.set('关联项目',[]);
 assert.equal(context.draft.关联项目[0],'recProject');context.handlers.set('关联项目',['recOther']);
 assert.equal(context.draft.关联项目[0],'recProject');
 context.handlers.openEditor('followup');assert.equal(context.editor.fixedProjectId,undefined);

});
test('project-origin followup submission retains the source project and keeps direct customer empty',async()=>{
 const h=harness('followup');h.context.editor.fixedCustomerId='recCustomer';h.context.editor.fixedProjectId='recProject';
 h.context.FOLLOWUP_CUSTOMER='跟进客户';h.context.followupWriteDraft=require('../../dist/shared/crm-followup-target.js').followupWriteDraft;
 h.context.draft={跟进客户:['recOther'],关联项目:['recOther']};await h.save();
 assert.equal(h.payloads[0].关联项目[0],'recProject');assert.equal(h.payloads[0].直接客户.length,0);
});
test('fixed followup customer is submitted for direct followup but remains context-only when a project is selected',async()=>{
 for(const project of [[],['recProject']]){
  const h=harness('followup');h.context.editor.fixedCustomerId='recCustomer';
  h.context.FOLLOWUP_CUSTOMER='跟进客户';h.context.followupWriteDraft=require('../../dist/shared/crm-followup-target.js').followupWriteDraft;
  h.context.draft={跟进客户:['recOther'],直接客户:['recOther'],关联项目:project};
  await h.save();const written=h.payloads[0];
  assert.equal(Object.hasOwn(written,'跟进客户'),false);
  assert.equal(written.跟进归属,project.length?'项目跟进':'客户直接跟进');
  assert.equal(written.直接客户.length,project.length?0:1);
  if(!project.length)assert.equal(written.直接客户[0],'recCustomer');
  else assert.equal(written.关联项目[0],'recProject');
 }
});
test('contact and project saves always use the fixed customer from their source context',async()=>{
 for(const kind of ['contact','project']) {
  const h=harness(kind);h.context.editor.fixedCustomerId='recCustomer';h.context.draft={所属企业:['recOther'],名称:'Record'};
  await h.save();assert.equal(h.payloads[0].所属企业[0],'recCustomer');assert.equal(h.payloads[0].名称,'Record');
 }

});
test('project-first selection resolves its customer and ignores a late result after customer changes',async()=>{
 const setHandler=editorHandlers.find(s=>s.startsWith('const set ='));
 for(const supersede of [false,true]){
  let resolve;const pending=new Promise(r=>{resolve=r;});
  const c={editor:{kind:'followup',operation:'create'},draft:{跟进主题:'保留内容'},FOLLOWUP_CUSTOMER:'跟进客户',
   projectResolution:{current:0},projectResolvingRef:{current:false},savingRef:{current:false},uploadingRef:{current:false},initialDraft:{current:{}},
   setProjectResolving:()=>{},setSaveError:()=>{},setFieldErrors:()=>{},message:e=>e.message,
   projectFirstDraft:require('../../dist/shared/crm-followup-target').projectFirstDraft,
   changeFollowupTarget:require('../../dist/shared/crm-followup-target').changeFollowupTarget,
   api:{get:()=>pending}};
  c.setDraft=fn=>{c.draft=fn(c.draft);};vm.createContext(c);
  vm.runInContext(ts.transpileModule(setHandler+'\nglobalThis.setField=set;',{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,c);
  c.setField('关联项目',['recProject']);assert.equal(c.projectResolvingRef.current,true);
  if(supersede)c.setField('跟进客户',['recOther']);
  resolve({id:'recProject',record:{所属企业:{link_record_ids:['recCustomer']}}});
  await new Promise(r=>setImmediate(r));
  assert.equal(c.draft.跟进客户[0],supersede?'recOther':'recCustomer');
  assert.equal(c.draft.跟进主题,'保留内容');assert.equal(c.projectResolvingRef.current,false);
  assert.equal(c.draft.关联项目.length,supersede?0:1);
 }
});
