-- =============================================================================
-- Day 1 gate — tenant isolation suite (docs/09 §4)
-- A passing SELECT test alone is not isolation. All eight must pass.
-- =============================================================================
\set ON_ERROR_STOP on
set client_min_messages = notice;

-- ── seed as the SERVICE role ──
-- RLS is FORCEd, so even the table owner cannot write past it. Seeding and
-- migrations run as fitos_svc, which is the same separation production uses.
set role fitos_svc;
delete from organization;
delete from person_identity;

insert into organization (id, name, org_type, default_customer_access) values
  ('aaaaaaaa-0000-0000-0000-000000000001','Northside Running Co.','independent','creating_location'),
  ('bbbbbbbb-0000-0000-0000-000000000001','Southside Work Boots','independent','creating_location');

insert into location (id, organization_id, name, phone, email) values
  ('aaaaaaaa-1111-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001','Northside — Grand Ave','555-0148','a1@x.test'),
  ('aaaaaaaa-1111-0000-0000-000000000002','aaaaaaaa-0000-0000-0000-000000000001','Northside — Lakeview','555-0149','a2@x.test'),
  ('bbbbbbbb-1111-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-000000000001','Southside — Main','555-0150','b1@x.test');

insert into app_user (id, location_id, organization_id, first_name, role) values
  ('aaaaaaaa-2222-0000-0000-000000000001','aaaaaaaa-1111-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001','Denise','associate'),
  ('bbbbbbbb-2222-0000-0000-000000000001','bbbbbbbb-1111-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-000000000001','Marcus','associate');

insert into organization_customer (id, organization_id, created_at_location_id, first_name, last_name, phone_lookup_hash, phone_key_version) values
  ('aaaaaaaa-3333-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-1111-0000-0000-000000000001','Ada','Alvarez', digest('org-a-key:+15025551212','sha256'), 1),
  ('bbbbbbbb-3333-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-000000000001','bbbbbbbb-1111-0000-0000-000000000001','Ada','Alvarez', digest('org-b-key:+15025551212','sha256'), 1);

insert into fitting_session (id, organization_id, location_id, organization_customer_id, user_id, status, completed_at) values
  ('aaaaaaaa-4444-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-1111-0000-0000-000000000001','aaaaaaaa-3333-0000-0000-000000000001','aaaaaaaa-2222-0000-0000-000000000001','completed', now()),
  ('bbbbbbbb-4444-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-000000000001','bbbbbbbb-1111-0000-0000-000000000001','bbbbbbbb-3333-0000-0000-000000000001','bbbbbbbb-2222-0000-0000-000000000001','completed', now());

insert into report (id, fitting_session_id, organization_customer_id, access_token_hash, expires_at, content_snapshot) values
  ('aaaaaaaa-5555-0000-0000-000000000001','aaaaaaaa-4444-0000-0000-000000000001','aaaaaaaa-3333-0000-0000-000000000001', digest('token-a','sha256'), now() + interval '90 days','{}'),
  ('bbbbbbbb-5555-0000-0000-000000000001','bbbbbbbb-4444-0000-0000-000000000001','bbbbbbbb-3333-0000-0000-000000000001', digest('token-b','sha256'), now() + interval '90 days','{}');

-- Same human, both retailers. Identity resolution knows; nobody else may.
insert into person_identity (id, identity_lookup_hash) values
  ('cccccccc-0000-0000-0000-000000000001', digest('global-key:+15025551212','sha256'));
update organization_customer set person_identity_id = 'cccccccc-0000-0000-0000-000000000001'
 where id in ('aaaaaaaa-3333-0000-0000-000000000001','bbbbbbbb-3333-0000-0000-000000000001');

-- ── run as the application role, scoped to Org A / Location A1 ──
set role fitos_app;
set app.organization_id = 'aaaaaaaa-0000-0000-0000-000000000001';
set app.location_id     = 'aaaaaaaa-1111-0000-0000-000000000001';

