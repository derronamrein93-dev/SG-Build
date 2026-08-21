-- Rollback 0016. The enum value added to user_role is NOT removed: PostgreSQL
-- has no `alter type ... drop value`, and an orphaned enum label is harmless.
-- Any app_user row carrying it must be deleted first, which the cascade from
-- kiosk_device does not do — those rows are listed by the select below.
--
--   select id from app_user where role = 'kiosk_device';

drop policy if exists tenant_isolation on device_health_event;
alter table device_health_event no force row level security;
alter table device_health_event disable row level security;
revoke select on device_health_event from fitos_app;

drop index if exists device_installation_ingest_token;
alter table device_installation drop column if exists ingest_token_hash;

drop table if exists kiosk_enrollment_code;
drop table if exists kiosk_device;
drop type if exists kiosk_status;
