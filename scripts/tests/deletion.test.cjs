require('reflect-metadata');
const {test}=require('node:test');const assert=require('node:assert/strict');
const {deletionPlan,deletionView}=require('../../dist/server/modules/crm/crm-deletion-plan');
const {CrmDeletionService}=require('../../dist/server/modules/crm/crm-deletion.service');
const {CrmDeletionController}=require('../../dist/server/modules/crm/crm-deletion.controller');
const {followupChains}=require('../../dist/shared/crm-followup-chain');
const links=ids=>({link_record_ids:ids});
const normalize=data=>Object.fromEntries(Object.entries(data).map(([key,value])=>[key,['所属企业','关联项目','直接客户','上次跟进','客户联系人'].includes(key)&&Array.isArray(value)?links(value):value]));
const record=(id,data)=>({id,record:{修改时间:1,...normalize(data)}});
const follow=(id,project='recP',previous=[],extra={})=>record(id,{关联项目:[project],跟进归属:'项目跟进',上次跟进:previous,记录状态:'正常',后续安排:'有下一步行动',实际发生时间:Date.now()-100000+Number(id.slice(-1)||0),建议日期:Date.now(),...extra});
function source(){return {customer:[record('recC',{企业全称:'客户一'}),record('recOther',{企业全称:'客户二'})],
 project:[record('recP',{项目名称:'项目一',所属企业:['recC']}),record('recQ',{项目名称:'项目二',所属企业:['recOther']})],
 contact:[record('recContact',{姓名:'联系人',所属企业:['recC']})],
 followup:[follow('recF1'),follow('recF2','recP',['recF1']),follow('recF3','recP',['recF2']),follow('recOtherF','recQ'),record('recDirect',{直接客户:['recC'],跟进归属:'客户直接跟进',记录状态:'正常'})]};}
function harness(kind='customer',id='recC'){
 const data=source();const plan=deletionPlan(data,kind,id);const row={id:'12345678-1234-1234-1234-123456789abc',status:'preview',payload:plan,createdAt:new Date()};const calls=[];
 const db={select:()=>({from:()=>({where:()=>({limit:async()=>[]})})}),update:()=>({set:patch=>({where:async()=>{Object.assign(row,patch);}})})};
 let fail=false;
 const cap={load:kind=>({call:async(action,input)=>{const key=kind.replace('crm-','');calls.push({key,action,input});if(action==='deleteRecords'){data[key]=data[key].filter(item=>!input.recordIDs.includes(item.id));if(fail){fail=false;throw Error('response lost');}}else{for(const update of input.records)Object.assign(data[key].find(item=>item.id===update.id).record,normalize(update.record));}return {success:true};}})};
 const svc=new CrmDeletionService(db,{get:async(kind,id)=>structuredClone(data[kind].find(item=>item.id===id))},cap);
 svc.source=async()=>structuredClone(data);svc.job=async()=>structuredClone(row);svc.exclusive=async fn=>fn();
 return {svc,data,plan,row,calls,failOnce:()=>{fail=true;}};
}
test('customer cascade includes contacts and direct/project followups without touching another customer',()=>{
 const plan=deletionPlan(source(),'customer','recC');assert.deepEqual(deletionView('id',plan,'preview').counts,{customer:1,project:1,contact:1,followup:4});
 assert.equal(plan.items.at(-1).kind,'customer');assert.ok(!plan.items.some(item=>['recQ','recOther','recOtherF'].includes(item.id)));
 const p=deletionPlan(source(),'project','recP');assert.deepEqual(deletionView('id',p,'preview').counts,{customer:0,project:1,contact:0,followup:3});
});
test('middle followup reconnects next record, deleting latest preserves previous completion',()=>{
 const data=source();const middle=deletionPlan(data,'followup','recF2');assert.deepEqual(middle.repairs,[{id:'recF3',before:['recF2'],after:['recF1']}]);assert.equal(middle.restoresPending,0);
 const last=deletionPlan(data,'followup','recF3');assert.equal(last.restoresPending,0);assert.deepEqual(last.acknowledgements,[{id:"recF2",childId:"recF3"}]);assert.equal(last.items.length,1);
 const first=deletionPlan(data,'followup','recF1');assert.deepEqual(first.repairs[0].after,[]);
});
test('ambiguous ownership and unrelated contact references stop deletion planning',()=>{
 let data=source();data.project[0].record.所属企业=links(['recC','recOther']);assert.throws(()=>deletionPlan(data,'customer','recC'),/多个客户/);
 data=source();data.followup[3].record.客户联系人=links(['recContact']);assert.throws(()=>deletionPlan(data,'customer','recC'),/其他客户/);
});
test('cascade executes leaves first, preserves unrelated data, and completed retry does not write',async()=>{
 const h=harness();let state;do{state=await h.svc.step(h.row.id);}while(state.status!=='complete');
 assert.deepEqual(h.calls.map(call=>call.key),['followup','contact','project','customer']);assert.equal(state.deleted,7);
 assert.deepEqual(h.data.customer.map(row=>row.id),['recOther']);assert.deepEqual(h.data.followup.map(row=>row.id),['recOtherF']);
 const count=h.calls.length;await h.svc.step(h.row.id);assert.equal(h.calls.length,count);
});
test('lost deletion response is recovered from durable plan and actual remaining records without deleting twice',async()=>{
 const h=harness();h.failOnce();const paused=await h.svc.step(h.row.id);assert.equal(paused.status,'paused');assert.equal(paused.deleted,4);
 let state;do{state=await h.svc.step(h.row.id);}while(state.status!=='complete');
 assert.equal(h.calls.filter(call=>call.key==='followup').length,1);assert.equal(state.deleted,7);
});
test('single record deletion rewires before deleting and preserves followup acknowledgement',async()=>{
 const h=harness('followup','recF2');const result=await h.svc.step(h.row.id);assert.equal(result.status,'complete');
 assert.deepEqual(h.calls.map(call=>call.action),['batchUpdateRecords','batchUpdateRecords','deleteRecords']);
 assert.deepEqual(h.data.followup.find(row=>row.id==='recF3').record.上次跟进,links(['recF1']));
 assert.equal(followupChains(h.data.followup).find(row=>row.id==='recF1').followup.state,'已跟进');
});

