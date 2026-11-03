const {test}=require('node:test');
const assert=require('node:assert/strict');
const {FOLLOWUP_CUSTOMER,followupCreateFields,changeFollowupTarget,followupWriteDraft}=require('../../dist/shared/crm-followup-target.js');
const {relatedDraft}=require('../../dist/shared/crm-workflow.js');
const {requiredField,missingFields}=require('../../dist/shared/crm-interaction.js');
const {forms}=require('../../dist/shared/crm.js');
const {parseDraft}=require('../../dist/server/modules/crm/crm-validation.js');

test('客户跟进无需选择归属，提交时不会混入表单上下文字段',()=>{
 const draft=changeFollowupTarget({},FOLLOWUP_CUSTOMER,['recCustomer']);
 const payload=followupWriteDraft(draft);
 assert.equal(payload.跟进归属,'客户直接跟进');assert.deepEqual(payload.直接客户,['recCustomer']);
 assert.deepEqual(payload.关联项目,[]);assert.ok(!(FOLLOWUP_CUSTOMER in payload));
 assert.ok(!followupCreateFields.some(field=>field.key==='跟进归属'));
 assert.match(missingFields(followupCreateFields,{}).跟进客户,/选择客户/);
});

test('选项目后自动改记项目，清空项目仍保留客户且重选联系人',()=>{
 const customer=changeFollowupTarget({},FOLLOWUP_CUSTOMER,['recCustomer']);
 const project=changeFollowupTarget({...customer,客户联系人:['recContact']},'关联项目',['recProject']);
 const payload=followupWriteDraft(project);
 assert.equal(payload.跟进归属,'项目跟进');assert.deepEqual(payload.直接客户,[]);
 assert.deepEqual(payload.关联项目,['recProject']);assert.deepEqual(project.客户联系人,[]);
 const cleared=changeFollowupTarget(project,'关联项目',[]);
 assert.equal(cleared.跟进归属,'客户直接跟进');assert.deepEqual(cleared.直接客户,['recCustomer']);
 assert.deepEqual(cleared.跟进客户,['recCustomer']);
 assert.equal(requiredField(followupCreateFields.find(field=>field.key==='关联项目'),'followup','create',project).required,false);
});

test('更换客户清除旧项目和联系人，重选同一项保留当前草稿',()=>{
 const initial={跟进客户:['recOld'],关联项目:['recProject'],客户联系人:['recContact'],跟进归属:'项目跟进',直接客户:[]};
 assert.equal(changeFollowupTarget(initial,FOLLOWUP_CUSTOMER,['recOld']),initial);
 const next=changeFollowupTarget(initial,FOLLOWUP_CUSTOMER,['recNew']);
 assert.deepEqual(next.关联项目,[]);assert.deepEqual(next.客户联系人,[]);
 assert.deepEqual(followupWriteDraft(next).直接客户,['recNew']);
});

test('客户与项目入口正确预填，归属与历史时间自动处理后仍通过后端字段白名单',()=>{
 const customer=relatedDraft('customer',{id:'recCustomer',record:{}},'followup');
 const project=relatedDraft('project',{id:'recProject',record:{所属企业:{link_record_ids:['recCustomer']},已归档:true}},'followup');
 assert.deepEqual(customer.跟进客户,['recCustomer']);assert.deepEqual(project.跟进客户,['recCustomer']);
 assert.equal(project.实际发生时间,null);assert.equal(project.后续安排,'无后续动作');
 for(const context of [customer,project]){
  const payload=followupWriteDraft({...context,跟进主题:'测试',记录类型:'内部推进',实际发生时间:'2026-10-20T10:00',实际跟进人:['123'],后续安排:'无后续动作',无后续动作结论:'已沟通','内容 / 推进结论':'已沟通'});
  const parsed=parseDraft(payload,forms.followup,{});
  assert.equal(parsed.draft.跟进归属,payload.跟进归属);
 }
});
test('独立跟进可先选择项目，自动填充客户并保持项目跟进存储结构',()=>{
 const {projectFirstDraft}=require('../../dist/shared/crm-followup-target');
 const draft=projectFirstDraft({跟进主题:'沟通',客户联系人:['recOld']},{id:'recProject',record:{所属企业:{link_record_ids:['recCustomer']}}});
 assert.deepEqual(draft.跟进客户,['recCustomer']); assert.deepEqual(draft.关联项目,['recProject']);
 assert.deepEqual(draft.客户联系人,[]);assert.equal(draft.跟进主题,'沟通');
 const payload=followupWriteDraft(draft);assert.equal(payload.跟进归属,'项目跟进');assert.deepEqual(payload.直接客户,[]);
 assert.throws(()=>projectFirstDraft({}, {id:'recBad',record:{}}),/所属客户/);
 assert.throws(()=>projectFirstDraft({}, {id:'recBad',record:{所属企业:{link_record_ids:['recA','recB']}}}),/所属客户/);
});
