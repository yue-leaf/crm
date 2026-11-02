require('reflect-metadata');
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {CrmService}=require('../../dist/server/modules/crm/crm.service');
const {CrmController}=require('../../dist/server/modules/crm/crm.controller');
const member=(id,name)=>({id:'rec'+id,record:{飞书成员:[id],姓名:name,待配置角色:'管理员',备注:'private'}});
test('member list loads all pages without a keyword, keeps namesakes, and returns no permission/private columns',async()=>{
 const service=new CrmService({}, {}, {});const calls=[];
 service.list=async(kind,cursor)=>{calls.push([kind,cursor]);return cursor
  ? {records:[member('102','同名'),member('103','第三人'),member('101','同名')],hasMore:false}
  : {records:[member(101,'同名')],hasMore:true,pageToken:'next'};};
 const rows=await service.memberOptions();assert.equal(rows.length,3);
 assert.deepEqual(new Set(rows.map(r=>r.id)),new Set(['101','102','103']));
 assert.equal(rows.filter(r=>r.name==='同名').length,2);
 assert.ok(rows.every(r=>Object.keys(r).sort().join(',')==='id,name'));
 assert.deepEqual(calls,[['access',undefined],['access','next']]);
});
test('member list never substitutes Open IDs, malformed IDs, ambiguous people or unsafe numeric IDs',async()=>{
 const service=new CrmService({}, {}, {});
 service.list=async()=>({records:[member('ou_wrong','外部'),member(Number.MAX_SAFE_INTEGER+1,'unsafe'),member('104','Valid'),
 {id:'recAmbiguous',record:{飞书成员:['105','106'],姓名:'Multiple'}}],hasMore:false});
 assert.deepEqual(await service.memberOptions(),[{id:'104',name:'Valid'}]);
});
test('member list rejects incomplete/repeated pages rather than returning partial success',async()=>{
 const service=new CrmService({}, {}, {});
 service.list=async()=>({records:[],hasMore:true,pageToken:'same'});
 await assert.rejects(service.memberOptions(),/完整加载/);
});
test('ordinary logged-in employee can load minimal member list; anonymous cannot',async()=>{
 let calls=0;const controller=new CrmController({memberOptions:async()=>{calls++;return[{id:'101',name:'A'}];}});
 assert.deepEqual(await controller.members({userContext:{userId:'101',roles:[]}}),[{id:'101',name:'A'}]);
 assert.throws(()=>controller.members({}),/登录/);assert.equal(calls,1);
});
test('actual picker loader returns full directory on open and filters same directory when typing',async()=>{
 const fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript');
 const calls=[];const members=[{id:'101',name:'胡伟-AI'},{id:'102',name:'wei'},{id:'103',name:'刘慧婷'}];
 const context={exports:{},require:()=>({api:{members:async()=>{calls.push('members');return members;}}})};
 vm.runInNewContext(ts.transpileModule(fs.readFileSync('client/src/pages/crm/employeeOptions.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,context);
 const all=await context.exports.loadEmployeeOptions('');assert.equal(all.length,3);
 assert.equal((await context.exports.loadEmployeeOptions('刘'))[0].id,'103');
 assert.equal((await context.exports.loadEmployeeOptions('')).length,3);
 assert.deepEqual(calls,['members','members','members']);
});
