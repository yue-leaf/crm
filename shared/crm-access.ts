export function crmAdmin(roles: readonly string[]): boolean {
  return roles.includes('crm_admin');
}
export function crmEmployee(roles: readonly string[]): boolean {
  return crmAdmin(roles) || roles.includes('crm_employee');
}
