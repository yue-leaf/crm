require('reflect-metadata');
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {CrmService}=require('../../dist/server/modules/crm/crm.service.js');
const {projectFacts,projectMatches,buildProjectOverview}=require('../../dist/shared/crm-dashboard.js');
const now=Date.now();
const row=(id,extra={})=>({id,record:{项目名称:id,项目负责人:[123],所属企业:{link_record_ids:['recCustomer']},终局确认:'未确认',工作状态:'进行中',已归档:false,...extra}});
test('全部项目返回在办、结束和归档记录，工作台仍单独统计归档',async()=>{
 const records=[row('recActive'),row('recCompleted',{终局确认:'已完成',结束日期:now}),row('recCancelled',{终局确认:'已取消',结束日期:now}),row('recArchive',{已归档:true,工作状态:'已签合同',签约日期:now})];
 const service=new CrmService({load:()=>({call:async()=>({records,hasMore:false})})});
 const list=await service.projectList('all','all',undefined,'','123');
 assert.equal(list.total,4);assert.ok(list.records.some(r=>r.id==='recArchive'));
 assert.deepEqual(list.records.find(r=>r.id==='recActive').record.所属企业.link_record_ids,['recCustomer']);
 assert.equal((await service.projectList('all','all',undefined,'recArchive','123')).total,1);
 assert.equal(projectMatches(records[3],'active',now),true);
 assert.equal(buildProjectOverview(records,'all','123',now).total,4);
 assert.equal(buildProjectOverview(records,'all','123',now).archived,undefined);
});
test('单个工作状态展示采用终局结果，不把完成或取消显示成进行中',()=>{
 assert.equal(projectFacts(row('recCompleted',{终局确认:'已完成'}),now).state,'已签合同');
 assert.equal(projectFacts(row('recCancelled',{终局确认:'已取消'}),now).state,'已取消');
 assert.equal(projectFacts(row('recPaused',{工作状态:'暂停'}),now).state,'暂停');
});
