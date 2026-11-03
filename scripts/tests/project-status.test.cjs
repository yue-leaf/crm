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

test('project editor prefills five-state selection and saves profile plus status in one write without a plan', async () => {
 const {editFields,recordDraft}=require('../../dist/shared/crm-edit.js');
 const initial=row();delete initial.record.当前下一步行动;delete initial.record.下次跟进日期;
 const h=harness(initial);
 const fields=editFields('project');
 assert.deepEqual(fields.find(f=>f.key==='项目状态').options,projectStatusOptions);
 assert.equal(recordDraft(initial.record,fields).项目状态,'进行中');
 const edit=changes=>h.service.update('project','recProject','edit',{changes,expectedModifiedAt:h.current().record.修改时间},'123');
 await edit({项目名称:'新名称',项目状态:'已签合同',签约日期:today});
 assert.equal(h.writes.length,1);assert.equal(h.current().record.项目名称,'新名称');
 assert.equal(h.current().record.工作状态,'已签合同');assert.equal(h.current().record.终局确认,'未确认');
 assert.equal(Object.hasOwn(h.writes[0],'项目状态'),false);
 assert.equal(Object.hasOwn(h.writes[0],'下次跟进日期'),false);
 assert.equal(projectReviewProblem(h.current().record),'');
 await edit({项目状态:'暂停',暂停原因:'等待客户'});
 assert.equal(h.current().record.工作状态,'暂停');
 await edit({项目状态:'已取消',结束日期:today,取消原因:'客户取消'});
 assert.equal(h.current().record.终局确认,'已取消');
 assert.equal(recordDraft(h.current().record,fields).项目状态,'已取消');
 await edit({项目名称:'取消后修正资料'});
 assert.equal(h.current().record.终局确认,'已取消');
 await edit({项目状态:'待启动'});
 assert.equal(h.current().record.工作状态,'待启动');assert.equal(h.current().record.终局确认,'未确认');
 assert.equal(lifecycleEvents(h.current().record).at(-1).operation,'reopen');
 assert.equal(h.current().record.下次跟进日期,undefined);
 assert.equal(h.current().record.取消原因,'');
});

test('project edit rejects invalid conditional data and stale writes without partially changing profile',async()=>{
 for(const changes of [{项目状态:'未知'},{项目状态:'已签合同'}, {项目状态:'已签合同',签约日期:'2099-01-01'},
  {项目状态:'暂停'}, {项目状态:'已取消',结束日期:today}, {项目状态:'已取消',结束日期:'2099-01-01',取消原因:'取消'}]) {
  const h=harness();
  await assert.rejects(()=>h.service.update('project','recProject','edit',{
   changes:{项目名称:'不能部分保存',...changes},expectedModifiedAt:1},'123'));
  assert.equal(h.writes.length,0);assert.equal(h.current().record.项目名称,'项目');
 }
 const h=harness();await assert.rejects(()=>h.service.update('project','recProject','edit',{
  changes:{项目状态:'待启动'},expectedModifiedAt:0},'123'),/记录已变化/);
 assert.equal(h.writes.length,0);
});
test('five states are exact and signing keeps editing, followups, tasks and monthly signature statistics active',async()=>{
 assert.deepEqual(projectStatusOptions,['待启动','进行中','暂停','已签合同','已取消']);
 const h=harness();await h.update(signed);const record=h.current();
 assert.equal(record.record.工作状态,'已签合同');assert.equal(record.record.终局确认,'未确认');assert.equal(record.record.签约日期,date);
 assert.equal(record.record.结束日期,undefined);assert.equal(advancementBlocked('project',record),'');assert.equal(projectReviewProblem(record.record),'');
 assert.doesNotThrow(()=>historicalContext('project',record,Date.now()));
 const f=projectFacts(record,Date.now());assert.equal(f.active,true);assert.equal(f.followup.key,'today');
 const {data}=workspaceModel({customer:[customer],project:[record],followup:[]},'all','123');
 assert.equal(data.project.states.已签合同,1);assert.equal(data.project.monthCompleted,1);assert.equal(data.tasks.length,0);
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
test('invalid states, incomplete conditional fields, stale writes never write',async()=>{
 for(const input of [{...signed,项目状态:'已完成'},{...signed,签约日期:'2099-01-01'},{...signed,签约日期:''},{项目状态:'已取消',结束日期:today},
 {项目状态:'暂停',当前进展:'等待'}, {...signed,下次跟进日期:''}]){const h=harness();await assert.rejects(()=>h.update(input));assert.equal(h.writes.length,0);}
 const h=harness();await assert.rejects(()=>h.service.update('project','recProject','status',{...signed,expectedModifiedAt:0},'123'),/记录已变化/);assert.equal(h.writes.length,0);

});
