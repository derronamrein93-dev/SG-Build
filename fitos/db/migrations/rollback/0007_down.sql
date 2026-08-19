-- Reverses 0007's SCHEMA changes. Restores report_view to an unscoped,
-- RLS-free access log.
--
-- IRREVERSIBLE: any rows swept by the migration's orphan gate are gone. The
-- sweep only runs under explicit approval (fitos.orphan_sweep = 'approved'),
-- and the counts are printed before it happens, but nothing here brings them
-- back. Capture `select * from report_view where organization_id is null` before
-- approving a sweep on anything you cannot rebuild.
drop policy if exists report_view_insert on report_view;
drop policy if exists report_view_select on report_view;
-- Both, in this order. `disable` stops policies applying but leaves
-- relforcerowsecurity set, so without `no force` the table does not return to
-- the state 0007 found it in.
alter table report_view no force row level security;
alter table report_view disable row level security;
drop index if exists report_view_org_time;
alter table report_view drop constraint if exists report_view_organization_id_fkey;
alter table report_view drop column if exists organization_id;
drop function if exists report_view_orphan_audit();
