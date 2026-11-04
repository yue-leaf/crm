CREATE TABLE IF NOT EXISTS crm_deletion (
id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
root_key varchar(100) NOT NULL,
status varchar(20) NOT NULL DEFAULT 'preview',
payload jsonb NOT NULL,
_created_at TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
_created_by user_profile,
_updated_at TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
_updated_by user_profile);
ALTER TABLE crm_deletion ENABLE ROW LEVEL SECURITY;
CREATE POLICY service_role_bypass_policy ON crm_deletion TO service_role USING (true);
CREATE POLICY deletion_admin ON crm_deletion FOR ALL TO authenticated
USING ('crm_admin' = ANY(string_to_array(current_setting('app.role_ids', true), ',')))
WITH CHECK ('crm_admin' = ANY(string_to_array(current_setting('app.role_ids', true), ',')));
CREATE POLICY deletion_read ON crm_deletion FOR SELECT TO authenticated USING (true);
