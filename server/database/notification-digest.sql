-- Additive upgrade. NULL preserves the distinction between old unrecorded counts and zero.
ALTER TABLE crm_notification_delivery
  ADD COLUMN IF NOT EXISTS overdue_count integer,
  ADD COLUMN IF NOT EXISTS other_count integer;
