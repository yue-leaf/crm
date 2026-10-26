require('reflect-metadata');
const {test}=require('node:test'),assert=require('node:assert/strict');
const {buildProjectOverview,projectFacts,projectMatches,scopedProjects}=require('../../dist/shared/crm-dashboard.js');
const {CrmService}=require('../../dist/server/modules/crm/crm.service.js');
const {CrmController}=require('../../dist/server/modules/crm/crm.controller.js');
const now=Date.parse('2026-10-24T12:00:00+08:00'),date=s=>Date.parse(s+'T00:00:00+08:00');
const row=(id,patch={})=>({id:'rec'+id,record:{项目名称:id,项目负责人:[123],终局确认:'未确认',工作状态:'进行中',当前进展:'Working',核查标记:'正常',已归档:false,当前下一步行动:'Next',下次跟进日期:date('2026-10-25'),...patch}});
test('dashboard states exclude archived, terminal overrides work state, attention is a unique union',()=>{
 const rows=[row('Overdue',{下次跟进日期:date('2026-10-23')}),row('Missing',{当前下一步行动:'',数据检查:'缺少计划'}),row('Pending',{核查标记:'待核查'}),row('Paused',{工作状态:'暂停',暂停原因:'Wait',下次跟进日期:date('2026-10-20')}),row('Done',{终局确认:'已完成',结束日期:date('2026-10-01'),结果说明:'done'}),row('Archive',{已归档:true}),row('Unknown',{终局确认:'unknown'})];
 const out=buildProjectOverview(rows,'all','123',now);
 assert.equal(out.total,6);assert.equal(out.active,4);assert.equal(out.archived,1);assert.equal(out.monthCompleted,1);assert.equal(out.overdue,1);assert.equal(out.missingPlan,1);assert.equal(out.review,3);assert.equal(out.attention,4);assert.equal(out.unknown,1);
 assert.equal(out.states.已完成,1);assert.equal(out.projects[0].id,'recOverdue');
 for(const filter of ['active','attention','overdue','review','archived','month-completed'])assert.equal(rows.filter(r=>projectMatches(r,filter,now)).length,out[{'month-completed':'monthCompleted'}[filter]||filter]);
});
test('mine is based on actual owner ID and does not match collaborators or similar IDs',()=>{
 const rows=[row('Mine'),row('Other',{项目负责人:[1234],协同人员:[123]}),row('Text',{项目负责人:['123']}),row('None',{项目负责人:null})];
 assert.deepEqual(scopedProjects(rows,'mine','123').map(r=>r.id),['recMine','recText']);
 assert.equal(buildProjectOverview(rows,'mine','123',now).total,2);
});
test('Shanghai month and day boundaries, paused work and unknown statuses are classified safely',()=>{
 assert.equal(projectFacts(row('Today',{下次跟进日期:date('2026-10-24')}),now).overdue,false);
 assert.equal(projectFacts(row('NotReviewed',{核查标记:'待核查',下次跟进日期:date('2026-10-23')}),now).overdue,false);
 assert.equal(projectFacts(row('Future',{终局确认:'已完成',结束日期:date('2026-10-25')}),now).monthCompleted,false);
 assert.equal(projectFacts(row('Previous',{终局确认:'已完成',结束日期:date('2026-09-30')}),now).monthCompleted,false);
 assert.equal(projectFacts(row('BadDate',{下次跟进日期:NaN}),now).missingPlan,true);
 assert.equal(projectFacts(row('Overflow',{终局确认:'已完成',结束日期:-Number.MAX_VALUE,结果说明:'done'}),now).review,true);
 assert.equal(projectFacts(row('Overflow',{终局确认:'已完成',结束日期:-Number.MAX_VALUE,结果说明:'done'}),now).monthCompleted,false);
 assert.equal(buildProjectOverview([],'all','123',now).attention,0);
});
const serviceFor=pages=>new CrmService({load:()=>({call:async(action,input)=>{assert.equal(action,'searchRecords');return structuredClone(pages[input.pageToken||'first']);}})});
test('overview reads all project pages, and filtered results continue beyond the first page',async()=>{
 const first=Array.from({length:50},(_,i)=>row(String(i))),second=[row('Last')];
 const s=serviceFor({first:{records:first,hasMore:true,pageToken:'second'},second:{records:second,hasMore:false}});
 assert.equal((await s.overview('all','123')).total,51);
 const p=await s.projectList('all','all',undefined,'','123');assert.equal(p.records.length,50);assert.equal(p.hasMore,true);
 const last=await s.projectList('all','all',p.pageToken,'','123');assert.equal(last.records.length,1);assert.equal(last.hasMore,false);
 const search=await s.projectList('all','all',undefined,'Last','123');assert.equal(search.total,1);assert.equal(search.records[0].id,'recLast');
});
test('read limit never returns partial success for an oversized project dataset',async()=>{
 let calls=0;
 const s=new CrmService({load:()=>({call:async()=>({records:[],hasMore:true,pageToken:String(++calls)})})});
 await assert.rejects(()=>s.overview('all','123'),/读取范围/);assert.equal(calls,100);
});
test('incomplete, repeated or duplicated project pagination fails without partial totals',async()=>{
 for(const pages of [{first:{records:[row('A')],hasMore:true}},{first:{records:[],hasMore:true,pageToken:'first'}},{first:{records:[row('A'),row('A')],hasMore:false}}])await assert.rejects(()=>serviceFor(pages).overview('all','123'),/分页/);
});
test('invalid scopes, filters, cursor types and unauthorised dashboards are rejected',async()=>{
 const s=serviceFor({first:{records:[],hasMore:false}});
 await assert.rejects(()=>s.overview('other','123'),/范围/);
 await assert.rejects(()=>s.projectList('all','__proto__','','','123'),/筛选/);
 await assert.rejects(()=>s.projectList('all','all',{},'','123'),/分页/);
 const c=new CrmController(s);assert.throws(()=>c.overview({userContext:{roles:[]}},'all'),e=>e.getStatus()===403);
});
