-- =============================================================================
-- Stride Guide FitOS — 0001 · tenancy, identity, consent, authorization
-- Blueprint: docs/05-data-model.md §1–§12
--
-- Three independent controls, never collapsed into one flag:
--   IDENTITY       person_identity + identity_resolution   "is this the same person?"
--   CONSENT        consent_record                          "did they authorize this use?"
--   AUTHORIZATION  location_customer_access + RLS          "is this location allowed?"
-- =============================================================================

create extension if not exists pgcrypto;

-- ─────────────────────────────────────────────────────────── enums ──
create type org_type          as enum ('independent','chain','franchise','clinic','orthotics','enterprise','events');
create type org_plan          as enum ('pilot','design_partner','active','paused');
create type customer_access_default as enum ('creating_location','all_locations');
create type identity_participation  as enum ('none','resolution_only','portable_profile');
create type size_unit         as enum ('us','uk','eu');
create type retail_focus      as enum ('running','comfort','work','orthopedic','sporting_goods');
create type inventory_source  as enum ('none','csv','pos_export','api');
create type network_quality   as enum ('good','variable','poor');
create type user_role         as enum ('associate','manager','owner','org_admin');
create type identity_account_status as enum ('shadow','claimed','closed');
create type identification_method   as enum ('phone','name_dob','loyalty_id','anonymous');
create type resolution_state  as enum ('candidate_match','verified','linked','revoked');
create type resolution_actor  as enum ('system','customer','retailer','support');
create type verification_method as enum ('customer_confirmation','account_claim','support_review');
create type access_level      as enum ('full','fit_profile_only','none');
create type consent_scope     as enum ('organization','person');
create type consent_type      as enum ('fit_history_storage','receive_report','privacy_ack',
                                       'marketing_email','marketing_sms','identity_resolution',
                                       'portable_profile_share');
create type consent_method    as enum ('tablet_checkbox','verbal_attested','web_form','written','mystrideid_account');

-- ──────────────────────────────────────────────────── organization ──
create table organization (
  id                       uuid primary key default gen_random_uuid(),
  name                     text not null,
  legal_name               text,
  org_type                 org_type not null default 'independent',
  plan                     org_plan not null default 'pilot',
  -- Chain-wide recognition is opt-in. A retailer who has not thought about
  -- cross-location customer data does not accidentally get it.
  default_customer_access  customer_access_default not null default 'creating_location',
  identity_participation   identity_participation  not null default 'none',
  data_owner_terms_version text not null default 'terms-v0',
  settings                 jsonb not null default '{}'::jsonb,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz
);

create table location (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references organization(id) on delete cascade,
  name              text not null,
  address_line1     text, city text, region text, postal_code text, country text,
  phone             text not null,
  email             text not null,
  logo_url          text,
  timezone          text not null default 'America/Chicago',
  size_unit         size_unit not null default 'us',
  retail_focus      retail_focus[] not null default '{}',
  -- Phase 0 discovery capture (docs/09 §2) — these change the build, so they
  -- are columns, not notes in a doc somewhere.
  pos_system                   text,
  inventory_source             inventory_source,
  tracks_associate_attribution boolean,
  network_quality              network_quality,
  active            boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz
);
create index on location (organization_id);

create table app_user (
  id              uuid primary key default gen_random_uuid(),
  location_id     uuid not null references location(id) on delete cascade,
  organization_id uuid not null references organization(id) on delete cascade,
  first_name      text not null,
  last_name       text,
  role            user_role not null default 'associate',
  pin_hash        text,
  auth_user_id    uuid,
  active          boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz
);
create index on app_user (organization_id);

-- Staff who genuinely cover two doors. Grants access; does not change ownership.
create table user_location (
  user_id     uuid not null references app_user(id) on delete cascade,
  location_id uuid not null references location(id) on delete cascade,
  primary key (user_id, location_id)
);

-- ────────────────────────────────────────────────── person_identity ──
-- Global, optional, deliberately almost empty. No name, phone, email, fit data
-- or purchase history: a global table holding contact details for every
-- customer of every retailer would be the most attractive breach target in the
-- company. This one is close to worthless on its own, which is the design.
create table person_identity (
  id                   uuid primary key default gen_random_uuid(),
  identity_lookup_hash bytea not null,
  identity_key_version smallint not null default 1,
  account_status       identity_account_status not null default 'shadow',
  auth_user_id         uuid,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz
);
create unique index on person_identity (identity_lookup_hash, identity_key_version);

