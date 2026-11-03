require('reflect-metadata');
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {CrmService}=require('../../dist/server/modules/crm/crm.service.js');
const body={跟进归属:'项目跟进',关联项目:['recProject'],记录类型:'内部推进',
 实际发生时间:'2026-10-20T10:00', '内容 / 推进结论':'已完成首次沟通',后续安排:'无后续动作',无后续动作结论:'已记录'};
function harness(patch={}, options={}) {
 const project={id:'recProject',record:{工作状态:'待启动',终局确认:'未确认',所属企业:{link_record_ids:['recCustomer']},修改时间:1,...patch}};
 const writes=[];let saved,projectReads=0;
 const service=new CrmService({getCapability:()=>({formValue:{fields:[]}})});
 service.logger={error:()=>{}};
 service.get=async(kind,id)=>{
  if(kind==='customer')return {id,record:{企业全称:'客户'}};
  if(kind==='project'){
   projectReads++;
   if(options.race && projectReads===3)project.record.工作状态='暂停';
   return structuredClone(project);
  }
  if(options.readFailure)throw new Error('read unavailable');
  return structuredClone(saved);
 };
 service.call=async(kind,action,input)=>{
  writes.push({kind,action,fields:structuredClone(input.records[0].record)});
  if(action==='batchAddRecords'){
   if(options.createFailure)throw new Error('create unavailable');
   saved={id:'recFollowup',record:{...input.records[0].record}};
   for(const key of ['关联项目','直接客户'])if(Array.isArray(saved.record[key]))saved.record[key]={link_record_ids:saved.record[key]};
   return {records:[{id:saved.id}]};
  }
  assert.equal(kind,'project');assert.ok(saved,'followup must be persisted first');
  if(options.updateFailure)throw new Error('project unavailable');
  if(!options.ignoreUpdate)Object.assign(project.record,input.records[0].record);
  return {records:[{id:project.id}]};
 };
 return {service,project,writes,create:(data=body)=>service.create('followup',data,undefined,'123')};
}
test('creating project followup starts pending project only after save, records actor, preserves plan',async()=>{
 const h=harness({当前下一步行动:'保留计划',下次跟进日期:123,行动执行人:[456]});
 const result=await h.create();assert.equal(result.id,'recFollowup');assert.equal(result.warning,undefined);
 assert.match(result.message,/进行中/);assert.equal(h.project.record.工作状态,'进行中');
 assert.equal(h.project.record.当前进展,body['内容 / 推进结论']);assert.equal(h.project.record.当前下一步行动,'保留计划');
 assert.equal(h.project.record.下次跟进日期,123);assert.deepEqual(h.project.record.行动执行人,[456]);
 assert.match(h.project.record.管理记录,/123/);assert.match(h.project.record.管理记录,/recFollowup/);
 assert.deepEqual(h.writes.map(w=>w.action),['batchAddRecords','batchUpdateRecords']);
});
test('existing progress remains and subsequent followups do not repeatedly start project',async()=>{
 const h=harness({当前进展:'已记录进展'});await h.create();await h.create();
 assert.equal(h.project.record.当前进展,'已记录进展');
 assert.equal(h.writes.filter(w=>w.kind==='project').length,1);
});
test('direct customer followups and non-pending project states do not auto-start',async()=>{
 const direct=harness();await direct.create({...body,跟进归属:'客户直接跟进',关联项目:[],直接客户:['recCustomer']});
 assert.equal(direct.project.record.工作状态,'待启动');assert.equal(direct.writes.length,1);
 for(const 工作状态 of ['进行中','暂停','已签合同']){
  const h=harness({工作状态});await h.create();assert.equal(h.writes.length,1);assert.equal(h.project.record.工作状态,工作状态);
 }
 const canceled=harness({终局确认:'已取消',结束日期:Date.parse('2026-10-21T00:00:00+08:00')});
 await canceled.create();assert.equal(canceled.project.record.终局确认,'已取消');assert.equal(canceled.writes.length,1);
});
test('create/readback failure never advances project',async()=>{
 for(const option of ['createFailure','readFailure']){
  const h=harness({}, {[option]:true});await assert.rejects(()=>h.create());
  assert.equal(h.project.record.工作状态,'待启动');assert.equal(h.writes.filter(w=>w.kind==='project').length,0);
 }
});
test('project failure or ignored update returns saved followup plus warning without a second create',async()=>{
 for(const option of ['updateFailure','ignoreUpdate']){
  const h=harness({}, {[option]:true});const result=await h.create();
  assert.equal(result.id,'recFollowup');assert.match(result.warning,/无需重复新增/);
  assert.equal(h.writes.filter(w=>w.action==='batchAddRecords').length,1);
  assert.equal(h.service.updating.size,0);
 }
});
test('concurrent project change or active edit lock is not overwritten',async()=>{
 const h=harness({}, {race:true});const result=await h.create();
 assert.ok(result.warning);assert.equal(h.project.record.工作状态,'暂停');assert.equal(h.writes.length,1);
 const locked=harness();locked.service.updating.add('project:recProject');
 const outcome=await locked.create();assert.ok(outcome.warning);assert.equal(locked.writes.length,1);
 assert.ok(locked.service.updating.has('project:recProject'));
});