test('deleting the latest continuation keeps its parent completed across reads and retries',async()=>{
 const h=harness('followup','recF3');h.failOnce();
 const paused=await h.svc.step(h.row.id);assert.equal(paused.status,'paused');
 assert.ok(!h.data.followup.some(row=>row.id==='recF3'));
 const state=()=>followupChains(structuredClone(h.data.followup)).find(row=>row.id==='recF2').followup;
 assert.equal(state().state,'已跟进');assert.deepEqual(state().nextIds,[]);
 assert.equal((await h.svc.step(h.row.id)).status,'complete');
 assert.equal(state().state,'已跟进');
 const {projectFollowupSummary}=require('../../dist/shared/crm-followup-chain');
 assert.equal(projectFollowupSummary(h.data.project,h.data.followup).find(row=>row.id==='recP').record.待跟进数量,0);
 assert.equal(h.calls.filter(call=>call.action==='deleteRecords').length,1);
});

test('failed completion acknowledgement stops deletion before removing the child',async()=>{
 const h=harness('followup','recF3');
 h.svc.crm.get=async()=>({id:'recF2',record:{管理记录:''}});
 assert.equal((await h.svc.step(h.row.id)).status,'paused');
 assert.ok(h.data.followup.some(row=>row.id==='recF3'));
 assert.equal(h.calls.filter(call=>call.action==='deleteRecords').length,0);
});

test('deleting an invalid or void continuation does not mark its parent completed',()=>{
 const data=source();data.followup.find(row=>row.id==='recF3').record.记录状态='已作废';
 assert.deepEqual(deletionPlan(data,'followup','recF3').acknowledgements,[]);
});
test('changed data between preview and confirmation rejects all writes',async()=>{
 const h=harness();h.data.project[0].record.修改时间=2;await assert.rejects(()=>h.svc.step(h.row.id),/变化/);assert.equal(h.calls.length,0);assert.equal(h.row.status,'preview');
});
test('new or moved related data during a cascade pauses before deleting remaining parents',async()=>{
 const h=harness();await h.svc.step(h.row.id);h.data.followup.push(follow('recNew'));
 const result=await h.svc.step(h.row.id);assert.equal(result.status,'paused');assert.equal(h.data.customer.length,2);assert.equal(h.data.project.length,2);
 const moved=harness();await moved.svc.step(moved.row.id);moved.data.project[0].record.所属企业=links(['recOther']);
 assert.equal((await moved.svc.step(moved.row.id)).status,'paused');assert.equal(moved.data.project.length,2);
});
test('failed complete-data read never starts deletion',async()=>{
 const h=harness();h.svc.source=async()=>{throw Error('incomplete page');};await assert.rejects(()=>h.svc.step(h.row.id),/incomplete/);assert.equal(h.calls.length,0);
});
test('all deletion endpoints reject ordinary employees before invoking services',()=>{
 const controller=new CrmDeletionController(new Proxy({},{get(){throw Error('must not call');}}));
 for(const roles of [undefined,[],['crm_employee']])for(const method of ['preview','step','inspect','pending'])
  assert.throws(()=>controller[method]({userContext:{userId:'123',roles}},{}),/管理员/);
});

test('mutation guard blocks affected records and new children while unrelated writes remain available',async()=>{
 const h=harness();const db={select:()=>({from:()=>({where:async()=>[{payload:h.plan}]})})};
 const svc=new CrmDeletionService(db,{},{});
 await assert.rejects(()=>svc.guardMutation({所属企业:['recC']}),/正在删除/);
 await assert.rejects(()=>svc.guardMutation({内容:'修改'},'recF1'),/正在删除/);
 await svc.guardMutation({所属企业:['recOther']});
});
test('database lock refuses concurrent mutations before performing work and permits the holder',async()=>{
 let entered=false;
 const db={transaction:async fn=>fn({execute:async()=>[{locked:false}]})};
 const svc=new CrmDeletionService(db,{},{});
 await assert.rejects(()=>svc.exclusive(async()=>{entered=true;}),/正在保存或删除/);assert.equal(entered,false);
 db.transaction=async fn=>fn({execute:async()=>[{locked:true}]});
 assert.equal(await svc.exclusive(async()=>42),42);
});
test('unconfirmed relationship repair does not proceed to destructive deletion',async()=>{
 const h=harness('followup','recF2');h.svc.crm.get=async()=>({id:'recF3',record:{上次跟进:links(['recUnexpected'])}});
 const result=await h.svc.step(h.row.id);assert.equal(result.status,'paused');assert.equal(h.calls.filter(call=>call.action==='deleteRecords').length,0);
 assert.ok(h.data.followup.some(row=>row.id==='recF2'));
});
