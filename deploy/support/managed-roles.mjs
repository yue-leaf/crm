import assert from 'node:assert/strict';
export function rolePayload(response) {
  return typeof response.data.data === 'string' ? JSON.parse(response.data.data) : response.data;
}
export function isManagedRole(role, ids = []) {
  return ['editor','reader'].includes(role.role_type) ||
    (role.role_type === 'custom_role' && (ids.includes(role.role_id) || ['员工','权限验证-待配置'].includes(role.role_name)));
}
export function registerManagedRole(read, save, baseToken, id) {
  if (!id) throw new Error('Missing managed role ID');
  const registry=read('resources/managed-roles.json',{baseToken,ids:[]});
  if(registry.baseToken!==baseToken)throw new Error('Managed role registry belongs to another Base.');
  if(!registry.ids.includes(id))registry.ids.push(id);
  save('resources/managed-roles.json',registry);
}
export function assertLocked(role, resources) {
  assert.equal(role.base_rule_map?.copy,false);
  assert.equal(role.base_rule_map?.download,false);
  for(const t of Object.values({...resources.tables,...resources.adminTables}))assert.equal(role.table_rule_map?.[t.name]?.perm,'no_perm','Role table remains accessible: '+t.name);
  if(resources.dashboard)assert.equal(role.dashboard_rule_map?.[resources.dashboard.name]?.perm,'no_perm');
}
