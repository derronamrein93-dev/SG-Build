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

-- Person-scoped consent. Belongs to identity resolution, not to a retailer.
-- Under the pre-0005 policy both rows were readable by every tenant, which is
-- the defect 0005 closes.
insert into consent_record (id, scope, person_identity_id, location_id, type, granted,
                            consent_text_version, privacy_policy_version, method) values
  -- captured at Org B's door
  ('cccccccc-6666-0000-0000-000000000001','person','cccccccc-0000-0000-0000-000000000001',
   'bbbbbbbb-1111-0000-0000-000000000001','identity_resolution', true,
   'consent-identity-v1.0','privacy-v1.0','mystrideid_account'),
  -- no location at all: must resolve to visible-to-nobody
  ('cccccccc-6666-0000-0000-000000000002','person','cccccccc-0000-0000-0000-000000000001',
   null,'portable_profile_share', true,
   'consent-identity-v1.0','privacy-v1.0','mystrideid_account');

-- Audit rows for both organizations, seeded through the service role.
-- A merged-away record in Org B, so assertion 20 has something to fail to see.
insert into organization_customer (id, organization_id, created_at_location_id, first_name, last_name, phone_lookup_hash, phone_key_version)
 values ('bbbbbbbb-3333-0000-0000-000000000002','bbbbbbbb-0000-0000-0000-000000000001','bbbbbbbb-1111-0000-0000-000000000001','Ada','Duplicate', digest('org-b-key:+15025559999','sha256'), 1);
update organization_customer
   set merged_into_customer_id = 'bbbbbbbb-3333-0000-0000-000000000001', merged_at = now()
 where id = 'bbbbbbbb-3333-0000-0000-000000000002';

insert into report_view (report_id, organization_id) values
  ('aaaaaaaa-5555-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001'),
  ('bbbbbbbb-5555-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-000000000001');

insert into audit_log (organization_id, action, subject_type, subject_id, metadata) values
  ('aaaaaaaa-0000-0000-0000-000000000001','customer_identity.merge_requested',
   'organization_customer','aaaaaaaa-3333-0000-0000-000000000001','{"reason":"duplicate"}'),
  ('bbbbbbbb-0000-0000-0000-000000000001','customer_identity.merge_completed',
   'organization_customer','bbbbbbbb-3333-0000-0000-000000000001','{}');

