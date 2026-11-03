require('reflect-metadata');
const {test}=require('node:test'), assert=require('node:assert/strict');
const {followupChains,projectFollowupSummary}=require('../../dist/shared/crm-followup-chain');
const {workspaceModel}=require('../../dist/shared/crm-workspace');
const {followupStatus}=require('../../dist/shared/crm-followup-status');
const {CrmService,MemoryFollowupWriteStore,CrmFollowupWrites}=require('../helpers/crm-service.cjs');
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
function harness(seed=[log('recFirst')],coordinator) {
  const rows=new Map(seed.map(row=>[row.id,structuredClone(row)]));
  const writes=[];const svc=new CrmService({getCapability:()=>({formValue:{fields:[]}})},undefined,undefined,coordinator);
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
test('explicitly ended, void, invalid and no-next-action logs never create pending reminders',()=>{
  for(const patch of [{后续处理:'已结束',管理记录:'结束跟进 · 2026-11-01T10:00:00Z · 123'},{记录状态:'已作废'},{数据检查:'异常'},
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
  const h=harness([log('recFirst',{后续处理:'已结束',管理记录:'结束跟进 · 2026-11-01T10:00:00Z · 123'})]);await assert.rejects(()=>h.svc.create('followup',body),/已处理/);
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
test('older records follow the same pending rules; dropdown is exact target and includes all records',async()=>{
  const seed=[log('recFirst',{后续处理:null}),...Array.from({length:65},(_,i)=>log('recF'+i)),log('recOther',{关联项目:{link_record_ids:['recOtherProject']}})];
  const h=harness(seed);assert.equal((await h.svc.pendingFollowups(customer.id,project.id)).records.length,66);
  await assert.rejects(()=>h.svc.update('followup','recFirst','activate-followup',{expectedModifiedAt:1},'123'),/不支持/);
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

test('editing automatic no-action endings activates reminders, explicit endings require resume, older records obey the same rules',async()=>{
  for (const stored of ['已结束','待跟进']) {
    const h=harness([log('recFirst',{后续安排:'无后续动作',后续处理:stored,无后续动作结论:'完成',建议下一步行动:'',建议日期:null})]);
    await h.svc.update('followup','recFirst','edit',{expectedModifiedAt:1,changes:{后续安排:'有下一步行动',建议下一步行动:'再联系',建议日期:'2026-11-03',无后续动作结论:null}},'123');
    assert.equal((await h.svc.detail('followup','recFirst')).followup.state,'待跟进');
    assert.equal((await h.svc.notificationTasks(now)).length,1);
  }
  const h=harness();
  await h.svc.update('followup','recFirst','end-followup',{expectedModifiedAt:1},'123');
  await h.svc.update('followup','recFirst','edit',{expectedModifiedAt:2,changes:{建议下一步行动:'修改建议'}},'123');
  assert.equal((await h.svc.detail('followup','recFirst')).followup.state,'已结束');
  await h.svc.update('followup','recFirst','resume-followup',{expectedModifiedAt:3},'123');
  assert.equal((await h.svc.detail('followup','recFirst')).followup.state,'待跟进');
  await assert.rejects(()=>h.svc.update('followup','recFirst','resume-followup',{expectedModifiedAt:4},'123'),/状态已变化/);
  const old=harness([log('recFirst',{后续处理:null,后续安排:'无后续动作',无后续动作结论:'完毕'})]);
  await old.svc.update('followup','recFirst','edit',{expectedModifiedAt:1,changes:{后续安排:'有下一步行动',建议下一步行动:'新建议',无后续动作结论:null}},'123');
  assert.equal((await old.svc.detail('followup','recFirst')).followup.state,'待跟进');
});

test('fixed continuation submission rejects loss of predecessor and switching direct-customer scope to a project',()=>{
  const {validateContinuationDraft}=require('../../dist/shared/crm-followup-target');
  const draft={跟进客户:['recCustomer'],关联项目:[],上次跟进:['recFirst']};
  assert.doesNotThrow(()=>validateContinuationDraft(draft,'recFirst','recCustomer'));
  for(const patch of [{关联项目:['recProject']},{上次跟进:[]},{跟进客户:['recOther']}])
    assert.throws(()=>validateContinuationDraft({...draft,...patch},'recFirst','recCustomer'),/已变化/);
  assert.doesNotThrow(()=>validateContinuationDraft({...draft,关联项目:['recProject']},'recFirst','recCustomer','recProject'));
});

const sibling=(h,store)=>{
  const other=new CrmService({getCapability:()=>({formValue:{fields:[]}})},undefined,undefined,new CrmFollowupWrites(store));
  other.get=h.svc.get;other.list=h.svc.list;other.call=h.svc.call;return other;
};
test('separate server instances serialize the same predecessor, including continuation versus end',async()=>{
  for(const mode of ['continue','end']) {
    const store=new MemoryFollowupWriteStore(),h=harness(undefined,new CrmFollowupWrites(store)),other=sibling(h,store);
    let release,started;const gate=new Promise(r=>release=r),entered=new Promise(r=>started=r),call=h.svc.call;
    h.svc.call=async(...args)=>{started();await gate;return call(...args)};
    const first=h.svc.create('followup',body);await entered;
    await assert.rejects(()=>mode==='continue'?other.create('followup',body):other.update('followup','recFirst','end-followup',{expectedModifiedAt:1},'456'),/正在保存/);
    release();await first;assert.equal(h.writes.length,1);
    await assert.rejects(()=>other.create('followup',body),/已处理/);
  }
});
test('completed durable claim rejects stale Base reads and allows another continuation only after the child is voided',async()=>{
  const store=new MemoryFollowupWriteStore(),h=harness(undefined,new CrmFollowupWrites(store));
  const saved=await h.svc.create('followup',body),other=sibling(h,store);
  const realList=other.list;
  other.list=async kind=>kind==='followup'?{records:[log('recFirst')],hasMore:false}:realList(kind);
  await assert.rejects(()=>other.create('followup',body),/已处理/);assert.equal(h.writes.length,1);
  other.list=realList;h.rows.get(saved.id).record.记录状态='已作废';
  await other.create('followup',body);assert.equal(h.writes.length,2);
});
test('lost create response remains fenced across instances and recovers from positive audit evidence without another insert',async()=>{
  const store=new MemoryFollowupWriteStore(),h=harness(undefined,new CrmFollowupWrites(store)),call=h.svc.call;
  h.svc.call=async(...args)=>{await call(...args);throw Error('connection lost')};
  await assert.rejects(()=>h.svc.create('followup',body),/connection lost/);
  assert.equal(store.rows.get('recFirst').phase,'uncertain');
  const other=sibling(h,store);other.call=call;
  await assert.rejects(()=>other.create('followup',body),/已找到记录/);
  await assert.rejects(()=>other.create('followup',body),/已处理/);
  assert.equal(h.writes.length,1);
});
test('unconfirmed writes never unlock from age or a negative read; validation failures do unlock',async()=>{
  const store=new MemoryFollowupWriteStore(),h=harness(undefined,new CrmFollowupWrites(store)),call=h.svc.call;
  await assert.rejects(()=>h.svc.create('followup',{...body,实际发生时间:'2026-10-01T01:00'}),/不能早于/);
  assert.equal(store.rows.get('recFirst').phase,'idle');
  h.svc.call=async()=>{throw Error('unknown outcome')};
  await assert.rejects(()=>h.svc.create('followup',body),/unknown outcome/);
  store.rows.get('recFirst').leaseUntil=new Date(0);
  const other=sibling(h,store);other.call=call;
  await assert.rejects(()=>other.create('followup',body),/待核验/);
  assert.equal(h.writes.length,0);assert.equal(store.rows.get('recFirst').phase,'uncertain');
});
test('an expired pre-write claim can be reclaimed, but the old worker cannot write or release the new claim',async()=>{
  const store=new MemoryFollowupWriteStore(),first=new CrmFollowupWrites(store),second=new CrmFollowupWrites(store);
  let permit1,release;const gate=new Promise(r=>release=r),evidence={findSaved:async()=>undefined,isVoided:async()=>false};
  const old=first.run('recX','continue',evidence,async p=>{permit1=p;await gate;await p.beforeWrite({});});
  while(!permit1)await new Promise(r=>setImmediate(r));
  store.rows.get('recX').leaseUntil=new Date(0);
  await second.run('recX','continue',evidence,async p=>{await p.beforeWrite({});p.created('recChild')});
  release();await assert.rejects(()=>old,/失效|未确认/);
  assert.equal(store.rows.get('recX').continuedId,'recChild');assert.equal(store.rows.get('recX').phase,'idle');
});
test('unknown edit result is reconciled by audit marker before a new continuation or update can proceed',async()=>{
  const store=new MemoryFollowupWriteStore(),h=harness(undefined,new CrmFollowupWrites(store)),call=h.svc.call;
  h.svc.call=async(...args)=>{await call(...args);throw Error('lost response')};
  await assert.rejects(()=>h.svc.update('followup','recFirst','end-followup',{expectedModifiedAt:1},'123'),/lost response/);
  const other=sibling(h,store);other.call=call;
  await assert.rejects(()=>other.create('followup',body),/已找到记录/);
  await assert.rejects(()=>other.create('followup',body),/已处理/);
  assert.equal(h.writes.length,1);
});

test('the actual continue form handler locks an empty project selection as well as the predecessor',()=>{
  const fs=require('node:fs'),ts=require('typescript'),vm=require('node:vm');
  const source=fs.readFileSync(require('node:path').resolve(__dirname,'../../client/src/pages/crm/CrmPage.tsx'),'utf8');
  const tree=ts.createSourceFile('CrmPage.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  let code;function walk(node){if(ts.isVariableDeclaration(node)&&node.name.getText(tree)==='set')code=`const ${node.getText(tree)};`;ts.forEachChild(node,walk)}walk(tree);
  const context={editor:{previousFollowupId:'recFirst',fixedCustomerId:'recCustomer'},FOLLOWUP_CUSTOMER:'跟进客户'};
  vm.createContext(context);vm.runInContext(ts.transpileModule(code+'\nglobalThis.change=set;',{
    compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,context);
  // All must return before reaching any state updater or relation loader.
  for(const key of ['上次跟进','关联项目','跟进客户'])assert.doesNotThrow(()=>context.change(key,['recOther']));
});
test('business history hides internal write markers but keeps the actual operation description',()=>{
  const {managementLogText}=require('../../dist/shared/crm-presentation');
  const output=managementLogText('结束跟进 · 2026-11-04T01:00:00.000Z · 123\n\n跟进保存标识 · 11111111-1111-4111-8111-111111111111');
  assert.match(output,/结束跟进/);assert.doesNotMatch(output,/保存标识|11111111/);
});

test('old and new rows share four business states across detail, project counts, workspace and personal reminders without rewriting data',async()=>{
  const rows=[log('recOld',{后续处理:null}),log('recNew'),log('recNone',{后续处理:null,后续安排:'无后续动作'}),
    log('recAutoEnd',{后续处理:'已结束',后续安排:'无后续动作'}),
    log('recEnd',{后续处理:'已结束',管理记录:'结束跟进 · 2026-11-01T10:00:00.000Z · 123'}),
    log('recParent',{后续处理:null}),log('recChild',{上次跟进:{link_record_ids:['recParent']},实际发生时间:due,后续安排:'无后续动作'})];
  const before=structuredClone(rows),chains=followupChains(rows,now),states=Object.fromEntries(chains.map(r=>[r.id,r.followup.state]));
  assert.deepEqual(states,{recOld:'待跟进',recNew:'待跟进',recNone:'无需跟进',recAutoEnd:'无需跟进',recEnd:'已结束',recParent:'已跟进',recChild:'无需跟进'});
  assert.equal(projectFollowupSummary([project],rows,now)[0].record.待跟进数量,2);
  assert.deepEqual(model(rows).data.tasks.map(r=>r.id).sort(),['recNew','recOld']);
  const notices=new CrmNotificationsService({}, {}, {}, {notificationTasks:async()=>model(rows).data.tasks});
  const digest=await notices.preview(now,'123');assert.equal(digest.todayCount,2);assert.match(digest.content,/record=recOld/);
  assert.deepEqual(rows,before);
});
test('older pending records can be ended and resumed without changing the project or another employee followup',async()=>{
  const h=harness([log('recFirst',{后续处理:null}),log('recOther',{后续处理:null,建议处理人:[456]})]);
  const untouched=structuredClone(h.rows.get('recOther'));
  await h.svc.update('followup','recFirst','end-followup',{expectedModifiedAt:1,结束跟进说明:'暂不需要'},'123');
  assert.equal((await h.svc.detail('followup','recFirst')).followup.state,'已结束');
  await h.svc.update('followup','recFirst','resume-followup',{expectedModifiedAt:2},'123');
  const restored=await h.svc.detail('followup','recFirst');
  assert.equal(restored.followup.state,'待跟进');assert.equal(restored.record.建议日期,due);assert.deepEqual(restored.record.建议处理人,[123]);
  assert.deepEqual(h.rows.get('recOther'),untouched);assert.equal(h.writes.length,2);
  assert.ok(h.writes.every(w=>w.id==='recFirst'));
});