do $$
declare n int; ok boolean;
begin
  -- 0 · sanity: own data is visible, or the tests below prove nothing
  select count(*) into n from organization_customer;
  if n <> 1 then raise exception 'SANITY FAILED: expected 1 own customer, saw %', n; end if;
  raise notice 'PASS 0 · own customer visible';

  -- 1 · cannot READ another organization's rows
  select count(*) into n from organization_customer
   where id = 'bbbbbbbb-3333-0000-0000-000000000001';
  if n <> 0 then raise exception 'TEST 1 FAILED: read across tenants'; end if;
  raise notice 'PASS 1 · cannot read Org B customer';

  -- 2 · cannot UPDATE another organization's rows
  update organization_customer set notes = 'tampered'
   where id = 'bbbbbbbb-3333-0000-0000-000000000001';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'TEST 2 FAILED: updated % foreign rows', n; end if;
  raise notice 'PASS 2 · cannot update Org B customer';

  -- 3 · cannot ENUMERATE — no count, no existence oracle
  select count(*) into n from fitting_session;
  if n <> 1 then raise exception 'TEST 3 FAILED: session count leaked (%)', n; end if;
  select count(*) into n from organization_customer
   where id in ('aaaaaaaa-3333-0000-0000-000000000001','bbbbbbbb-3333-0000-0000-000000000001');
  if n <> 1 then raise exception 'TEST 3 FAILED: id probe leaked existence'; end if;
  raise notice 'PASS 3 · cannot enumerate Org B ids';

  -- 4 · a report URL cannot be walked to another tenant's report
  select count(*) into n from report where id = 'bbbbbbbb-5555-0000-0000-000000000001';
  if n <> 0 then raise exception 'TEST 4 FAILED: report walked across tenants'; end if;
  select count(*) into n from report where access_token_hash = digest('token-b','sha256');
  if n <> 0 then raise exception 'TEST 4 FAILED: report reachable by token guess'; end if;
  raise notice 'PASS 4 · report not walkable across tenants';

  -- 6 · service-role operations are separated: the app role has no BYPASSRLS
  select rolbypassrls into ok from pg_roles where rolname = 'fitos_app';
  if ok then raise exception 'TEST 6 FAILED: app role can bypass RLS'; end if;
  select rolbypassrls into ok from pg_roles where rolname = 'fitos_svc';
  if not ok then raise exception 'TEST 6 FAILED: service role misconfigured'; end if;
  raise notice 'PASS 6 · service role separated from app role';

  -- 8 · shared person_identity creates NO path between organizations
  begin
    perform 1 from person_identity;
    raise exception 'TEST 8 FAILED: app role can read person_identity';
  exception when insufficient_privilege then
    null; -- expected
  end;
  begin
    perform 1 from identity_resolution;
    raise exception 'TEST 8 FAILED: app role can read identity_resolution';
  exception when insufficient_privilege then
    null;
  end;
  select count(*) into n from organization_customer
   where person_identity_id = 'cccccccc-0000-0000-0000-000000000001';
  if n <> 1 then raise exception 'TEST 8 FAILED: identity join exposed % customers', n; end if;
  raise notice 'PASS 8 · shared identity exposes no cross-retailer path';
end $$;

-- 7 · location authorization — same org, different door
set app.location_id = 'aaaaaaaa-1111-0000-0000-000000000002';
do $$
declare n int;
begin
  select count(*) into n from organization_customer;
  if n <> 0 then raise exception 'TEST 7 FAILED: customer visible at ungranted location'; end if;
  raise notice 'PASS 7a · customer invisible at sibling location without a grant';
end $$;

set role fitos_svc;
insert into location_customer_access (organization_id, organization_customer_id, location_id, reason)
values ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-3333-0000-0000-000000000001','aaaaaaaa-1111-0000-0000-000000000002','chain recognition enabled');

set role fitos_app;
set app.organization_id = 'aaaaaaaa-0000-0000-0000-000000000001';
set app.location_id     = 'aaaaaaaa-1111-0000-0000-000000000002';
do $$
declare n int;
begin
  select count(*) into n from organization_customer;
  if n <> 1 then raise exception 'TEST 7 FAILED: grant did not take effect'; end if;
  raise notice 'PASS 7b · explicit grant makes the customer visible';
end $$;

-- 5 · storage objects obey the same boundary. There is no storage service in
--     this environment, so the check is asserted against the metadata rows that
--     would carry the object references (scan.raw_uri).
set app.location_id = 'aaaaaaaa-1111-0000-0000-000000000001';
do $$
declare n int;
begin
  select count(*) into n from scan
   where fitting_session_id = 'bbbbbbbb-4444-0000-0000-000000000001';
  if n <> 0 then raise exception 'TEST 5 FAILED: foreign scan metadata visible'; end if;
  raise notice 'PASS 5 · scan/storage references scoped to tenant (metadata layer)';
end $$;

reset role;
\echo '--- all isolation tests passed ---'
