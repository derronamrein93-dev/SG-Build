-- =============================================================================
-- Stride Guide FitOS — 0003 · row-level security
-- Blueprint: docs/05-data-model.md §26, docs/09 Day 1 gate
--
-- Tenant context is carried in GUCs set per request:
--   app.organization_id · app.location_id · app.bypass_location_scope
-- On Supabase these are populated from JWT claims by the same helper functions.
-- =============================================================================

-- Roles are cluster-level: see db/bootstrap_roles.sql, run once as superuser.

create or replace function app_current_org() returns uuid as $$
  select nullif(current_setting('app.organization_id', true), '')::uuid
$$ language sql stable;

create or replace function app_current_location() returns uuid as $$
  select nullif(current_setting('app.location_id', true), '')::uuid
$$ language sql stable;

-- Managers/owners viewing org-wide reporting. Never set for the floor app.
create or replace function app_bypass_location_scope() returns boolean as $$
  select coalesce(nullif(current_setting('app.bypass_location_scope', true), ''), 'false')::boolean
$$ language sql stable;

-- Is the current location authorized for this customer? Authorization lives in
-- location_customer_access, never in a foreign key.
create or replace function app_can_access_customer(customer uuid) returns boolean as $$
  select app_bypass_location_scope() or exists (
    select 1 from location_customer_access a
     where a.organization_customer_id = customer
       and a.location_id = app_current_location()
       and a.revoked_at is null
       and a.access_level <> 'none'
  )
$$ language sql stable security definer;

-- ─────────────────────────────────────────── org-scoped tables ──
do $$
declare t text;
begin
  foreach t in array array[
    'location','app_user','organization_customer','fitting_session',
    'location_inventory','follow_up','pilot_feedback','device_installation'
  ] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force  row level security', t);
    execute format($f$
      create policy tenant_isolation on %I
        using (organization_id = app_current_org())
        with check (organization_id = app_current_org())
    $f$, t);
    execute format('grant select, insert, update, delete on %I to fitos_app, fitos_svc', t);
  end loop;
end $$;

alter table organization enable row level security;
alter table organization force  row level security;
create policy tenant_isolation on organization
  using (id = app_current_org()) with check (id = app_current_org());
grant select, update on organization to fitos_app, fitos_svc;

-- ─────────────────── customer: org isolation AND location authorization ──
drop policy tenant_isolation on organization_customer;
create policy tenant_isolation on organization_customer
  using (organization_id = app_current_org() and app_can_access_customer(id))
  with check (organization_id = app_current_org());

alter table location_customer_access enable row level security;
alter table location_customer_access force  row level security;
create policy tenant_isolation on location_customer_access
  using (organization_id = app_current_org())
  with check (organization_id = app_current_org());
grant select, insert, update on location_customer_access to fitos_app, fitos_svc;

-- ───────────────────────────── session children inherit the session ──
do $$
declare t text;
begin
  foreach t in array array[
    'assessment','fitting_feature','recommendation','assessment_delta',
    'outcome','report','scan','scan_derivation'
  ] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force  row level security', t);
    execute format('grant select, insert, update, delete on %I to fitos_app, fitos_svc', t);
  end loop;
end $$;

create policy tenant_isolation on assessment
  using (exists (select 1 from fitting_session s where s.id = fitting_session_id and s.organization_id = app_current_org()))
  with check (exists (select 1 from fitting_session s where s.id = fitting_session_id and s.organization_id = app_current_org()));
create policy tenant_isolation on fitting_feature
  using (exists (select 1 from fitting_session s where s.id = fitting_session_id and s.organization_id = app_current_org()))
  with check (exists (select 1 from fitting_session s where s.id = fitting_session_id and s.organization_id = app_current_org()));
create policy tenant_isolation on recommendation
  using (exists (select 1 from fitting_session s where s.id = fitting_session_id and s.organization_id = app_current_org()))
  with check (exists (select 1 from fitting_session s where s.id = fitting_session_id and s.organization_id = app_current_org()));
create policy tenant_isolation on assessment_delta
  using (exists (select 1 from fitting_session s where s.id = fitting_session_id and s.organization_id = app_current_org()))
  with check (exists (select 1 from fitting_session s where s.id = fitting_session_id and s.organization_id = app_current_org()));
create policy tenant_isolation on outcome
  using (exists (select 1 from fitting_session s where s.id = fitting_session_id and s.organization_id = app_current_org()))
  with check (exists (select 1 from fitting_session s where s.id = fitting_session_id and s.organization_id = app_current_org()));
create policy tenant_isolation on report
  using (exists (select 1 from fitting_session s where s.id = fitting_session_id and s.organization_id = app_current_org()))
  with check (exists (select 1 from fitting_session s where s.id = fitting_session_id and s.organization_id = app_current_org()));
create policy tenant_isolation on scan
  using (exists (select 1 from fitting_session s where s.id = fitting_session_id and s.organization_id = app_current_org()))
  with check (exists (select 1 from fitting_session s where s.id = fitting_session_id and s.organization_id = app_current_org()));
create policy tenant_isolation on scan_derivation
  using (exists (select 1 from scan sc join fitting_session s on s.id = sc.fitting_session_id
                  where sc.id = scan_id and s.organization_id = app_current_org()))
  with check (exists (select 1 from scan sc join fitting_session s on s.id = sc.fitting_session_id
                       where sc.id = scan_id and s.organization_id = app_current_org()));

-- ──────────────────────────────────────────────────── consent ──
alter table consent_record enable row level security;
alter table consent_record force  row level security;
create policy tenant_isolation on consent_record
  using (organization_customer_id is null or exists (
          select 1 from organization_customer c
           where c.id = organization_customer_id and c.organization_id = app_current_org()))
  with check (organization_customer_id is null or exists (
          select 1 from organization_customer c
           where c.id = organization_customer_id and c.organization_id = app_current_org()));
grant select, insert on consent_record to fitos_app, fitos_svc;

-- ─────────────────────────────── identity: no retailer-facing path ──
-- The application role cannot read person_identity or identity_resolution at
-- all. Resolution runs in an isolated service with its own credentials and its
-- own audit log; knowing two records are the same person must never become a
-- query a retailer's session can make.
alter table person_identity     enable row level security;
alter table person_identity     force  row level security;
alter table identity_resolution enable row level security;
alter table identity_resolution force  row level security;
grant select, insert, update on person_identity, identity_resolution to fitos_svc;
revoke all on person_identity, identity_resolution from fitos_app;

-- ──────────────────────────────── global catalog is shared, read-only ──
grant select on product_model, product_variant to fitos_app, fitos_svc;
grant select on consent_current to fitos_app, fitos_svc;
grant select, insert on report_view to fitos_app, fitos_svc;
grant select, insert on device_health_event to fitos_svc;
grant select on device to fitos_app, fitos_svc;
grant usage on schema public to fitos_app, fitos_svc;

-- The service role performs seeding, migrations-adjacent data work and identity
-- resolution. BYPASSRLS alone is not enough — it still needs table privileges,
-- and granting them explicitly is what keeps the separation auditable.
grant insert, update, delete, truncate on organization to fitos_svc;
grant delete, truncate on
  location, app_user, organization_customer, fitting_session, location_inventory,
  follow_up, pilot_feedback, device_installation, location_customer_access,
  consent_record, assessment, fitting_feature, recommendation, assessment_delta,
  outcome, report, scan, scan_derivation
  to fitos_svc;
grant insert, update, delete on product_model, product_variant to fitos_svc;
grant delete on person_identity, identity_resolution to fitos_svc;
grant insert, update, delete on device, feature_schema_version to fitos_svc;
