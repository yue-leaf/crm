require('reflect-metadata');
const {test}=require('node:test'), assert=require('node:assert/strict');
const {followupChains,projectFollowupSummary}=require('../../dist/shared/crm-followup-chain');
const {workspaceModel}=require('../../dist/shared/crm-workspace');
const {followupStatus}=require('../../dist/shared/crm-followup-status');
const {CrmService}=require('../../dist/server/modules/crm/crm.service');
const {CrmController}=require('../../dist/server/modules/crm/crm.controller');
const {CrmNotificationsService}=require('../../dist/server/modules/crm/crm-notifications.service');
const now=Date.parse('2026-11-02T10:00:00+08:00'), due=Date.parse('2026-11-02T00:00:00+08:00');
const customer={id:'recCustomer',record:{企业全称:'客户',创建时间:due-86400000,客户负责人:[999]}};
const project={id:'recProject',record:{项目名称:'项目',工作状态:'已签合同',终局确认:'未确认',所属企业:{link_record_ids:[customer.id]},项目负责人:[999],修改时间:1}};
const log=(id,extra={})=>({id,record:{跟进归属:'项目跟进',关联项目:{link_record_ids:[project.id]},实际发生时间:due-86400000,
  记录类型:'内部推进',记录状态:'正常',后续安排:'有下一步行动',后续处理:'待跟进',建议下一步行动:'确认实验',建议日期:due,
  建议处理人:[123],'内容 / 推进结论':'已沟通',附件:[{name:'原始文件.txt',size:12,type:'text/plain',tmpUrl:'https://example.com/file'}],修改时间:1,...extra}});
const model=(rows,scope='all',user='123')=>workspaceModel({customer:[customer],project:[project],followup:rows},scope,user,now);
const body={跟进归属:'项目跟进',关联项目:[project.id],记录类型:'内部推进',实际发生时间:'2026-11-02T08:30',
  '内容 / 推进结论':'对方尚未回复',后续安排:'有下一步行动',建议下一步行动:'再次联系',建议日期:'2026-11-03',上次跟进:['recFirst']};
