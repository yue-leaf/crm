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
test('按所属客户和项目名称组合筛选，在分页之前匹配客户记录 ID',async()=>{
 const projects=Array.from({length:51},(_,i)=>row('recOther'+i,{项目名称:'同名项目'}));
 projects.push(row('recMatch',{项目名称:'同名项目',所属企业:{link_record_ids:['recSelected']}}));
 projects.push(row('recOtherName',{项目名称:'另一项目',所属企业:{link_record_ids:['recSelected']}}));
 const service=new CrmService({});
 service.allBusiness=async kind=>kind==='project'?projects:[];
 const result=await service.projectList('all','all','','同名','123','all','recSelected');
 assert.deepEqual(result.records.map(project=>project.id),['recMatch']);
 assert.equal(result.total,1);assert.equal(result.hasMore,false);
 const selected=await service.projectList('all','all','','','123','all','','recMatch');
 assert.deepEqual(selected.records.map(item=>item.id),['recMatch']);
 const mismatch=await service.projectList('all','all','','','123','all','recCustomer','recMatch');
 assert.equal(mismatch.total,0);
});
