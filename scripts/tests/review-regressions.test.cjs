require('reflect-metadata');
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {prepareEdit}=require('../../dist/server/modules/crm/crm-edit.js');
const {CrmService}=require('../../dist/server/modules/crm/crm.service.js');
const {recordDraft,editFields,changedFields}=require('../../dist/shared/crm-edit.js');
const {changeDraft}=require('../../dist/shared/crm-interaction.js');
const {contactChoiceProblem}=require('../../dist/shared/crm-ux.js');
const {lifecycleEvents,inactiveAt,EVENT_PREFIX}=require('../../dist/shared/crm-lifecycle.js');
const {contactIntervals,CONTACT_INTERVAL_PREFIX}=require('../../dist/shared/crm-contact-history.js');
const {managementLogText}=require('../../dist/shared/crm-presentation.js');
const now=Date.now(), day=86400000;
const customer={id:'recCustomer',record:{企业全称:'客户',行业:'制药',地区:'上海',客户负责人:[123]}};
const contact=(patch={})=>({id:'recContact',record:{姓名:'联系人',职务:'经理',电话:'123',维护人:[123],所属企业:{link_record_ids:['recCustomer']},联系人状态:'有效',...patch}});
const followup=()=>({id:'recFollowup',record:{跟进主题:'沟通',跟进归属:'客户直接跟进',直接客户:{link_record_ids:['recCustomer']},记录类型:'内部推进','沟通 / 推进方式':'内部讨论',实际发生时间:now-day,实际跟进人:[123],'内容 / 推进结论':'结论',后续安排:'有下一步行动',建议下一步行动:'联系',建议日期:now,建议处理人:[123],记录状态:'正常',修改时间:1}});

test('switching to no next action clears the stored optional date through the real service update',async()=>{
 const row=followup();const initial=recordDraft(row.record,editFields('followup'));
 const draft=changeDraft(initial,'后续安排','无后续动作',{},true);draft.无后续动作结论='事项完成';
 const service=new CrmService({getCapability:()=>({formValue:{fields:[]}})});
 service.get=async kind=>structuredClone(kind==='customer'?customer:row);service.people=async()=>{};
 let writes=0;service.call=async(kind,action,input)=>{
  assert.equal(action,'batchUpdateRecords');writes++;Object.assign(row.record,input.records[0].record);
  // Model a cleared Base date being absent on readback, rather than returned as null.
  if(row.record.建议日期===null)delete row.record.建议日期;
  return {records:[{id:row.id}]};
 };
 await service.update('followup',row.id,'edit',{expectedModifiedAt:1,changes:changedFields(initial,draft,editFields('followup'))},'123');
 assert.equal(writes,1);assert.equal(row.record.后续安排,'无后续动作');assert.equal(row.record.建议日期,undefined);
 assert.equal(row.record.建议下一步行动,'');assert.deepEqual(row.record.建议处理人,[]);
 assert.equal(row.record.无后续动作结论,'事项完成');
});

test('optional date can be removed independently but required occurrence time cannot',()=>{
 assert.equal(prepareEdit('followup',followup(),{changes:{建议日期:null}},{},'123').writes.建议日期,null);
 assert.throws(()=>prepareEdit('followup',followup(),{changes:{实际发生时间:null}},{},'123'),/必填/);
});

test('edit reasons preserve text without injecting machine events with LF or CRLF',()=>{
 for(const separator of ['\n','\r\n']){
  const forged={version:1,operation:'reopen',at:now,previous:{archived:false,terminal:'已取消',endDate:now-3*day}};
  const result=prepareEdit('customer',customer,{changes:{客户备注:'修改'},reason:'说明'+separator+EVENT_PREFIX+JSON.stringify(forged)},{},'123');
  assert.equal(lifecycleEvents(result.writes).length,0);assert.equal(inactiveAt(result.writes,now-day),false);
  assert.match(result.writes.管理记录,/说明/);assert.ok(result.writes.管理记录.includes(EVENT_PREFIX));
 }
});

