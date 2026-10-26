const {test}=require('node:test');
const assert=require('node:assert/strict');
const {prepareEdit}=require('../../dist/server/modules/crm/crm-edit.js');
const {editFields,editBlockedReason}=require('../../dist/shared/crm-edit.js');
const {changeDraft,requiredField}=require('../../dist/shared/crm-interaction.js');
const {contactLifecycleProblem}=require('../../dist/shared/crm-review.js');
const row=(patch={})=>({id:'recContact',record:{姓名:'Contact',职务:'Manager',电话:'123',维护人:[123],所属企业:{link_record_ids:['recCompany']},联系人状态:'有效',...patch}});
const edit=(r,changes)=>prepareEdit('contact',r,{changes}, {}, 'Employee');
test('status dropdown allows editing and restoring disabled contacts',()=>{
 assert.deepEqual(editFields('contact').find(f=>f.key==='联系人状态').options,['有效','停用']);
 assert.equal(editBlockedReason('contact',row({联系人状态:'停用'})),'');
 assert.ok(editBlockedReason('contact',row({联系人状态:'Unknown'})));
 assert.equal(requiredField({key:'停用原因',type:'long'},'contact','edit',{联系人状态:'停用'}).required,true);
 assert.equal(changeDraft({联系人状态:'停用',停用原因:'old'},'联系人状态','有效',{},true).停用原因,null);
});
test('disable requires a reason and records server time',()=>{
 assert.throws(()=>edit(row(),{联系人状态:'停用'}),/停用原因/);
 const start=Date.now();const result=edit(row(),{联系人状态:'停用',停用原因:'Left company'});
 assert.ok(result.writes.停用时间>=start&&result.writes.停用时间<=Date.now());
 assert.equal(result.writes.联系人状态,'停用');assert.equal(result.writes.停用原因,'Left company');
 assert.equal(contactLifecycleProblem({...row().record,...result.writes}),'');
});
test('restore clears inactive metadata while retaining the previous boundary in audit',()=>{
 const past=Date.now()-86400000;const r=row({联系人状态:'停用',停用时间:past,停用原因:'Previous reason',联系人管理记录:'prior history'});
 const result=edit(r,{联系人状态:'有效',停用原因:'must not survive'});
 assert.equal(result.writes.停用时间,null);assert.equal(result.writes.停用原因,'');
 assert.match(result.writes.联系人管理记录,/prior history/);assert.match(result.writes.联系人管理记录,new RegExp(String(past)));
 assert.match(result.writes.联系人管理记录,/Previous reason/);
 assert.equal(contactLifecycleProblem({...r.record,...result.writes}),'');
});
test('editing a disabled contact preserves its historical timestamp and rejects invalid boundaries',()=>{
 const past=Date.now()-86400000;
 const result=edit(row({联系人状态:'停用',停用时间:past,停用原因:'Previous'}),{电话:'456'});
 assert.ok(!Object.hasOwn(result.writes,'停用时间'));
 assert.throws(()=>edit(row({联系人状态:'停用',停用时间:Date.now()+86400000,停用原因:'Previous'}),{电话:'456'}),/历史停用时间/);
 assert.throws(()=>edit(row(),{停用时间:past}),/不可修改/);
 assert.throws(()=>edit(row(),{联系人状态:null}),/必填/);
});
