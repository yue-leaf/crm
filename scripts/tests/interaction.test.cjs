const {test}=require('node:test');
const assert=require('node:assert/strict');
const {changeDraft,requiredField,missingFields,appendPage}=require('../../dist/shared/crm-interaction.js');

test('reselecting the same parent, including from search, preserves selected contacts',()=>{
 const before={直接客户:['recA'],客户联系人:['recC'],后续安排:'有下一步行动',建议下一步行动:'Keep'};
 assert.equal(changeDraft(before,'直接客户',['recA'],{},false),before);
 assert.equal(changeDraft(before,'后续安排','有下一步行动',{},false),before);
 assert.deepEqual(changeDraft(before,'直接客户',['recB'],{},false).客户联系人,[]);
 const people={实际跟进人:['2','1']};
 assert.equal(changeDraft(people,'实际跟进人',['1','2'],{},false),people);
});
test('real ownership or type changes still clear incompatible fields and retain historical commerce',()=>{
 const before={直接客户:['recA'],关联项目:['recP'],客户联系人:['recC'],预计金额:0,币种:'CNY'};
 const next=changeDraft(before,'跟进归属','项目跟进',{},false);
 for(const key of ['直接客户','关联项目','客户联系人'])assert.deepEqual(next[key],[]);
 assert.deepEqual(before.客户联系人,['recC']);
 assert.equal(changeDraft(before,'项目类型','技术验证',before,true).预计金额,0);
 assert.equal(changeDraft(before,'项目类型','技术验证',{},false).预计金额,null);
});
test('visible conditional fields mark external contacts, plans, pause reasons and zero-valued commerce correctly',()=>{
 const f=(key)=>({key,type:'text'});
 assert.equal(requiredField(f('客户联系人'),'followup','create',{记录类型:'外部沟通'}).required,true);
 assert.equal(requiredField(f('客户联系人'),'followup','edit',{记录类型:'内部推进'}).required,false);
 assert.equal(requiredField(f('直接客户'),'followup','create',{跟进归属:'客户直接跟进'}).required,true);
 assert.equal(requiredField(f('无后续动作结论'),'followup','edit',{后续安排:'无后续动作'}).required,true);
 assert.equal(requiredField(f('暂停原因'),'project','progress',{工作状态:'暂停'}).required,true);
 assert.equal(requiredField(f('下次跟进日期'),'project','progress',{工作状态:'暂停'}).required,false);
 assert.equal(requiredField(f('下次跟进日期'),'project','progress',{工作状态:'进行中'}).required,true);
 assert.equal(requiredField(f('币种'),'project','create',{项目类型:'销售机会',预计金额:0}).required,true);
});
test('client validation catches blanks, incomplete date/time and missing contact channels without rejecting zero',()=>{
 const fields=[{key:'标题',type:'text',required:true},{key:'员工',type:'person',required:true},
  {key:'金额',type:'number',required:true},{key:'发生',type:'datetime',required:true}];
 const errors=missingFields(fields,{标题:' ',员工:[],金额:0,发生:'2026-10-24'});
 assert.deepEqual(Object.keys(errors),['标题','员工','发生']);
 assert.deepEqual(missingFields(fields,{标题:'A',员工:['1'],金额:0,发生:'2026-10-24T09:00:02'}),{});
 const channels=[{key:'电话',type:'text'},{key:'邮箱',type:'text'}];
 assert.equal(Object.keys(missingFields(channels,{})).length,2);
 assert.deepEqual(missingFields(channels,{邮箱:'a@example.com'}),{});
});
test('loading more preserves previous rows, deduplicates overlap and retains latest paging metadata',()=>{
 const a={records:[{id:'recA',record:{v:1}},{id:'recB',record:{v:1}}],hasMore:true,pageToken:'p2'};
 const b={records:[{id:'recB',record:{v:2}},{id:'recC',record:{v:3}}],hasMore:false};
 const merged=appendPage(a,b);
 assert.deepEqual(merged.records.map(x=>x.id),['recA','recB','recC']);
 assert.equal(merged.records[1].record.v,2);
 assert.equal(merged.hasMore,false);
 assert.equal(merged.pageToken,undefined);
 assert.equal(a.records[1].record.v,1);
});