function harness(seed=[log('recFirst')]) {
  const rows=new Map(seed.map(row=>[row.id,structuredClone(row)]));
  const writes=[];const svc=new CrmService({getCapability:()=>({formValue:{fields:[]}})});
  svc.list=async kind=>({records:kind==='followup'?[...rows.values()].map(r=>structuredClone(r)):kind==='project'?[structuredClone(project)]:[structuredClone(customer)],hasMore:false});
  svc.get=async(kind,id)=>{
    const r=kind==='followup'?rows.get(id):kind==='project'?project:customer;
    if(!r)throw new Error('not found');return structuredClone(r);
  };
  svc.call=async(kind,action,input)=>{
    assert.equal(kind,'followup');const write=input.records[0],id=write.id||`recNew${writes.length}`;
    writes.push({action,id,fields:structuredClone(write.record)});
    const fields=structuredClone(write.record);
    for(const key of ['上次跟进','关联项目','直接客户','客户联系人'])if(Array.isArray(fields[key]))fields[key]={link_record_ids:fields[key]};
    const previous=rows.get(id)?.record||{};rows.set(id,{id,record:{...previous,...fields,修改时间:Number(previous.修改时间||0)+1}});
    return {records:[{id}]};
  };
  return {svc,rows,writes};
}
test('parallel followups in one project keep separate owners and deadlines; only chosen predecessor closes',()=>{
  const first=log('recFirst'),other=log('recOther',{建议处理人:[456],建议日期:due-86400000});
  const next=log('recNext',{上次跟进:{link_record_ids:[first.id]},实际发生时间:due,建议日期:due+86400000});
  const m=model([first,other,next]);assert.deepEqual(m.data.tasks.map(row=>row.id),['recOther','recNext']);
  assert.equal(m.records.followup.find(row=>row.id===first.id).followup.state,'已跟进');
  assert.deepEqual(model([first,other,next],'mine').data.tasks.map(row=>row.id),['recNext']);
  assert.ok(model([first,other,next],'mine').records.project.some(row=>row.id===project.id));
  const summary=projectFollowupSummary([project],[first,other,next],now)[0];
  assert.equal(summary.record.待跟进数量,2);assert.equal(summary.record.逾期跟进数量,1);
  assert.equal(summary.record.最近待跟进日期,due-86400000);assert.equal(followupStatus(summary.record,now).key,'overdue');
});
test('history, ended, void, invalid and no-next-action logs never create pending reminders',()=>{
  for(const patch of [{后续处理:null},{后续处理:'已结束'},{记录状态:'已作废'},{数据检查:'异常'},
    {后续安排:'无后续动作'},{实际发生时间:now+1}])assert.equal(model([log('recLog',patch)]).data.tasks.length,0);
  const pending=log('recUndated',{建议日期:null,建议处理人:[]});
  assert.equal(model([pending]).data.counts.missing,1);assert.equal(model([pending],'mine').data.tasks.length,0);
  const p=projectFollowupSummary([project],[pending],now)[0];assert.equal(followupStatus(p.record,now).key,'unplanned');
  assert.equal(followupStatus(projectFollowupSummary([project],[],now)[0].record,now).key,'none');
});
test('voided, unrelated or backdated child cannot silently dismiss another reminder',()=>{
  const parent=log('recFirst');
  for(const patch of [{记录状态:'已作废'},{关联项目:{link_record_ids:['recOther']}},{实际发生时间:due-2*86400000}]){
    const child=log('recChild',{上次跟进:{link_record_ids:[parent.id]},...patch});
    assert.equal(followupChains([parent,child],now)[0].followup.state,'待跟进');
  }
});
test('continuation persists relation in one write, preserves original advice and attachment, rejects duplicate continuation',async()=>{
  const h=harness();const original=structuredClone(h.rows.get('recFirst'));
  const saved=await h.svc.create('followup',body,undefined,'123');
  assert.equal(h.writes.length,1);assert.equal(h.writes[0].fields.后续处理,'待跟进');
  assert.deepEqual(h.rows.get('recFirst'),original);assert.deepEqual(h.writes[0].fields.上次跟进,['recFirst']);
  const detail=await h.svc.detail('followup','recFirst');assert.equal(detail.followup.state,'已跟进');
  assert.deepEqual(detail.followup.nextIds,[saved.id]);
  await assert.rejects(()=>h.svc.create('followup',body,undefined,'123'),/已处理/);assert.equal(h.writes.length,1);
});
test('continuation rejects cross-target, earlier timestamps and stale ended state before any write',async()=>{
  for(const patch of [{实际发生时间:'2026-10-30T08:30'}, {关联项目:[],直接客户:[customer.id],跟进归属:'客户直接跟进'}]){
    const h=harness();await assert.rejects(()=>h.svc.create('followup',{...body,...patch}),/上次跟进|同一/);assert.equal(h.writes.length,0);
  }
  const h=harness([log('recFirst',{后续处理:'已结束'})]);await assert.rejects(()=>h.svc.create('followup',body),/已处理/);
});
test('overlapping continuation and end in one process cannot both pass the parent check',async()=>{
  const h=harness();let release;const gate=new Promise(r=>release=r);const call=h.svc.call;
  h.svc.call=async(...args)=>{await gate;return call(...args)};
  const create=h.svc.create('followup',body);
  await assert.rejects(()=>h.svc.update('followup','recFirst','end-followup',{expectedModifiedAt:1},'123'),/正在保存/);
  release();await create;assert.equal(h.writes.length,1);
});
test('save failure does not mark predecessor processed; explicit end preserves history and rejects stale revision',async()=>{
  const failed=harness();failed.svc.call=async()=>{throw new Error('failed')};
  await assert.rejects(()=>failed.svc.create('followup',body));assert.equal((await failed.svc.detail('followup','recFirst')).followup.state,'待跟进');
  const h=harness();const before=structuredClone(h.rows.get('recFirst').record);
  await assert.rejects(()=>h.svc.update('followup','recFirst','end-followup',{expectedModifiedAt:0},'123'),/已变化/);
  await h.svc.update('followup','recFirst','end-followup',{expectedModifiedAt:1,结束跟进说明:'无需继续'},'123');
  assert.equal((await h.svc.detail('followup','recFirst')).followup.state,'已结束');
  for(const key of ['附件','建议日期','建议下一步行动','内容 / 推进结论'])assert.deepEqual(h.rows.get('recFirst').record[key],before[key]);
  assert.equal((await h.svc.notificationTasks(now)).length,0);
});
test('historical reminders activate only explicitly; pending dropdown is exact target and includes all records',async()=>{
  const seed=[log('recFirst',{后续处理:null}),...Array.from({length:65},(_,i)=>log('recF'+i)),log('recOther',{关联项目:{link_record_ids:['recOtherProject']}})];
  const h=harness(seed);assert.equal((await h.svc.pendingFollowups(customer.id,project.id)).records.length,65);
  await h.svc.update('followup','recFirst','activate-followup',{expectedModifiedAt:1},'123');
  assert.equal((await h.svc.pendingFollowups(customer.id,project.id)).records.length,66);
  assert.equal((await h.svc.pendingFollowups(customer.id)).records.length,0);
  await assert.rejects(()=>h.svc.pendingFollowups('bad'),/标识/);
});
test('continuation with no subsequent action closes the chain without creating a reminder',async()=>{
  const h=harness();const {建议下一步行动,建议日期,...rest}=body;
  await h.svc.create('followup',{...rest,后续安排:'无后续动作',无后续动作结论:'沟通结束'});
  assert.equal((await h.svc.notificationTasks(now)).length,0);
});
test('notification preview isolates each assigned employee and excludes unassigned records',async()=>{
  const rows=[log('recA'),log('recB',{建议处理人:[456]}),log('recNoOwner',{建议处理人:[]})];
  const service=new CrmNotificationsService({}, {}, {}, {notificationTasks:async()=>model(rows).data.tasks});
  const first=await service.preview(now,'123'),second=await service.preview(now,'456'),none=await service.preview(now,'789');
  assert.equal(first.todayCount,1);assert.match(first.content,/record=recA/);assert.doesNotMatch(first.content,/record=recB|record=recNoOwner/);
  assert.equal(second.todayCount,1);assert.equal(none.todayCount,0);
});
test('pending route enforces login and detail uses enriched read path',async()=>{
  const h=harness(),controller=new CrmController(h.svc);
  assert.throws(()=>controller.pendingFollowups({},customer.id,project.id),/登录/);
  const request={userContext:{userId:'123'}};
  assert.equal((await controller.pendingFollowups(request,customer.id,project.id)).records.length,1);
  assert.equal((await controller.detail(request,'followup','recFirst')).followup.state,'待跟进');
});
test('project filters match every independent pending date rather than only the earliest date',()=>{
  const {projectMatches}=require('../../dist/shared/crm-dashboard');
  const summary=projectFollowupSummary([project],[log('recOverdue',{建议日期:due-86400000}),log('recToday'),
    log('recTomorrow',{建议日期:due+86400000}),log('recUndated',{建议日期:null})],now)[0];
  for(const filter of ['overdue','today','tomorrow','unplanned'])assert.equal(projectMatches(summary,filter,now),true);
  assert.equal(projectMatches(summary,'none',now),false);
});
test('pending feed resolves successors before search and paging, including successors on later pages',async()=>{
  const {CrmRelations}=require('../../dist/server/modules/crm/crm-relations');
  const rows=[log('recFirst',{'内容 / 推进结论':'匹配'}),...Array.from({length:55},(_,i)=>log('recF'+i)),
    log('recNext',{上次跟进:{link_record_ids:['recFirst']},实际发生时间:due,'内容 / 推进结论':'不同内容'})];
  const read=async(_,input)=>{
    const start=Number(input.pageToken||0),hasMore=start+50<rows.length;
    return {records:rows.slice(start,start+50),hasMore,...(hasMore?{pageToken:String(start+50)}:{})};
  };
  const all=await new CrmRelations(read).followups('project',project,{status:'pending'});
  assert.equal(all.total,56);assert.ok(!all.records.some(row=>row.id==='recFirst'));
  const searched=await new CrmRelations(read).followups('project',project,{status:'pending',search:'匹配'});
  assert.equal(searched.total,0);
  await assert.rejects(()=>new CrmRelations(read).followups('project',project,{status:'invalid'}),/筛选无效/);
});
test('direct clients cannot forge chain state or change predecessor while editing',async()=>{
  const h=harness();
  await assert.rejects(()=>h.svc.create('followup',{...body,后续处理:'已跟进'}),/不可修改/);
  await assert.rejects(()=>h.svc.update('followup','recFirst','edit',{expectedModifiedAt:1,changes:{上次跟进:['recFake']}},'123'),/不可修改/);
  assert.equal(h.writes.length,0);
});
test('continue UI loads current state, fixes customer/project/predecessor and never copies old attachments or conclusion',async()=>{
  const fs=require('node:fs'),ts=require('typescript'),vm=require('node:vm');
  const {relatedDraft,followupTarget}=require('../../dist/shared/crm-workflow');
  const source=fs.readFileSync(require('node:path').resolve(__dirname,'../../client/src/pages/crm/CrmPage.tsx'),'utf8');
  const tree=ts.createSourceFile('CrmPage.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  let code;function walk(node){if(ts.isVariableDeclaration(node)&&node.name.getText(tree)==='continueFollowup')code=`const ${node.getText(tree)};`;ts.forEachChild(node,walk)}walk(tree);
  const row={...log('recFirst'),followup:{state:'待跟进',nextIds:[]}},opened=[],notices=[];
  const context={savingRef:{current:false},uploadingRef:{current:false},editorRequestVersion:{current:0},
    api:{get:async kind=>kind==='followup'?row:project},followupTarget,relatedDraft,openEditor:(...args)=>opened.push(args),
    toast:{info:m=>notices.push(m),error:m=>notices.push(m)},message:e=>e.message};
  vm.createContext(context);vm.runInContext(ts.transpileModule(code+'\nglobalThis.run=continueFollowup;',{
    compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,context);
  await context.run(row);assert.equal(opened.length,1);const preset=JSON.parse(JSON.stringify(opened[0][3]));
  assert.deepEqual(preset.上次跟进,['recFirst']);assert.deepEqual(preset.跟进客户,[customer.id]);assert.deepEqual(preset.关联项目,[project.id]);
  assert.equal(preset.附件,undefined);assert.equal(preset['内容 / 推进结论'],undefined);
  row.followup.state='已跟进';await context.run(row);assert.equal(opened.length,1);assert.equal(notices.length,1);
});
