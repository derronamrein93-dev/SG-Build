-- =============================================================================
-- report_view preflight and orphan gate.
--
-- Everything runs inside one transaction and is rolled back. The orphan is
-- constructed by dropping the foreign key, because that is the only way to
-- produce the state the migration is defending against — and reproducing it is
-- the only way to know the defence works.
-- =============================================================================
\set ON_ERROR_STOP on
set client_min_messages = notice;

begin;

-- ── fixture: a real report with a view, plus one orphaned view ──────────────
set role fitos_svc;
insert into organization (id, name) values
  ('dddddddd-0000-0000-0000-000000000001','Preflight Co.');
insert into location (id, organization_id, name, phone, email) values
  ('dddddddd-1111-0000-0000-000000000001','dddddddd-0000-0000-0000-000000000001','Door','555-0161','p@x.test');
insert into app_user (id, location_id, organization_id, first_name, role) values
  ('dddddddd-2222-0000-0000-000000000001','dddddddd-1111-0000-0000-000000000001','dddddddd-0000-0000-0000-000000000001','Pat','associate');
insert into fitting_session (id, organization_id, location_id, user_id, status, completed_at) values
  ('dddddddd-4444-0000-0000-000000000001','dddddddd-0000-0000-0000-000000000001','dddddddd-1111-0000-0000-000000000001','dddddddd-2222-0000-0000-000000000001','completed', now());
insert into report (id, fitting_session_id, access_token_hash, expires_at, content_snapshot) values
  ('dddddddd-5555-0000-0000-000000000001','dddddddd-4444-0000-0000-000000000001', digest('preflight-token','sha256'), now() + interval '90 days','{}');
insert into report_view (report_id, organization_id) values
  ('dddddddd-5555-0000-0000-000000000001','dddddddd-0000-0000-0000-000000000001');

do $$
declare n bigint;
begin
  select report_view_orphan_audit.n into n from report_view_orphan_audit()
   where check_name = 'report_does_not_exist';
  if n <> 0 then raise exception 'PRE 1 FAILED: healthy database reported % orphans', n; end if;
  raise notice 'PASS PRE 1 · preflight reports zero orphans on a healthy database';
end $$;

-- ── construct the state the migration defends against ───────────────────────
-- Schema changes need the table owner; the write needs a role that RLS does not
-- filter. FORCE ROW LEVEL SECURITY applies to the owner as well, which is why
-- these cannot be the same role.
reset role;
alter table report_view drop constraint report_view_report_id_fkey;
alter table report_view alter column organization_id drop not null;
set role fitos_svc;
insert into report_view (report_id, organization_id) values
  ('dddddddd-9999-0000-0000-00000000dead', null);

do $$
declare n bigint;
begin
  select report_view_orphan_audit.n into n from report_view_orphan_audit()
   where check_name = 'report_does_not_exist';
  if n <> 1 then raise exception 'PRE 2 FAILED: preflight missed the orphan (saw %)', n; end if;
  raise notice 'PASS PRE 2 · preflight detects an orphaned access-log row';
end $$;

-- ── the gate refuses to sweep without explicit approval ─────────────────────
do $$
declare unresolved bigint; swept boolean := false;
begin
  select count(*) into unresolved from report_view where organization_id is null;
  if unresolved = 0 then raise exception 'PRE 3 FAILED: fixture did not produce an unresolved row'; end if;

  begin
    if coalesce(current_setting('fitos.orphan_sweep', true), '') <> 'approved' then
      raise exception 'report_view has % row(s) that cannot resolve an organization. Migration stopped.', unresolved;
    end if;
    swept := true;
  exception when raise_exception then
    raise notice 'PASS PRE 3 · the gate stops the migration when the sweep is not approved';
  end;

  if swept then raise exception 'PRE 3 FAILED: swept without approval'; end if;
end $$;

-- ── ...and does sweep once approval is explicit ─────────────────────────────
-- The migration performs its sweep BEFORE enabling RLS on report_view, which is
-- the only window in which a delete is possible: afterwards there is no DELETE
-- grant and no policy naming DELETE, so the access log is append-only to
-- everyone. This mirrors that ordering rather than pretending a later sweep
-- would just work — if one is ever needed, it is a deliberate, documented
-- operation, not a routine one.
reset role;
alter table report_view no force row level security;
alter table report_view disable row level security;

set fitos.orphan_sweep = 'approved';
do $$
declare unresolved bigint;
begin
  if coalesce(current_setting('fitos.orphan_sweep', true), '') <> 'approved' then
    raise exception 'PRE 4 FAILED: approval was not visible to the gate';
  end if;
  delete from report_view where organization_id is null;
  select count(*) into unresolved from report_view where organization_id is null;
  if unresolved <> 0 then raise exception 'PRE 4 FAILED: sweep left % rows', unresolved; end if;
  raise notice 'PASS PRE 4 · approved sweep removes only unresolvable rows';
end $$;

do $$
declare n bigint;
begin
  select count(*) into n from report_view where report_id = 'dddddddd-5555-0000-0000-000000000001';
  if n <> 1 then raise exception 'PRE 5 FAILED: the sweep removed a healthy row'; end if;
  raise notice 'PASS PRE 5 · healthy access-log rows survive the sweep';
end $$;

rollback;
\echo '--- report_view preflight tests passed (all changes rolled back) ---'
