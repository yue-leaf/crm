CREATE TABLE IF NOT EXISTS crm_notification_setting (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
setting_key varchar(50) NOT NULL UNIQUE,
enabled boolean NOT NULL DEFAULT false,
send_time varchar(5) NOT NULL DEFAULT '08:00',
recipient_ids text[] NOT NULL DEFAULT '{}',
revision integer NOT NULL DEFAULT 1,
next_at timestamptz NOT NULL,
_created_at TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
_created_by user_profile,
_updated_at TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
_updated_by user_profile);
ALTER TABLE crm_notification_setting ENABLE ROW LEVEL SECURITY;
CREATE POLICY service_role_bypass_policy ON crm_notification_setting TO service_role USING (true);
CREATE POLICY "修改全部数据" ON crm_notification_setting FOR ALL TO authenticated
USING ('crm_admin' = ANY(string_to_array(current_setting('app.role_ids', true), ',')))
WITH CHECK ('crm_admin' = ANY(string_to_array(current_setting('app.role_ids', true), ',')));
CREATE POLICY "查看全部数据" ON crm_notification_setting FOR SELECT TO authenticated, anon USING (false);
CREATE POLICY "修改本人数据" ON crm_notification_setting FOR ALL TO authenticated USING (false) WITH CHECK (false);
CREATE TABLE IF NOT EXISTS crm_notification_delivery (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
delivery_key varchar(160) NOT NULL UNIQUE,
business_day varchar(10) NOT NULL,
recipient user_profile,
mode varchar(20) NOT NULL,
status varchar(30) NOT NULL,
attempts integer NOT NULL DEFAULT 1,
today_count integer NOT NULL DEFAULT 0,
tomorrow_count integer NOT NULL DEFAULT 0,
detail varchar(500) NOT NULL DEFAULT '',
_created_at TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
_created_by user_profile,
_updated_at TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
_updated_by user_profile);
ALTER TABLE crm_notification_delivery ENABLE ROW LEVEL SECURITY;
CREATE POLICY service_role_bypass_policy ON crm_notification_delivery TO service_role USING (true);
CREATE POLICY "修改全部数据" ON crm_notification_delivery FOR ALL TO authenticated
USING ('crm_admin' = ANY(string_to_array(current_setting('app.role_ids', true), ',')))
WITH CHECK ('crm_admin' = ANY(string_to_array(current_setting('app.role_ids', true), ',')));
CREATE POLICY "查看全部数据" ON crm_notification_delivery FOR SELECT TO authenticated, anon USING (false);
CREATE POLICY "修改本人数据" ON crm_notification_delivery FOR ALL TO authenticated USING (false) WITH CHECK (false);
