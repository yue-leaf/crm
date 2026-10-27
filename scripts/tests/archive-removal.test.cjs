require('reflect-metadata');
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs');
const {workspaceModel}=require('../../dist/shared/crm-workspace.js');
const {projectFacts}=require('../../dist/shared/crm-dashboard.js');
const {editBlockedReason,editFields}=require('../../dist/shared/crm-edit.js');
const {advancementBlocked,projectReviewProblem}=require('../../dist/shared/crm-workflow.js');
const {historicalContext}=require('../../dist/server/modules/crm/crm-workflow.js');
const {inactiveAt,EVENT_PREFIX}=require('../../dist/shared/crm-lifecycle.js');
const {statusInput}=require('../../dist/server/modules/crm/crm-status.js');
const {prepareLifecycle}=require('../../dist/server/modules/crm/crm-lifecycle.js');
const {CrmService}=require('../../dist/server/modules/crm/crm.service.js');
const now=Date.now(),today=new Date(now+28800000).toISOString().slice(0,10);
const project={id:'recP',record:{工作状态:'已签合同',终局确认:'未确认',签约日期:now-86400000,已归档:true,归档时间:now-86400000,归档原因:'历史',修改时间:1}};
const customer={id:'recC',record:{企业全称:'客户',已归档:true,创建时间:now-30*86400000}};
test('legacy archive flags no longer hide statistics, block editing or prevent current followups',()=>{
 assert.equal(editBlockedReason('project',project),'');assert.equal(editBlockedReason('customer',customer),'');assert.equal(advancementBlocked('project',project),'');
 assert.equal(projectReviewProblem(project.record),'');assert.doesNotThrow(()=>historicalContext('project',project,now));
 const {data}=workspaceModel({customer:[customer],project:[project],followup:[]},'all','123',now);
 assert.equal(data.project.states.已签合同,1);assert.equal(data.project.active,1);assert.equal(data.project.archived,undefined);assert.equal(data.tasks.length,2);assert.equal(data.counts.missing,2);
 assert.equal(projectFacts(project,now).followup.key,'unplanned');
 assert.equal(statusInput(project,{项目状态:'进行中',当前进展:'售后',当前下一步行动:'回访',下次跟进日期:today}).operation,'progress');
});
test('retired archive and restore requests are rejected without business writes',async()=>{
 for(const operation of ['archive','restore']){
  let writes=0;const service=new CrmService({});service.get=async()=>structuredClone(project);service.call=async()=>{writes++};
  await assert.rejects(()=>service.update('project',project.id,operation,{操作原因:'旧页面',expectedModifiedAt:1},'123'),/已移除/);
  assert.equal(writes,0);
 }
});
test('old archive intervals no longer restrict history while cancellation intervals remain protected',()=>{
 const day=Date.parse(today+'T00:00:00+08:00');
 const restore={version:1,operation:'restore',at:now,previous:{archived:true,archiveTime:now-20000,terminal:''}};
 assert.equal(inactiveAt({管理记录:EVENT_PREFIX+JSON.stringify(restore)},now-10000),false);
 const reopen={version:1,operation:'reopen',at:day,previous:{archived:false,terminal:'已取消',endDate:day-3*86400000}};
 assert.equal(inactiveAt({管理记录:EVENT_PREFIX+JSON.stringify(reopen)},day-86400000),true);
});
test('deployment and live capability definitions contain no archive fields or archive views',()=>{
 const blueprint=JSON.parse(fs.readFileSync('../deploy/blueprint.json','utf8'));
 const retired=['已归档','归档时间','归档原因','归档就绪','归档阻塞项目数'];
 for(const field of retired)assert.ok(!JSON.stringify(blueprint).includes(field),field);
 for(const kind of ['customer','project']){
  const meta=JSON.parse(fs.readFileSync(`server/capabilities/crm-${kind}.json`,'utf8'));
  assert.ok(meta.formValue.fields.every(f=>!retired.includes(f.name)));
 }
});
