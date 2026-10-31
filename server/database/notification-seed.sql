-- Run separately in each environment AFTER its tables have been deployed.
-- Safe to repeat: never overwrites saved settings, recipients, or schedule.
-- New deployments start disabled; an administrator chooses recipients and enables sending.
INSERT INTO crm_notification_setting
  (setting_key, enabled, send_time, recipient_ids, next_at)
VALUES
  ('daily', false, '08:00', ARRAY[]::text[],
   ((CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Shanghai')::date
    + INTERVAL '1 day 8 hours') AT TIME ZONE 'Asia/Shanghai')
ON CONFLICT (setting_key) DO NOTHING;

SELECT setting_key, enabled, send_time, next_at, revision
FROM crm_notification_setting WHERE setting_key = 'daily' LIMIT 1;
