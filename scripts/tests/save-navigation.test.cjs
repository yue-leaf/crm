const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const ts=require('typescript');
const source=fs.readFileSync(require('node:path').resolve(__dirname,'../../client/src/pages/crm/CrmPage.tsx'),'utf8');
const ast=ts.createSourceFile('CrmPage.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
let saveSource;
const keys={};
function walk(node){
 if(ts.isVariableDeclaration(node)&&node.name.getText(ast)==='save')saveSource=`const ${node.getText(ast)};`;
 if(ts.isJsxSelfClosingElement(node)&&['DetailToolbar','CustomerWorkspace','RecordDetails'].includes(node.tagName.getText(ast))){
  const key=node.attributes.properties.find(p=>p.name?.getText(ast)==='key');
  keys[node.tagName.getText(ast)]=key.initializer.expression.getText(ast);
 }
 ts.forEachChild(node,walk);
}
walk(ast);
function harness(kind='customer',origin=null){
 const selected=[],receipts=[],reads=[],restored=[],resumed=[];let refreshes=0,creates=0;
 const context={editor:{kind,operation:'create'},draft:{},uncertain:false,savingRef:{current:false},uploadingRef:{current:false},
  editorOrigin:{current:origin},suspendedEditor:{current:null},requestVersion:{current:0},detailVersion:{current:0},
  planSuggestion:{current:null},data:{records:[]},specs:()=>[],showField:()=>true,requiredField:x=>x,missingFields:()=>({}),
  actionDraft:(_,draft)=>draft,followupWriteDraft:d=>d,setFieldErrors:()=>{},setSaveError:()=>{},setSaving:()=>{},
  setEditor:()=>{},setSelection:row=>selected.push(row),setReceipt:row=>receipts.push(row),
  setAdoptedSuggestions:()=>{},toast:{success:()=>{},info:()=>{}},message:e=>e.message,SaveOutcomeUnknown:class extends Error{},
  reload:async()=>{refreshes++;},resumeFollowup:id=>resumed.push(id),
  api:{create:async()=>{creates++;return{id:'recNew',message:'saved'};},get:async(kind,id)=>{reads.push([kind,id]);return{id,record:{}};}},
  restoreLocation:(location,row)=>restored.push([location,row])};
 vm.createContext(context);
 vm.runInContext(ts.transpileModule(saveSource+'\nglobalThis.save=save;',{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,context);
 return{context,selected,receipts,reads,restored,resumed,save:context.save,counts:()=>({refreshes,creates})};
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
 assert.equal(h.restored.length,1);assert.equal(h.restored[0][1].id,'recCustomer');
 assert.equal(h.receipts.filter(x=>x&&typeof x!=='function').length,0);
});
test('inline contact creation still resumes the suspended followup draft',async()=>{
 const h=harness('contact');h.context.suspendedEditor.current={};await h.save();
 assert.deepEqual(h.resumed,['recNew']);assert.equal(h.counts().refreshes,0);
});
test('detail toolbar and workspace have distinct reconciliation keys on every clock refresh',()=>{
 assert.equal(Object.keys(keys).length,3);
 for(const selectionKind of ['customer','project','followup'])for(let tick=0;tick<20;tick++){
  const values=Object.values(keys).map(expression=>vm.runInNewContext(expression,{selectionKind,selection:{id:'recSame'}}));
  assert.equal(new Set(values).size,values.length,`duplicate sibling keys for ${selectionKind} at tick ${tick}`);
 }
});
