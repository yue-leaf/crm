import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { rolePayload } from './managed-roles.mjs';
import { normalizedCell, assertNoIgnoredFields } from './record-verification.mjs';

const text = (name, description) => ({ name, type: 'text', ...(description ? {description} : {}) });
const select = (name, values, description) => ({ name, type: 'select', multiple: false, options: values.map(name => ({name})), ...(description ? {description} : {}) });
export const accessSchema = {
  name: '权限配置',
  fields: [
    text('姓名','管理员可维护显示名称；目录同步不覆盖已有显示名称。'),
    {name:'飞书成员',type:'user',multiple:false},
    text('成员标识','当前飞书应用下的 Open ID，是人员同步去重键；不要手工修改。'),
    text('通讯录姓名'),text('部门'),
    select('数据来源',['创建者登记','人员搜索','管理员录入']),
    {name:'最后目录同步',type:'datetime',style:{format:'yyyy-MM-dd HH:mm'}},
    select('待配置角色',['员工','管理员'],'仅登记员工或管理员的角色意向，不直接授予权限；实际访问由妙搭平台角色与应用可见范围控制。'),
    text('备注'),
    {name:'修改人',type:'updated_by'},
    {name:'修改时间',type:'updated_at',style:{format:'yyyy-MM-dd HH:mm'}},
  ],
};
export const accessColumns = ['姓名','飞书成员','通讯录姓名','部门','待配置角色','最后目录同步','备注','修改人','修改时间'];
export const accessViews = [
  {name:'成员授权清单',conditions:[]},
  {name:'管理员名单',conditions:[['待配置角色','intersects',['管理员']]]},
];

export function directoryPatch(user, stamp) {
  if (user.is_cross_tenant !== false) throw new Error('Only confirmed same-tenant members may be imported.');
  if (!/^ou_[a-zA-Z0-9]+$/.test(user.open_id || '')) throw new Error('Invalid directory Open ID.');
  return {
    飞书成员:[{id:user.open_id}],成员标识:user.open_id,
    通讯录姓名:user.localized_name || user.open_id,部门:user.department || null,
    数据来源:'人员搜索',最后目录同步:stamp,
  };
}
export function newMember(user, stamp) {
  return {姓名:user.localized_name || user.open_id,...directoryPatch(user,stamp),待配置角色:'员工',备注:'仅导入人员资料，角色为配置意向；尚未授予业务访问权限。'};
}
export async function protectAccessTable(base, read, save, r) {
  const table = r.adminTables?.access;
  if (!table) throw new Error('Access configuration table not registered.');
  const args=['--base-token',r.baseToken];
  const listing=base('+role-list',args), payload=rolePayload(listing);
  const roles=(payload.base_roles || []).map(role=>typeof role==='string'?JSON.parse(role):role);
  if (!roles.length || (payload.total != null && payload.total !== roles.length)) throw new Error('Incomplete role listing; personnel import refused.');
  const verified=[];
  for (const role of roles) {
    if (!['reader','editor','custom_role'].includes(role.role_type)) throw new Error('Unknown role type; review before importing personnel.');
    const roleArgs=[...args,'--role-id',role.role_id];
    const before=base('+role-get',roleArgs);
    const previous=rolePayload(before);
    if(previous.table_rule_map?.[table.name]?.perm!=='no_perm'){
      save(`resources/access/roles/${role.role_id}-before.json`,before);
      base('+role-update',[...roleArgs,'--yes'],{role_name:role.role_name,role_type:role.role_type,base_rule_map:previous.base_rule_map || {copy:false,download:false},table_rule_map:{[table.name]:{perm:'no_perm'}}});
    }
    const started=Date.now();let after;
    for (;;) {
      after=base('+role-get',roleArgs);
      if(rolePayload(after).table_rule_map?.[table.name]?.perm==='no_perm')break;
      if(Date.now()-started>15000)throw new Error('Access configuration table is not protected: '+role.role_name);
      await delay(1000);
    }
    save(`resources/access/roles/${role.role_id}.json`,after);
    verified.push({id:role.role_id,name:role.role_name,perm:'no_perm'});
  }
  const report={at:new Date().toISOString(),baseToken:r.baseToken,tableId:table.id,verified,note:'Native Base administrators retain management access. No staff role receives access to this table.'};
  save('verification/access-table-protection.json',report);
  return report;
}
export function memberLookup(base,args,openId){
  const response=base('+record-list',[...args,'--format','json','--limit','200','--filter-json',JSON.stringify({logic:'and',conditions:[['成员标识','==',openId]]})]);
  const d=response.data;
  if(d.has_more || d.record_id_list.length>1)throw new Error('Duplicate member identifier; import stopped: '+openId);
  if(!d.record_id_list.length)return null;
  return {id:d.record_id_list[0],fields:Object.fromEntries(d.fields.map((name,i)=>[name,d.data[0][i]]))};
}
export async function upsertMember(base,args,fields,openId,values){
  const prior=memberLookup(base,args,openId);
  const writeValues=Object.fromEntries(Object.entries(values).map(([name,value])=>[name,
    fields.find(f=>f.name===name)?.type==='select' && value!=null && !Array.isArray(value) ? [value] : value]));
  const result=prior ? base('+record-upsert',[...args,'--record-id',prior.id],writeValues) :
    base('+record-batch-create',args,{fields:Object.keys(writeValues),rows:[Object.values(writeValues)]});
  assertNoIgnoredFields(result);
  const start=Date.now();
  for(;;){
    try{
      const actual=memberLookup(base,args,openId);
      assert.ok(actual,'Member not returned after write.');
      for(const [name,value] of Object.entries(values)){
        const field=fields.find(f=>f.name===name);
        assert.deepEqual(normalizedCell(field,actual.fields[name]),normalizedCell(field,value),'Personnel readback mismatch: '+name);
      }
      return {id:actual.id,created:!prior};
    }catch(error){if(Date.now()-start>10000)throw error;await delay(1000);}
  }
}
