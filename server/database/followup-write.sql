CREATE TABLE IF NOT EXISTS crm_followup_write (
id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
record_key varchar(80) NOT NULL UNIQUE,
owner_token varchar(36) NOT NULL,
operation varchar(30) NOT NULL,
phase varchar(20) NOT NULL,
lease_until timestamptz NOT NULL,
continued_id varchar(80),
_created_at TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
_created_by user_profile,
_updated_at TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
_updated_by user_profile);
ALTER TABLE crm_followup_write ENABLE ROW LEVEL SECURITY;
CREATE POLICY service_role_bypass_policy ON crm_followup_write TO service_role USING (true);
CREATE POLICY followup_write_read ON crm_followup_write FOR SELECT TO authenticated USING (true);
CREATE POLICY followup_write_insert ON crm_followup_write FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY followup_write_update ON crm_followup_write FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
