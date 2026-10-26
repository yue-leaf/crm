require('reflect-metadata');
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {CrmController}=require('../../dist/server/modules/crm/crm.controller.js');
const {crmAdmin}=require('../../dist/shared/crm-access.js');

test('business session accepts missing or empty roles without fabricating an employee role',()=>{
  const c=new CrmController({summary:()=>true});
  for(const roles of [undefined,[],['some_other_role']]) {
    const req={userContext:{userId:'123',userName:'Member',roles}};
    assert.equal(c.current(req).roles,roles);
    assert.equal(c.summary(req),true);
    assert.throws(()=>c.list(req,'access'),e=>e.getStatus()===403);
  }
});

test('administrator configuration remains restricted to the exact platform role',()=>{
  const c=new CrmController({list:kind=>kind});
  assert.equal(c.list({userContext:{userId:'123',roles:['crm_admin']}},'access'),'access');
  for(const roles of [undefined,[],['not_crm_admin'],['crm_employee']]) {
    assert.equal(crmAdmin(roles),false);
    assert.throws(()=>c.list({userContext:{userId:'123',roles}},'access'),e=>e.getStatus()===403);
  }
});

test('malformed role and login contexts still fail closed',()=>{
  const c=new CrmController({summary:()=>assert.fail('must not reach service')});
  for(const req of [{},{userContext:{userId:' '}},{userContext:{userId:123}},
    ...[null,'crm_admin',{},[{}]].map(roles=>({userContext:{userId:'123',roles}}))])
    assert.throws(()=>c.summary(req),e=>e.getStatus()===403);
});
