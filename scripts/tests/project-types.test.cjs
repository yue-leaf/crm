const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
require('reflect-metadata');
const {forms}=require('../../dist/shared/crm.js');
const {parseDraft}=require('../../dist/server/modules/crm/crm-validation.js');
const {prepareEdit}=require('../../dist/server/modules/crm/crm-edit.js');
const {CrmService}=require('../../dist/server/modules/crm/crm.service.js');
const expected=['MRT','PAT','automation'];
const field=forms.project.find(f=>f.key==='项目类型');
test('project type choices are exactly MRT, PAT and lowercase automation',()=>{
 assert.deepEqual(field.options,expected);
 for(const value of expected)assert.equal(parseDraft({项目类型:value},[field],{}).fields.项目类型,value);
 for(const value of ['AUTOMATION','mrt','销售机会','技术验证','合作推进','服务支持','其他'])
  assert.throws(()=>parseDraft({项目类型:value},[field],{}),/选项无效/);
});
test('stale plugin enum metadata cannot reintroduce retired project types',()=>{
 const service=new CrmService({getCapability:()=>({formValue:{fields:[{name:'项目类型',enumValues:['销售机会']}]}})});
 assert.deepEqual(service.enums('project').项目类型,expected);
});
test('editing a project type preserves its customer, history and existing monetary values',()=>{
 const row={id:'r1',record:{项目名称:'Project',项目类型:'MRT',所属企业:{link_record_ids:['recCustomer']},项目负责人:['123'],
 '目标 / 需求摘要':'Goal',工作状态:'待启动',终局确认:'未确认',当前下一步行动:'Plan',下次跟进日期:Date.parse('2026-11-01T00:00:00+08:00'),
 预计金额:100,币种:'CNY',金额含税口径:'含税',管理记录:'Existing note'}};
 for(const value of ['PAT','automation']){
  const edit=prepareEdit('project',row,{changes:{项目类型:value},reason:'Update category'},{},'tester');
  assert.equal(edit.writes.项目类型,value);assert.equal(edit.draft.预计金额,100);
  assert.equal(Object.hasOwn(edit.writes,'预计金额'),false);assert.equal(Object.hasOwn(edit.writes,'所属企业'),false);
  assert.match(edit.writes.管理记录,/Existing note/);
  const service=new CrmService({});service.validateFacts('project',edit.draft,row);
 }
});
test('source deployment blueprint and data source use the same project type choices',()=>{
 const root=path.resolve(__dirname,'../..');
 const metadata=JSON.parse(fs.readFileSync(path.join(root,'server/capabilities/crm-project.json'),'utf8'));
 assert.deepEqual(metadata.formValue.fields.find(f=>f.name==='项目类型').enumValues,expected);
 const blueprint=JSON.parse(fs.readFileSync(path.join(root,'../deploy/blueprint.json'),'utf8'));
 assert.deepEqual(blueprint.schemas.project.fields.find(f=>f.name==='项目类型').options.map(o=>o.name),expected);
 const formula=blueprint.formulas.find(f=>f.table==='project'&&f.name==='数据检查').expression;
 for(const value of expected)assert.ok(formula.includes(`[项目类型]="${value}"`));
 assert.ok(!formula.includes('[项目类型]="销售机会"'));
});

