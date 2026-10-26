export function crmAdmin(roles: readonly string[] | undefined): boolean {
  return Array.isArray(roles) && roles.includes('crm_admin');
}