-- ─────────────────────────────────────────── organization_customer ──
-- What an associate means by "customer": the retailer relationship.
create table organization_customer (
  id                     uuid primary key default gen_random_uuid(),
  organization_id        uuid not null references organization(id) on delete cascade,
  created_at_location_id uuid not null references location(id),
  -- Nullable, and null is the normal state. Day 1 never sets it.
  person_identity_id     uuid references person_identity(id),
  local_customer_number  integer not null,
  first_name             text,
  last_name              text,
  -- HMAC under the ORGANIZATION's key, not a global one: with one global key
  -- two retailers' rows for the same person would produce identical hashes,
  -- which would let the platform correlate customers across retailers as a
  -- silent side effect of the schema.
  phone_lookup_hash      bytea,
  phone_encrypted        bytea,
  phone_last4            text,
  phone_key_version      smallint,
  email_lookup_hash      bytea,
  email_encrypted        bytea,
  age_range              text,
  is_minor               boolean not null default false,
  identification_method  identification_method not null default 'phone',
  anonymous              boolean not null default false,
  notes                  text,
  deleted_at             timestamptz,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz,
  constraint identified_customer_has_name
    check (anonymous or (first_name is not null and last_name is not null))
);
create unique index organization_customer_phone_key
  on organization_customer (organization_id, phone_lookup_hash)
  where phone_lookup_hash is not null and deleted_at is null;
create unique index organization_customer_number_key
  on organization_customer (organization_id, local_customer_number);

-- Per-organization customer numbering ("Customer #472").
create or replace function assign_local_customer_number() returns trigger as $$
begin
  if new.local_customer_number is null or new.local_customer_number = 0 then
    select coalesce(max(local_customer_number), 0) + 1
      into new.local_customer_number
      from organization_customer
     where organization_id = new.organization_id;
  end if;
  return new;
end $$ language plpgsql;

create trigger organization_customer_number
  before insert on organization_customer
  for each row execute function assign_local_customer_number();

-- ──────────────────────────────────────────── identity_resolution ──
-- A stateful resolution layer, not a link table. Two identical hashed phone
-- numbers must never cause two retailers to start sharing a customer history.
create table identity_resolution (
  id                       uuid primary key default gen_random_uuid(),
  organization_customer_id uuid not null references organization_customer(id) on delete cascade,
  person_identity_id       uuid not null references person_identity(id) on delete cascade,
  state                    resolution_state not null default 'candidate_match',
  evidence                 jsonb not null default '{}'::jsonb,
  proposed_by              resolution_actor not null default 'system',
  verified_by              verification_method,
  verified_at              timestamptz,
  revoked_at               timestamptz,
  revoked_reason           text,
  state_history            jsonb not null default '[]'::jsonb,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz,
  -- verified/linked require an actual verification event; the system may never
  -- promote its own guess.
  constraint verified_requires_method
    check (state in ('candidate_match','revoked') or verified_by is not null)
);
create unique index on identity_resolution (organization_customer_id, person_identity_id);

-- ───────────────────────────────────────── location_customer_access ──
-- Authorization, not ownership: grantable, revocable, auditable, per-location.
create table location_customer_access (
  id                       uuid primary key default gen_random_uuid(),
  -- Denormalized deliberately: this table's RLS policy must not reference
  -- organization_customer, whose own policy calls app_can_access_customer().
  -- Without this column the two policies recurse into each other.
  organization_id          uuid not null references organization(id) on delete cascade,
  organization_customer_id uuid not null references organization_customer(id) on delete cascade,
  location_id              uuid not null references location(id) on delete cascade,
  access_level             access_level not null default 'full',
  granted_by_user_id       uuid references app_user(id),
  granted_at               timestamptz not null default now(),
  revoked_at               timestamptz,
  reason                   text
);
create unique index location_customer_access_key
  on location_customer_access (organization_customer_id, location_id)
  where revoked_at is null;

-- Grant per organization policy at creation.
create or replace function grant_default_customer_access() returns trigger as $$
declare
  policy customer_access_default;
begin
  select default_customer_access into policy
    from organization where id = new.organization_id;

  if policy = 'all_locations' then
    insert into location_customer_access (organization_id, organization_customer_id, location_id)
    select new.organization_id, new.id, l.id
      from location l where l.organization_id = new.organization_id;
  else
    insert into location_customer_access (organization_id, organization_customer_id, location_id)
    values (new.organization_id, new.id, new.created_at_location_id);
  end if;
  return new;
end $$ language plpgsql;

create trigger organization_customer_default_access
  after insert on organization_customer
  for each row execute function grant_default_customer_access();

-- ─────────────────────────────────────────────────── consent_record ──
create table consent_record (
  id                       uuid primary key default gen_random_uuid(),
  scope                    consent_scope not null,
  organization_customer_id uuid references organization_customer(id) on delete cascade,
  person_identity_id       uuid references person_identity(id) on delete cascade,
  location_id              uuid references location(id),
  type                     consent_type not null,
  granted                  boolean not null,
  scope_detail             jsonb,
  consent_text_version     text not null,
  privacy_policy_version   text not null,
  method                   consent_method not null,
  captured_by_user_id      uuid references app_user(id),
  captured_at              timestamptz not null default now(),
  constraint consent_scope_subject check (
    (scope = 'organization' and organization_customer_id is not null) or
    (scope = 'person'       and person_identity_id is not null)
  )
);
create index on consent_record (organization_customer_id, type, captured_at desc);

-- Latest state per subject and type. Revocation appends; nothing is updated.
create view consent_current as
select distinct on (scope, organization_customer_id, person_identity_id, type)
       scope, organization_customer_id, person_identity_id, type, granted,
       consent_text_version, privacy_policy_version, captured_at
  from consent_record
 order by scope, organization_customer_id, person_identity_id, type, captured_at desc;