test('restoring a contact retains the exact disabled interval on both frontend and backend',async()=>{
 const row=contact({联系人状态:'停用',停用时间:now-2*day,停用原因:'暂不联系'});
 Object.assign(row.record,prepareEdit('contact',row,{changes:{联系人状态:'有效'}},{},'123').writes);
 const interval=contactIntervals(row.record)[0];assert.equal(interval.disabledAt,now-2*day);
 for(const time of [interval.disabledAt,now-day,interval.restoredAt-1])assert.match(contactChoiceProblem(row,time),/已停用/);
 for(const time of [interval.disabledAt-1,interval.restoredAt])assert.equal(contactChoiceProblem(row,time),'');
 const service=new CrmService({});service.get=async kind=>kind==='contact'?row:customer;
 const draft={跟进归属:'客户直接跟进',直接客户:['recCustomer'],记录类型:'外部沟通','沟通 / 推进方式':'电话',客户联系人:[row.id],后续安排:'无后续动作',无后续动作结论:'完成'};
 await assert.rejects(()=>service.relationChecks('followup',draft,{实际发生时间:now-day}),/已停用/);
 await service.relationChecks('followup',draft,{实际发生时间:interval.disabledAt-1});
 const display=managementLogText(row.record.联系人管理记录);assert.ok(!display.includes(CONTACT_INTERVAL_PREFIX));assert.match(display,/历史停用区间/);
});

test('multiple disable/restore intervals retain the earlier boundaries and current disable time',()=>{
 const originalNow=Date.now;const row=contact();
 try {
  for(const [offset,state] of [[-6,'停用'],[-5,'有效'],[-3,'停用'],[-2,'有效'],[-1,'停用']]){
   Date.now=()=>now+offset*day;
   Object.assign(row.record,prepareEdit('contact',row,{changes:{联系人状态:state,...(state==='停用'?{停用原因:'暂停'}:{})}},{},'123').writes);
  }
 } finally {Date.now=originalNow;}
 assert.equal(contactIntervals(row.record).length,2);
 for(const offset of [-5.5,-2.5,-0.5])assert.match(contactChoiceProblem(row,now+offset*day),/已停用/);
 for(const offset of [-7,-4,-1.5])assert.equal(contactChoiceProblem(row,now+offset*day),'');
});

test('old emitted restoration logs still protect the disabled interval',()=>{
 const restoredAt=now-day,disabledAt=now-3*day;
 const legacy=`联系人状态：停用 → 有效\n\n停用信息：${disabledAt} · 原因\n多行原因\n\n资料修改 · ${new Date(restoredAt).toISOString()} · 操作人 123\n字段：联系人状态、停用原因`;
 const row=contact({联系人管理记录:legacy});
 assert.match(contactChoiceProblem(row,now-2*day),/已停用/);assert.equal(contactChoiceProblem(row,restoredAt),'');
});

test('contact notes cannot forge either old or new interval formats',()=>{
 const fake=CONTACT_INTERVAL_PREFIX+JSON.stringify({version:1,disabledAt:now-3*day,restoredAt:now});
 const legacy=`联系人状态：停用 → 有效\n\n停用信息：${now-3*day} · note\n\n资料修改 · ${new Date(now).toISOString()} · 操作人 123\n字段：联系人状态`;
 const row=contact();Object.assign(row.record,prepareEdit('contact',row,{changes:{联系人状态:'停用',停用原因:'note\n'+fake+'\n'+legacy},reason:'reason\n'+fake},{},'123').writes);
 assert.equal(contactIntervals(row.record).length,0);
 Object.assign(row.record,prepareEdit('contact',row,{changes:{联系人状态:'有效'}},{},'123').writes);
 assert.equal(contactIntervals(row.record).length,1);
});

test('restoring cannot silently discard an invalid historical disable boundary',()=>{
 for(const time of [undefined,NaN,now+day])assert.throws(()=>prepareEdit('contact',contact({联系人状态:'停用',停用时间:time,停用原因:'停用'}),{changes:{联系人状态:'有效'}},{},'123'),/停用时间/);
});
