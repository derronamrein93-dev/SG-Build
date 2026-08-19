-- Reverses 0008.
--
-- REFUSES while any merge exists. Dropping merged_into_customer_id would remove
-- the redirect while leaving the moved rows on the survivor — a partial state
-- worse than either end, and silent: lookups on the merged-away number would
-- simply start returning the tombstone again, with none of its history.
-- Revert the merges first (app_revert_customer_merge), then run this.
-- Counted as fitos_svc, not as the owner. RLS on organization_customer is
-- FORCEd, which applies to the table owner too, and the migration role sets no
-- tenant GUC — so an owner-run count returns zero on a database full of merges
-- and the gate waves the rollback straight through. That is not hypothetical:
-- it is what this gate did on its first attempt.
set role fitos_svc;
do $$
declare n bigint;
begin
  if not exists (select 1 from pg_roles where rolname = current_user and rolbypassrls) then
    raise exception 'roll back 0008 as a role that bypasses RLS (set role fitos_svc); '
      'otherwise this gate counts only visible rows and cannot see the merges it is guarding';
  end if;
  select count(*) into n from organization_customer where merged_into_customer_id is not null;
  if n > 0 then
    raise exception
      'Refusing to roll back 0008: % merged record(s) exist. Revert them first: '
      'select id, merged_into_customer_id from organization_customer where merged_into_customer_id is not null;', n;
  end if;
end $$;
reset role;

drop trigger if exists fitting_session_no_tombstone on fitting_session;
drop function if exists fitting_session_reject_tombstone();
drop function if exists app_revert_customer_merge(uuid, uuid, uuid);
drop function if exists app_merge_customer(uuid, uuid, uuid, uuid, boolean);
drop function if exists app_effective_consent(uuid[]);
drop function if exists app_resolve_customer(uuid);
drop index if exists organization_customer_merged;
alter table organization_customer
  drop constraint if exists organization_customer_no_self_merge,
  drop constraint if exists organization_customer_merge_consistent,
  drop column if exists merged_at,
  drop column if exists merged_into_customer_id;