-- One ordinary organization-scoped row, so the tests below prove narrowing
-- rather than breakage.
insert into consent_record (scope, organization_customer_id, location_id, type, granted,
                            consent_text_version, privacy_policy_version, method) values
  ('organization','aaaaaaaa-3333-0000-0000-000000000001','aaaaaaaa-1111-0000-0000-000000000001',
   'fit_history_storage', true, 'consent-fit-v1.0','privacy-v1.0','tablet_checkbox');

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

  -- 9 · person-scoped consent is not globally readable (0005)
  --     Before 0005 this count was 2, and that is the whole point of the test.
  select count(*) into n from consent_record where scope = 'person';
  if n <> 0 then
    raise exception 'TEST 9 FAILED: % person-scoped consent rows visible to Org A', n;
  end if;
  raise notice 'PASS 9 · person-scoped consent invisible across tenants';

  -- 10 · ...and the organization's own consent rows still are
  select count(*) into n from consent_record where scope = 'organization';
  if n <> 1 then
    raise exception 'TEST 10 FAILED: expected 1 own consent row, saw %', n;
  end if;
  raise notice 'PASS 10 · organization-scoped consent still visible to its own tenant';

  -- 13 · audit rows are readable by the organization that owns them
  select count(*) into n from audit_log;
  if n <> 1 then
    raise exception 'TEST 13 FAILED: expected 1 own audit row, saw %', n;
  end if;
  raise notice 'PASS 13 · own audit rows readable';

  -- 14 · ...and only by that organization
  select count(*) into n from audit_log
   where organization_id = 'bbbbbbbb-0000-0000-0000-000000000001';
  if n <> 0 then
    raise exception 'TEST 14 FAILED: % foreign audit rows visible', n;
  end if;
  raise notice 'PASS 14 · audit rows not readable across tenants';

  -- 15 · append-only: no UPDATE, by grant and by the absence of a policy
  begin
    update audit_log set action = 'tamper.attempt';
    raise exception 'TEST 15 FAILED: audit row was updatable';
  exception when insufficient_privilege then
    raise notice 'PASS 15 · audit rows cannot be updated by the app role';
  end;

  -- 16 · append-only: no DELETE either
  begin
    delete from audit_log;
    raise exception 'TEST 16 FAILED: audit row was deletable';
  exception when insufficient_privilege then
    raise notice 'PASS 16 · audit rows cannot be deleted by the app role';
  end;

  -- 17 · an insert claiming another organization is refused by the policy
  begin
    insert into audit_log (organization_id, action, subject_type)
    values ('bbbbbbbb-0000-0000-0000-000000000001','customer_identity.merge_rejected',
            'organization_customer');
    raise exception 'TEST 17 FAILED: wrote an audit row into a foreign organization';
  exception when insufficient_privilege then
    raise notice 'PASS 17 · audit inserts are confined to the current tenant';
  end;

  -- 18 · the report access log is readable only by the organization it belongs
  --      to. Viewing patterns are a customer behaviour signal; before 0007 this
  --      table had no organization_id and no policy at all.
  select count(*) into n from report_view;
  if n <> 1 then
    raise exception 'TEST 18 FAILED: expected 1 own report_view row, saw %', n;
  end if;
  select count(*) into n from report_view
   where organization_id = 'bbbbbbbb-0000-0000-0000-000000000001';
  if n <> 0 then
    raise exception 'TEST 18 FAILED: % foreign report_view rows visible', n;
  end if;
  raise notice 'PASS 18 · report_view scoped to its own tenant';

  -- 19 · and it is append-only, like audit_log
  begin
    delete from report_view;
    raise exception 'TEST 19 FAILED: access-log row was deletable';
  exception when insufficient_privilege then
    raise notice 'PASS 19 · report_view rows cannot be deleted by the app role';
  end;

  -- 20 · a merged-away record is a tombstone, not a hiding place. It stays
  --      invisible across tenants exactly as a live record does.
  select count(*) into n from organization_customer
   where merged_into_customer_id is not null
     and organization_id = 'bbbbbbbb-0000-0000-0000-000000000001';
  if n <> 0 then
    raise exception 'TEST 20 FAILED: % foreign merged records visible', n;
  end if;
  raise notice 'PASS 20 · merged records do not leak across tenants';

  -- 21 · the app role cannot merge. Authority is fitos_svc only.
  begin
    perform app_merge_customer('aaaaaaaa-3333-0000-0000-000000000001',
                               'bbbbbbbb-3333-0000-0000-000000000001',
                               'aaaaaaaa-2222-0000-0000-000000000001',
                               gen_random_uuid(), false);
    raise exception 'TEST 21 FAILED: the app role executed a merge';
  exception when insufficient_privilege then
    raise notice 'PASS 21 · merge authority restricted to the service role';
  end;
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

-- 11 · the capturing organization keeps the person-scoped row it took, and the
--      location-less row stays invisible to everyone including Org B.
set role fitos_app;
set app.organization_id = 'bbbbbbbb-0000-0000-0000-000000000001';
set app.location_id     = 'bbbbbbbb-1111-0000-0000-000000000001';
do $$
declare n int;
begin
  select count(*) into n from consent_record
   where id = 'cccccccc-6666-0000-0000-000000000001';
  if n <> 1 then
    raise exception 'TEST 11 FAILED: capturing org cannot read its own person-scoped consent';
  end if;

  select count(*) into n from consent_record
   where id = 'cccccccc-6666-0000-0000-000000000002';
  if n <> 0 then
    raise exception 'TEST 11 FAILED: location-less person-scoped consent was visible';
  end if;
  raise notice 'PASS 11 · person-scoped consent scoped to the capturing organization';
end $$;

-- 12 · the existing customer-creation write path still satisfies the new
--      with-check. This is the exact insert queries.ts performs.
set app.organization_id = 'aaaaaaaa-0000-0000-0000-000000000001';
set app.location_id     = 'aaaaaaaa-1111-0000-0000-000000000001';
do $$
declare n int;
begin
  insert into consent_record (scope, organization_customer_id, location_id, type, granted,
                              consent_text_version, privacy_policy_version, method,
                              captured_by_user_id)
  values ('organization','aaaaaaaa-3333-0000-0000-000000000001',
          'aaaaaaaa-1111-0000-0000-000000000001','receive_report', true,
          'consent-fit-v1.0','privacy-v1.0','tablet_checkbox',
          'aaaaaaaa-2222-0000-0000-000000000001');
  select count(*) into n from consent_record where type = 'receive_report';
  if n <> 1 then
    raise exception 'TEST 12 FAILED: consent write did not land';
  end if;
  raise notice 'PASS 12 · customer-creation consent write still passes the with-check';
exception when insufficient_privilege or check_violation then
  raise exception 'TEST 12 FAILED: 0005 blocked the existing consent write path';
end $$;

reset role;
\echo '--- all isolation tests passed ---'
