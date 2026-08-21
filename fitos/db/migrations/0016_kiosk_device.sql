-- =============================================================================
-- Stride Guide FitOS — 0016 · kiosk device identity, enrollment, telemetry read
--
-- The pilot puts an iPad mini 2 on a pedestal in a store and lets a customer
-- drive it. That device needs an identity, and the identity it must NOT have is
-- an associate's. A kiosk left unattended on a shop floor is the least trusted
-- thing in the system: it is unlocked, it is in reach of the public, and it is
-- the one credential most likely to walk out of the building.
--
-- So the shape here is deliberately narrow:
--
--   organization → location → kiosk_device → (optional) Stride Guide `device`
--
-- and the kiosk's credential proves exactly one thing: which kiosk_device row
-- it is. Organization and location are read OFF that row, server-side, on every
-- request. The browser never sends a tenant id and could not be believed if it
-- did — the same rule `loadReportByToken` already follows for report tokens.
--
-- Three things are hashed rather than stored: the enrollment code, the device
-- credential, and the hardware ingest token. A database read must not mint a
-- working credential, which is the rule `report.access_token_hash` established.
--
-- PREREQUISITE: PostgreSQL 12 or later. `alter type ... add value` runs inside
-- a transaction block from 12 onward, and deploy/schema-bundle.sql wraps every
-- migration in one. The new value is not USED anywhere in this file, which is
-- the other half of that restriction.
-- =============================================================================

-- ────────────────────────────────────────────────── the acting user ──
-- fitting_session.user_id is NOT NULL and references app_user: every fitting
-- has an actor. A kiosk fitting has no human actor, and attributing it to a
-- real associate would be a lie in the audit trail — it would say a person was
-- standing there. Instead each kiosk gets its own app_user row with this role,
-- no pin_hash, and therefore no way to authenticate as a person.
alter type user_role add value if not exists 'kiosk_device';

create type kiosk_status as enum ('enrolled', 'suspended', 'revoked');

-- ───────────────────────────────────────────────────── kiosk_device ──
create table kiosk_device (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references organization(id) on delete cascade,
  location_id      uuid not null references location(id) on delete cascade,

  -- The app_user every write from this kiosk is attributed to. Created with the
  -- device, role 'kiosk_device', and never reused by a person.
  acting_user_id   uuid not null references app_user(id),

  display_name     text not null,
  status           kiosk_status not null default 'enrolled',

  -- sha256 of the bearer credential the browser holds in an httpOnly cookie.
  -- Revocation is bumping the version and clearing the hash; there is no
  -- long-lived plaintext anywhere, and no way back from the stored value.
  credential_hash    bytea,
  credential_version integer not null default 1,

  -- The Stride Guide unit this kiosk drives. Nullable: a kiosk can be enrolled
  -- before the hardware is installed, and it must show HARDWARE_OFFLINE rather
  -- than refuse to boot.
  stride_guide_device_id uuid references device(id) on delete set null,

  app_version      text,
  last_seen_at     timestamptz,
  enrolled_at      timestamptz not null default now(),
  revoked_at       timestamptz,

  -- A revoked kiosk has no credential. Stated as a constraint so "revoked" can
  -- never be a status flag that a stale hash quietly outlives.
  constraint revoked_has_no_credential
    check (status <> 'revoked' or credential_hash is null)
);
create unique index kiosk_device_credential on kiosk_device (credential_hash)
  where credential_hash is not null;
create index kiosk_device_location on kiosk_device (location_id, status);

-- ──────────────────────────────────────────── kiosk_enrollment_code ──
-- Short-lived, single-use, hashed. The plaintext exists once, on the screen the
-- authorized person is looking at, and is never written down by the server.
create table kiosk_enrollment_code (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid not null references organization(id) on delete cascade,
  location_id        uuid not null references location(id) on delete cascade,
  code_hash          bytea not null,
  display_name       text not null,
  stride_guide_device_id uuid references device(id) on delete set null,
  created_by_user_id uuid references app_user(id),
  created_at         timestamptz not null default now(),
  expires_at         timestamptz not null,
  consumed_at        timestamptz,
  consumed_by_kiosk_device_id uuid references kiosk_device(id) on delete set null,

  constraint consumed_shape check (
    (consumed_at is null and consumed_by_kiosk_device_id is null)
    or (consumed_at is not null and consumed_by_kiosk_device_id is not null))
);
create unique index kiosk_enrollment_code_hash on kiosk_enrollment_code (code_hash);
create index kiosk_enrollment_code_open on kiosk_enrollment_code (location_id, expires_at)
  where consumed_at is null;

-- ─────────────────────────────────────────── hardware ingest token ──
-- The ESP32 bridge posts normalized telemetry over HTTPS. It authenticates as
-- the INSTALLATION (this unit, at this location), not as the organization: a
-- token lifted off a bench unit must not be able to speak for another store.
alter table device_installation add column ingest_token_hash bytea;
create unique index device_installation_ingest_token
  on device_installation (ingest_token_hash) where ingest_token_hash is not null;

-- ───────────────────────────────────────────────────────────── RLS ──
alter table kiosk_device enable row level security;
alter table kiosk_device force  row level security;
create policy tenant_isolation on kiosk_device
  using (organization_id = app_current_org())
  with check (organization_id = app_current_org());
-- The application may read and touch last_seen_at/app_version. It may not mint
-- or rewrite a credential: enrollment and revocation run through fitos_svc.
grant select on kiosk_device to fitos_app, fitos_svc;
grant update (last_seen_at, app_version) on kiosk_device to fitos_app;
grant insert, update, delete on kiosk_device to fitos_svc;

alter table kiosk_enrollment_code enable row level security;
alter table kiosk_enrollment_code force  row level security;
create policy tenant_isolation on kiosk_enrollment_code
  using (organization_id = app_current_org())
  with check (organization_id = app_current_org());
-- fitos_app never sees enrollment codes at all: the browser presenting a code
-- has no tenant context yet, so redemption is necessarily a service-role,
-- hash-keyed lookup — the same shape as the report token path.
grant select, insert, update, delete on kiosk_enrollment_code to fitos_svc;

-- device_health_event had no policy because nothing read it. The kiosk reads it
-- now, so it gets one: scoped through the installation, which is already
-- org-scoped. Denormalising an organization_id onto a high-volume telemetry
-- table would be the faster predicate; the join is cheap enough at pilot rates
-- and keeps one owner for the fact "this unit belongs to this store".
alter table device_health_event enable row level security;
alter table device_health_event force  row level security;
create policy tenant_isolation on device_health_event
  using (exists (
    select 1 from device_installation di
     where di.device_id = device_health_event.device_id
       and di.organization_id = app_current_org()
       and di.removed_at is null));
grant select on device_health_event to fitos_app;

-- ─────────────────────────────────────────────── kiosk audit events ──
comment on table kiosk_device is
  'One iPad running the FitOS kiosk. Credential proves the row; org and location are read off the row, never sent by the client.';
comment on table kiosk_enrollment_code is
  'Short-lived single-use code that binds a kiosk to a location. Stored hashed; redeemed through the service role.';
