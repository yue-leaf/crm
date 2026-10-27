const { identityFixture } = require('./helpers/identity.cjs');
require('reflect-metadata');
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {CrmService}=require('../../dist/server/modules/crm/crm.service.js');
const {textValue}=require('../../dist/shared/crm.js');
const {recordReviewProblem}=require('../../dist/shared/crm-review.js');
const {editBlockedReason}=require('../../dist/shared/crm-edit.js');
const {historicalContext}=require('../../dist/server/modules/crm/crm-workflow.js');
const old=Date.parse('2026-10-20T10:00:00+08:00');
function fixture(kind, patch={}) {
 const customer={id:'recCustomer',record:{企业全称:'Example',行业:'其他化学制药',地区:'上海',客户负责人:[123],客户关系状态:'待建立',核查标记:'正常',已归档:false,修改时间:1}};
 const data={customer:customer.record,
  contact:{姓名:'Contact',职务:'Engineer',所属企业:{link_record_ids:['recCustomer']},电话:'123',维护人:[123],联系人状态:'有效'},
  project:{项目名称:'Project',项目类型:'PAT',所属企业:{link_record_ids:['recCustomer']},项目负责人:[123],'目标 / 需求摘要':'Goal',工作状态:'待启动',终局确认:'未确认',当前下一步行动:'Plan',下次跟进日期:old},
  followup:{跟进主题:'History',跟进归属:'客户直接跟进',直接客户:{link_record_ids:['recCustomer']},记录类型:'内部推进',实际发生时间:old,实际跟进人:[123],'内容 / 推进结论':'Done',后续安排:'无后续动作',无后续动作结论:'Done',记录状态:'正常'}};
 const row={id:kind==='customer'?'recCustomer':'recTarget',record:{...data[kind],核查标记:'待核查',修改时间:1,...patch}};
 const writes=[]; const directory=[{record:{飞书成员:[123,456]}}];
 const service=new CrmService({getCapability:()=>({formValue:{fields:[]}}),load:name=>({call:async(action,input)=>{
  if(action==='getRecord')return structuredClone(input.recordID===row.id?row:customer);
  if(action==='searchRecords')return {records:name==='crm-access'?directory:[],hasMore:false};
  assert.equal(action,'batchUpdateRecords');writes.push(input.records[0].record);Object.assign(row.record,input.records[0].record);return {records:[{id:row.id}]};
 }})}, identityFixture([123,456]));
 const update=(op,body)=>service.update(kind,row.id,op,{...body,expectedModifiedAt:1},'test');
 return {row,customer,writes,directory,service,update,review:()=>update('review',{核查说明:'Checked'})};
}
test('current quality checks reject invalid contact, followup and customer plan data',()=>{
 for(const [kind,patch] of [
 ['customer',{当前下一步行动:'Plan'}],['contact',{联系人状态:'未知'}],
 ['contact',{联系人状态:'停用',停用时间:old}],['contact',{联系人状态:'有效',停用原因:'stale'}],
 ['followup',{记录状态:'未知'}],['followup',{记录状态:'已作废'}]]) {
  const f=fixture(kind,patch);assert.ok(recordReviewProblem(kind,f.row.record));assert.equal(f.writes.length,0);
 }
});

test('formula SDK arrays render values and surface Base quality errors',async()=>{
 assert.equal(textValue({bizType:'Text',value:['关联错误；']}),'关联错误；');
 assert.equal(textValue({bizType:'Number',value:[0]}),'0');
 const f=fixture('customer',{数据检查:{bizType:'Text',value:['关联错误；']}});
 assert.match(recordReviewProblem('customer',f.row.record),/关联错误/);assert.equal(f.writes.length,0);
});
test('future contact disable timestamps cannot authorize external followups',async()=>{
 const f=fixture('contact',{核查标记:'正常',联系人状态:'停用',停用时间:Date.now()+3600000,停用原因:'Future'});
 await assert.rejects(()=>f.service.relationChecks('followup',{跟进归属:'客户直接跟进',直接客户:['recCustomer'],记录类型:'外部沟通','沟通 / 推进方式':'电话',客户联系人:['recTarget'],后续安排:'无后续动作',无后续动作结论:'Done'},{实际发生时间:old}),/停用/);
 assert.equal(f.writes.length,0);
});
test('adding synchronized participants preserves history but rejects unknown identities',async()=>{
 const f=fixture('followup');f.directory.splice(0,1,{record:{飞书成员:[123]}},{record:{飞书成员:[456]}});
 await f.update('edit',{changes:{实际跟进人:['123','456']},reason:'Add missing colleague'});
 assert.deepEqual(f.row.record.实际跟进人,[123,456]);
 await assert.rejects(()=>f.update('edit',{changes:{实际跟进人:['123','456','789']},reason:'Reject unregistered new colleague'}),/人员/);
});
test('cancelled projects cannot be edited directly and retired review does not write',async()=>{
 const f=fixture('project',{终局确认:'已取消',结束日期:old,结果说明:'Stopped',取消原因:'Stopped'});
 await assert.rejects(()=>f.update('edit',{changes:{项目名称:'Changed'}}),/已结束/);
 await assert.rejects(f.review,/不支持/);assert.equal(f.writes.length,0);
});

test('invalid project work state does not permit ordinary edits',()=>{
 const f=fixture('project',{工作状态:'未知'});assert.ok(editBlockedReason('project',f.row));
  f.row.record.核查标记='正常';assert.throws(()=>historicalContext('project',f.row,old),/工作状态/);
});
test('valid contact and void followup quality checks never mutate record state',()=>{
 for(const [kind,patch] of [['customer',{}],['contact',{联系人状态:'停用',停用时间:old,停用原因:'Left'}],['followup',{记录状态:'已作废',作废原因:'Duplicate'}]]) {
  const f=fixture(kind,patch);const before=structuredClone(f.row.record);
  assert.equal(recordReviewProblem(kind,f.row.record),'');assert.deepEqual(f.row.record,before);assert.equal(f.writes.length,0);
 }
});

test('cancelled project historical followup boundary is independent of retired customer archive metadata',async()=>{
 const f=fixture('project',{终局确认:'已取消',结束日期:old+86400000,结果说明:'Stopped',取消原因:'Stopped'});
 Object.assign(f.customer.record,{已归档:true,归档时间:old});
 assert.equal(recordReviewProblem('project',f.row.record),'');
 assert.doesNotThrow(()=>historicalContext('project',f.row,old+86400000));
 assert.throws(()=>historicalContext('project',f.row,old+2*86400000),/重开/);
});
