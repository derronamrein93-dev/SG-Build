-- =============================================================================
-- 0007 · report_view — tenant scope, RLS, and an orphan preflight
--
-- report_view is the access log for customer reports: who opened a report link
-- and when. It had no organization_id and no RLS, so it was the one table where
-- viewing patterns crossed the tenant boundary.
--
-- It also had two rows referencing reports that no longer existed, behind a
-- VALIDATED cascade foreign key where that should be impossible. The provenance
-- was never established. That is exactly why the sweep below is gated rather
-- than automatic: an access log quietly losing rows is a bigger problem than the
-- migration it is blocking, and deleting the evidence is the wrong first move.
-- =============================================================================

-- ── Preflight, as a permanent callable ──────────────────────────────────────
-- A function rather than a one-off script: the same integrity question is worth
-- asking again later, and ops can run it against a real database without
-- running a migration.
create or replace function report_view_orphan_audit()
returns table (check_name text, n bigint) as $fn$
begin
  -- Refuse to answer where the answer would be misleading. RLS on report_view is
  -- FORCEd, which applies to the table owner too, so a caller without BYPASSRLS
  -- counts only the rows it can already see — and reports zero orphans on a
  -- database full of them. An integrity check that inherits the visibility rules
  -- it is auditing is worse than no check, because it reads as reassurance.
  --
  -- The condition is on FORCE being set rather than on the role alone, so the
  -- preflight below still runs during this migration, before RLS is enabled.
  if exists (select 1 from pg_class where relname = 'report_view' and relforcerowsecurity)
     and not exists (select 1 from pg_roles where rolname = current_user and rolbypassrls) then
    raise exception
      'report_view_orphan_audit() must run as a role that bypasses RLS (set role fitos_svc). '
      'Called as %, it would count only visible rows and under-report orphans.', current_user;
  end if;

  return query
    select 'total_rows', count(*)::bigint from report_view
    union all
    select 'missing_report_id', count(*)::bigint from report_view where report_id is null
    union all
    select 'report_does_not_exist', count(*)::bigint
      from report_view rv left join report r on r.id = rv.report_id
     where rv.report_id is not null and r.id is null
    union all
    select 'scope_unresolvable', count(*)::bigint
      from report_view rv
      join report r on r.id = rv.report_id
      left join fitting_session s on s.id = r.fitting_session_id
     where s.id is null or s.organization_id is null
    union all
    select 'report_expired_or_revoked', count(*)::bigint
      from report_view rv join report r on r.id = rv.report_id
     where r.revoked_at is not null or r.expires_at <= now();
end $fn$ language plpgsql stable;

revoke execute on function report_view_orphan_audit() from public;
grant execute on function report_view_orphan_audit() to fitos_svc;

comment on function report_view_orphan_audit() is
  'Integrity counts for report_view. Run before any cleanup. Rows that cannot '
  'resolve an organization cannot be shown to one, but they are still evidence.';

-- ── Report, always ──────────────────────────────────────────────────────────
do $$
declare rec record;
begin
  raise notice '--- report_view preflight ---';
  for rec in select * from report_view_orphan_audit() loop
    raise notice '  % = %', rpad(rec.check_name, 26), rec.n;
  end loop;
end $$;

-- ── Scope column, backfilled only where it can be proven ────────────────────
alter table report_view add column organization_id uuid;

update report_view rv
   set organization_id = s.organization_id
  from report r
  join fitting_session s on s.id = r.fitting_session_id
 where r.id = rv.report_id;

-- ── Gate ────────────────────────────────────────────────────────────────────
-- Anything still null could not be traced to an organization through
-- report → fitting_session. Inventing a tenant for it would be worse than
-- failing: it would file one retailer's access record under another's.
do $$
declare unresolved bigint;
begin
  select count(*) into unresolved from report_view where organization_id is null;
  if unresolved = 0 then
    raise notice 'report_view: all rows resolved to an organization';
    return;
  end if;

  if coalesce(current_setting('fitos.orphan_sweep', true), '') <> 'approved' then
    raise exception
      'report_view has % row(s) that cannot resolve an organization. Migration stopped. '
      'Inspect them first:  select id, report_id, viewed_at from report_view where organization_id is null; '
      'On a local or demo database, re-run with:  psql -c "set fitos.orphan_sweep = ''approved''" '
      'or PGOPTIONS="-c fitos.orphan_sweep=approved". On a real database, do not sweep until the rows '
      'are explained — see docs/05, "report_view integrity".', unresolved;
  end if;

  raise notice 'report_view: sweeping % unresolvable row(s) under explicit approval', unresolved;
  delete from report_view where organization_id is null;
end $$;

alter table report_view alter column organization_id set not null;
alter table report_view add constraint report_view_organization_id_fkey
  foreign key (organization_id) references organization(id) on delete cascade;

create index report_view_org_time on report_view (organization_id, viewed_at desc);

-- ── RLS ─────────────────────────────────────────────────────────────────────
alter table report_view enable row level security;
alter table report_view force  row level security;

-- Explicit verbs, as with audit_log: a FOR ALL policy would authorise UPDATE and
-- DELETE the moment anyone granted them. An access log is append-only.
create policy report_view_select on report_view
  for select using (organization_id = app_current_org());
create policy report_view_insert on report_view
  for insert with check (organization_id = app_current_org());

-- The app role reads its own organization's access log and never writes one.
-- Writing happens on the public report path, which runs as fitos_svc because the
-- viewer is anonymous and has no tenant context to satisfy.
grant select on report_view to fitos_app, fitos_svc;
grant insert (report_id, organization_id, user_agent_class, referrer_class)
  on report_view to fitos_svc;
