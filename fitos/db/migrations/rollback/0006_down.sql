-- Reverses 0006. Drops policies, table and the metadata-safety function.
-- Destroys the audit trail: reverse only while it is still empty of anything
-- worth keeping.
drop policy if exists audit_log_insert on audit_log;
drop policy if exists audit_log_select on audit_log;
drop table if exists audit_log;
drop function if exists audit_metadata_has_banned_key(jsonb);
