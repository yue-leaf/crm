require('reflect-metadata');
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {CrmService}=require('../../dist/server/modules/crm/crm.service.js');
const {CrmController}=require('../../dist/server/modules/crm/crm.controller.js');
const customer={id:'recCustomer',record:{企业全称:{text:'同名客户'},项目:{link_record_ids:['recStale']}}};
const project=(id,extra={})=>({id,record:{项目名称:{text:id},所属企业:{link_record_ids:[customer.id]},修改时间:1,...extra}});
const followup=(id,fields={})=>({id,record:{跟进主题:{text:id},实际发生时间:100,修改时间:1,核查标记:'正常',记录状态:'正常',...fields}});
const direct=(id,extra={})=>followup(id,{跟进归属:'客户直接跟进',直接客户:{link_record_ids:[customer.id]},...extra});
const linked=(id,p,extra={})=>followup(id,{跟进归属:'项目跟进',关联项目:{link_record_ids:[p]},...extra});
function service(projects,followups,{fail,projectPageSize=50}={}) {
  const calls=[];
  const instance=new CrmService({load:name=>({call:async(action,input)=>{
    calls.push({name,action,input});
    if(fail)return fail(name,action,input);
    if(action==='getRecord') {
      if(name==='crm-customer'&&input.recordID===customer.id)return customer;
      const p=projects.find(r=>r.id===input.recordID);if(p)return p;return {};
    }
    assert.equal(action,'searchRecords');assert.ok(input.filter);
    const all=name==='crm-project'?projects:followups;
    const checks=r=>input.filter.conditions.map(c=>r.record[c.fieldName]?.link_record_ids?.includes(c.value[0])||false);
    const rows=all.filter(r=>input.filter.conjunction==='or'?checks(r).some(Boolean):checks(r).every(Boolean));
    const size=name==='crm-project'?projectPageSize:50,offset=Number(input.pageToken||0),hasMore=offset+size<rows.length;
    return {records:structuredClone(rows.slice(offset,offset+size)),hasMore,...(hasMore?{pageToken:String(offset+size)}:{})};
  }})});
  return {s:instance,calls};
}
test('customer aggregates direct and every project followup, including archived/pending/void history',async()=>{
  const ps=[project('recFirst'),project('recLast',{已归档:true})];
  const fs=[direct('recDirect',{实际发生时间:300}),linked('recLinked','recLast',{核查标记:'待核查',记录状态:'已作废',实际发生时间:400}),linked('recFirstLog','recFirst',{实际发生时间:200}),linked('recForeign','recOther'),followup('recSimilar',{直接客户:{link_record_ids:['recCustomerOther']}})];
  const {s,calls}=service(ps,fs,{projectPageSize:1});const page=await s.relatedFollowups('customer',customer.id,{});
  assert.deepEqual(page.records.map(r=>r.id),['recLinked','recDirect','recFirstLog']);assert.equal(page.total,3);
  assert.equal(page.sources.recLinked.id,'recLast');assert.equal(page.sources.recDirect.kind,'customer');
  assert.ok(calls.some(c=>c.name==='crm-project'&&c.input.pageToken==='1'));
  assert.ok(!calls.some(c=>c.input.filter?.conditions.some(v=>v.value.includes('recStale'))));
});
test('customer has no projects yet still gets direct history; filters exclude other scopes',async()=>{
  const {s}=service([project('recProject')],[direct('recDirect'),linked('recProjectLog','recProject')]);
  assert.deepEqual((await s.relatedFollowups('customer',customer.id,{scope:'direct'})).records.map(r=>r.id),['recDirect']);
  assert.deepEqual((await s.relatedFollowups('customer',customer.id,{scope:'project'})).records.map(r=>r.id),['recProjectLog']);
  const empty=service([],[direct('recOnly')]).s;
  assert.equal((await empty.relatedFollowups('customer',customer.id,{})).total,1);
  assert.equal((await empty.relatedFollowups('customer',customer.id,{scope:'project'})).total,0);
});
test('project followups are scoped to exact project, with usable source labels',async()=>{
  const p=project('recOne');const {s}=service([p,project('recTwo')],[linked('recOneLog','recOne'),linked('recTwoLog','recTwo'),direct('recDirect')]);
  const page=await s.relatedFollowups('project',p.id,{});assert.deepEqual(page.records.map(r=>r.id),['recOneLog']);assert.equal(page.sources.recOneLog.name,'recOne');
  await assert.rejects(()=>s.relatedFollowups('project',p.id,{scope:'direct'}),/范围/);
});
test('loads all Base pages before timeline pagination and searches the full conclusion',async()=>{
  const fs=Array.from({length:61},(_,i)=>direct('recLog'+i,{实际发生时间:i,'内容 / 推进结论':{text:i===60?'完整结论关键词':'其他'}}));
  const {s}=service([],fs);const first=await s.relatedFollowups('customer',customer.id,{});
  assert.equal(first.total,61);assert.equal(first.records.length,30);assert.equal(first.records[0].id,'recLog60');
  const next=await s.relatedFollowups('customer',customer.id,{cursor:first.pageToken});assert.equal(next.records.length,30);
  const last=await s.relatedFollowups('customer',customer.id,{cursor:next.pageToken});assert.equal(last.records.length,1);assert.equal(last.hasMore,false);
  const search=await s.relatedFollowups('customer',customer.id,{search:'结论关键词'});assert.equal(search.total,1);assert.equal(search.records[0].id,'recLog60');
});
test('deduplicates across query chunks, never treating duplicates within a Base page as success',async()=>{
  const ps=Array.from({length:35},(_,i)=>project('recP'+i));
  const shared=linked('recShared',ps[0].id);shared.record.关联项目.link_record_ids.push(ps[34].id);
  const {s,calls}=service(ps,[shared]);const page=await s.relatedFollowups('customer',customer.id,{});assert.equal(page.total,1);
  assert.equal(calls.filter(c=>c.name==='crm-followup').length,2);
  const bad=service([],[],{fail:(n,a)=>a==='getRecord'?customer:n==='crm-project'?{records:[],hasMore:false}:{records:[direct('recSame'),direct('recSame')],hasMore:false}}).s;
  await assert.rejects(()=>bad.relatedFollowups('customer',customer.id,{}),/分页/);
});
test('new or modified followups invalidate continuation; cursors cannot cross customers or filters',async()=>{
  const fs=Array.from({length:35},(_,i)=>direct('recLog'+i));const {s}=service([],fs);
  const first=await s.relatedFollowups('customer',customer.id,{});fs[0].record.修改时间=2;
  await assert.rejects(()=>s.relatedFollowups('customer',customer.id,{cursor:first.pageToken}),/已变化/);
  await assert.rejects(()=>s.relatedFollowups('customer',customer.id,{scope:'direct',cursor:first.pageToken}),/已变化/);
});
test('customer projects includes ended and archived records, correct parents and pagination',async()=>{
  const ps=Array.from({length:32},(_,i)=>project('recP'+i,{已归档:i===31,终局确认:'已完成',修改时间:i}));
  ps.push(project('recForeign',{所属企业:{link_record_ids:['recOther']}}));
  const {s}=service(ps,[]);const first=await s.customerProjects(customer.id,{});assert.equal(first.total,32);assert.equal(first.records[0].id,'recP31');
  assert.equal((await s.customerProjects(customer.id,{cursor:first.pageToken})).records.length,2);
});
test('rejects invalid parent/query, upstream relationship mismatch and broken pagination',async()=>{
  const {s}=service([],[]);
  await assert.rejects(()=>s.relatedFollowups('customer','invalid',{}),/标识/);
  for(const query of [{scope:'__proto__'},{search:{}},{cursor:[]},{cursor:'offset:1'}])await assert.rejects(()=>s.relatedFollowups('customer',customer.id,query));
  for(const result of [{records:[],hasMore:true},{records:[],hasMore:true,pageToken:'same'},{records:[direct('recWrong',{直接客户:{link_record_ids:['recForeign']}})],hasMore:false}]) {
    const bad=service([],[],{fail:(n,a)=>a==='getRecord'?customer:n==='crm-project'?{records:[],hasMore:false}:result}).s;
    await assert.rejects(()=>bad.relatedFollowups('customer',customer.id,{}),/分页|筛选/);
  }
});
test('bounded reads explicitly fail instead of returning incomplete followup history',async()=>{
  let pages=0;const {s}=service([],[],{fail:(n,a)=>a==='getRecord'?customer:n==='crm-project'?{records:[],hasMore:false}:{records:[],hasMore:true,pageToken:String(++pages)}});
  await assert.rejects(()=>s.relatedFollowups('customer',customer.id,{}),/超出.*未返回不完整/);assert.equal(pages,99);
});
test('related routes require login and admit tenant members without assigned roles',async()=>{
  const {s}=service([],[]);const controller=new CrmController(s);
  for(const method of ['customerProjects','customerFollowups','projectFollowups']) {
    assert.throws(()=>controller[method]({},customer.id,{}),e=>e.getStatus()===403);
    assert.throws(()=>controller[method]({userContext:{roles:[]}},customer.id,{}),e=>e.getStatus()===403);
  }
  for(const role of [undefined,'crm_employee','crm_admin']) {
    const req={userContext:{userId:'123',roles:role?[role]:undefined}};
    await controller.customerProjects(req,customer.id,{});await controller.customerFollowups(req,customer.id,{});
  }
});
