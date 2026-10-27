require('reflect-metadata');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { CrmService } = require('../../dist/server/modules/crm/crm.service.js');
const { historicalContext } = require('../../dist/server/modules/crm/crm-workflow.js');
const { projectFacts } = require('../../dist/shared/crm-dashboard.js');
const { workspaceModel } = require('../../dist/shared/crm-workspace.js');
const { lifecycleEvents, lifecycleBlocked, inactiveAt } = require('../../dist/shared/crm-lifecycle.js');
const { prepareLifecycle } = require('../../dist/server/modules/crm/crm-lifecycle.js');
const { projectStatusOptions } = require('../../dist/shared/crm-status.js');
const { projectReviewProblem, advancementBlocked } = require('../../dist/shared/crm-workflow.js');
const today = new Date(Date.now()+28800000).toISOString().slice(0,10);
const date = Date.parse(today+'T00:00:00+08:00');
const row = () => ({id:'recProject',record:{项目名称:'项目',所属企业:{link_record_ids:['recCustomer']},项目类型:'MRT',项目负责人:[123],
  '目标 / 需求摘要':'目标',工作状态:'进行中',终局确认:'未确认',当前进展:'沟通中',当前下一步行动:'联系客户',下次跟进日期:date,修改时间:1}});
const customer = {id:'recCustomer',record:{企业全称:'客户',已归档:false}};
function harness(initial=row()) {
  let current=structuredClone(initial); const writes=[];
  const service=new CrmService({getCapability:()=>({formValue:{fields:[]}})});
  service.get=async(kind)=>structuredClone(kind==='customer'?customer:current);
  service.people=async()=>{};
  service.call=async(kind,operation,input)=>{assert.equal(operation,'batchUpdateRecords');const update=input.records[0];writes.push(update.record);Object.assign(current.record,update.record);current.record.修改时间++;return {records:[{id:current.id}]};};
  return {service,writes,current:()=>current,update:input=>service.update('project',current.id,'status',{...input,expectedModifiedAt:current.record.修改时间},'123')};
}
const signed={项目状态:'已签合同',签约日期:today,当前进展:'合同已签，安排售后',当前下一步行动:'安装培训',下次跟进日期:today,行动执行人:['123']};
test('five states are exact and signing keeps editing, followups, tasks and monthly signature statistics active',async()=>{
 assert.deepEqual(projectStatusOptions,['待启动','进行中','暂停','已签合同','已取消']);
 const h=harness();await h.update(signed);const record=h.current();
 assert.equal(record.record.工作状态,'已签合同');assert.equal(record.record.终局确认,'未确认');assert.equal(record.record.签约日期,date);
 assert.equal(record.record.结束日期,undefined);assert.equal(advancementBlocked('project',record),'');assert.equal(projectReviewProblem(record.record),'');
 assert.doesNotThrow(()=>historicalContext('project',record,Date.now()));
 const f=projectFacts(record,Date.now());assert.equal(f.active,true);assert.equal(f.followup.key,'today');
 const {data}=workspaceModel({customer:[customer],project:[record],followup:[]},'all','123');
 assert.equal(data.project.states.已签合同,1);assert.equal(data.project.monthCompleted,1);assert.ok(data.tasks.some(t=>t.id===record.id));
});
test('cancellation and reopening through the same entry preserve lifecycle audit and inactive boundaries',async()=>{
 const h=harness();await h.update(signed);
 await h.update({项目状态:'已取消',结束日期:today,取消原因:'客户取消'});
 assert.equal(h.current().record.终局确认,'已取消');assert.equal(projectFacts(h.current(),Date.now()).active,false);
 assert.equal(lifecycleEvents(h.current().record).at(-1).operation,'confirm-end');
 await h.update(signed);assert.equal(h.current().record.终局确认,'未确认');
 const events=lifecycleEvents(h.current().record);assert.equal(events.at(-1).operation,'reopen');assert.equal(events.at(-1).previous.terminal,'已取消');
 assert.equal(h.current().record.取消原因,'');
 await h.update({项目状态:'暂停',当前进展:'等客户排期',暂停原因:'客户延期'});assert.equal(h.current().record.工作状态,'暂停');
 await h.update({...signed,项目状态:'待启动'});assert.equal(h.current().record.暂停原因,'');
});
test('invalid states, incomplete conditional fields, stale writes and archived status updates never write',async()=>{
 for(const input of [{...signed,项目状态:'已完成'},{...signed,签约日期:'2099-01-01'},{...signed,签约日期:''},{项目状态:'已取消',结束日期:today},
 {项目状态:'暂停',当前进展:'等待'}, {...signed,下次跟进日期:''}]){const h=harness();await assert.rejects(()=>h.update(input));assert.equal(h.writes.length,0);}
 const h=harness();await assert.rejects(()=>h.service.update('project','recProject','status',{...signed,expectedModifiedAt:0},'123'),/记录已变化/);assert.equal(h.writes.length,0);
 const archived=row();archived.record.已归档=true;const a=harness(archived);await assert.rejects(()=>a.update(signed),/取消归档/);assert.equal(a.writes.length,0);
});
test('signed projects can archive, but customers cannot archive while their signed projects still have after-sales work',async()=>{
 const h=harness();await h.update(signed);const p=h.current();assert.equal(lifecycleBlocked('project','archive',p),'');
 const c=structuredClone(customer);c.record.项目={link_record_ids:[p.id]};c.record.归档阻塞项目数=0;
 const context={get:async()=>p,people:async()=>{}};
 await assert.rejects(()=>prepareLifecycle('customer',c,'archive',{操作原因:'归档'},'123',context),/仍有未结束/);
 const archived=await prepareLifecycle('project',p,'archive',{操作原因:'售后已完成'},'123',context);
 Object.assign(p.record,archived.fields);assert.equal(projectFacts(p,Date.now()).followup.key,'none');assert.equal(projectReviewProblem(p.record),'');
 assert.doesNotThrow(()=>historicalContext('project',p,date));
 const result=await prepareLifecycle('customer',c,'archive',{操作原因:'合作结束'},'123',context);assert.equal(result.fields.已归档,true);
});

test('restoring a signed project cannot restart after-sales under an archived customer',async()=>{
 const h=harness();await h.update(signed);const p=h.current();Object.assign(p.record,{已归档:true,归档时间:Date.now()-1000,归档原因:'结束'});
 const archivedCustomer={...customer,record:{...customer.record,已归档:true}};
 await assert.rejects(()=>prepareLifecycle('project',p,'restore',{操作原因:'继续售后'},'123',{get:async()=>archivedCustomer,people:async()=>{}}),/先取消客户归档/);
 const result=await prepareLifecycle('project',p,'restore',{操作原因:'继续售后'},'123',{get:async()=>customer,people:async()=>{}});
 assert.equal(result.fields.已归档,false);assert.equal(result.related[0].row.id,customer.id);
});
