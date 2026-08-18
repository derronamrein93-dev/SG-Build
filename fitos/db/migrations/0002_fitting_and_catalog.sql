-- =============================================================================
-- Stride Guide FitOS — 0002 · fitting session, canonical features, catalog
-- Blueprint: docs/05-data-model.md §13–§25
-- =============================================================================

create type session_status    as enum ('draft','in_progress','completed','voided');
create type void_reason       as enum ('test','mistaken_start','customer_withdrew','duplicate');
create type feature_source    as enum ('manual','sensor_derived','intake_inferred','imported','default');
create type override_reason   as enum ('disagrees_with_observation','poor_capture','customer_input','other');
create type evidence_strength as enum ('high','moderate','low');
create type rec_override_reason as enum ('customer_preference','associate_judgment','not_in_stock','budget','other');
create type outcome_kind      as enum ('purchased','purchased_other','considering','no_purchase','ordered');
create type follow_up_status  as enum ('scheduled','done','snoozed','cancelled');
create type capture_type      as enum ('static_stance','weight_shift','walk');
create type device_status     as enum ('provisioned','shipped','installed','rma','retired');
create type feedback_type     as enum ('bug','confusing','too_slow','wrong_recommendation','idea','praise');

-- ─────────────────────────────────────────────────── fitting_session ──
create table fitting_session (
  id                        uuid primary key default gen_random_uuid(),
  organization_id           uuid not null references organization(id) on delete cascade,
  location_id               uuid not null references location(id),
  organization_customer_id  uuid references organization_customer(id) on delete set null,
  user_id                   uuid not null references app_user(id),
  status                    session_status not null default 'draft',
  void_reason               void_reason,
  visit_number              integer,
  started_at                timestamptz not null default now(),
  completed_at              timestamptz,
  time_to_recommendation_ms integer,

  -- intake (1:1 with the session, always written and read together)
  shopping_purpose       text,
  current_shoe_problem   text[] not null default '{}',
  discomfort_area        text[] not null default '{}',
  discomfort_timing      text,
  activity_level         text,
  standing_hours_per_day text,
  current_shoe_brand     text,
  current_shoe_model     text,
  current_shoe_age       text,
  fit_priority           text[] not null default '{}',
  previous_return_reason text,
  uses_orthotics         text,
  shoe_wear_concern      text,
  intake_notes           text,
  need_summary           text,
  risk_flags             text[] not null default '{}',

  device_id                 text,
  draft_saved_at            timestamptz,
  draft_synced_at           timestamptz,
  assessment_schema_version text not null default 'assessment-1.0.0',
  created_at                timestamptz not null default now(),
  updated_at                timestamptz,
  -- Only completed sessions are historical fittings.
  constraint completed_has_timestamp
    check (status <> 'completed' or completed_at is not null)
);
create index on fitting_session (organization_customer_id, completed_at desc);
create index on fitting_session (location_id, status);

-- ──────────────────────────────────────────────────────── assessment ──
-- Human observation. One input to the feature model, not the model itself.
create table assessment (
  id                 uuid primary key default gen_random_uuid(),
  fitting_session_id uuid not null unique references fitting_session(id) on delete cascade,
  size_left          numeric(4,1),
  size_right         numeric(4,1),
  size_unit          size_unit not null default 'us',
  width              text,
  width_asymmetry    boolean not null default false,
  arch_type          text,
  foot_shape         text[] not null default '{}',
  pronation_tendency text,
  heel_slip_risk     text,
  toe_box_issue      text[] not null default '{}',
  wear_pattern       text,
  balance_concern    text,
  pressure_concern   text[] not null default '{}',
  -- the fitter's own call, captured before the engine's output is shown
  assoc_support_level    text,
  assoc_cushioning_level text,
  assoc_category         text,
  assoc_insole           text,
  assessment_notes   text,
  measured_at        timestamptz not null default now()
);

-- ─────────────────────────────────────────── canonical fit features ──
-- Manual observation and sensor derivation converge here. Everything below
-- this table survives the hardware unchanged.
create table fitting_feature (
  id                  uuid primary key default gen_random_uuid(),
  fitting_session_id  uuid not null references fitting_session(id) on delete cascade,
  feature_key         text not null,
  value_categorical   text,
  value_numeric       numeric,
  unit                text,
  -- provenance is first-class, not a loose jsonb blob
  source_type         feature_source not null,
  source_record_id    uuid,
  algorithm_version   text,
  quality             numeric check (quality is null or (quality >= 0 and quality <= 1)),
  captured_at         timestamptz not null default now(),
  overridden_by_user_id uuid references app_user(id),
  override_reason     override_reason,
  superseded_by       uuid references fitting_feature(id),
  constraint feature_has_a_value
    check (value_categorical is not null or value_numeric is not null)
);
create unique index fitting_feature_current_key
  on fitting_feature (fitting_session_id, feature_key)
  where superseded_by is null;

-- The feature dictionary. Additive-only within a major version: new keys may
-- appear, existing keys never change meaning or lose enum values.
create table feature_schema_version (
  version      text primary key,
  definitions  jsonb not null,
  released_at  timestamptz not null default now()
);

-- ────────────────────────────────────────────── scan (hardware) ──
-- Reserved now, used later. Raw captures are immutable.
create table scan (
  id                  uuid primary key default gen_random_uuid(),
  fitting_session_id  uuid not null references fitting_session(id) on delete cascade,
  device_id           uuid,
  device_installation_id uuid,
  firmware_version    text not null,
  calibration_version text not null,
  hardware_revision   text not null,
  capture_type        capture_type not null,
  raw_uri             text not null,
  raw_checksum        text not null,
  sample_rate_hz      integer,
  frame_count         integer,
  total_load_measured numeric,
  capture_quality     numeric,
  captured_at         timestamptz not null default now()
);

create table scan_derivation (
  id                uuid primary key default gen_random_uuid(),
  scan_id           uuid not null references scan(id) on delete cascade,
  algorithm_version text not null,
  derived           jsonb not null,
  quality_metrics   jsonb,
  is_current        boolean not null default true,
  derived_at        timestamptz not null default now()
);
create unique index on scan_derivation (scan_id) where is_current;

-- ──────────────────────────────────────────────────── recommendation ──
create table recommendation (
  id                 uuid primary key default gen_random_uuid(),
  fitting_session_id uuid not null references fitting_session(id) on delete cascade,
  fit_profile        jsonb not null,
  flags              text[] not null default '{}',
  evidence_strength  evidence_strength not null,
  evidence_detail    jsonb not null,
  -- five stamps: an August 2026 recommendation stays reproducible after the
  -- engine changes in 2027
  recommendation_engine_version text not null,
  rule_set_version              text not null,
  catalog_version               text not null,
  feature_schema_version        text not null,
  assessment_schema_version     text not null,
  fired_rule_ids     text[] not null default '{}',
  feature_snapshot   jsonb not null,
  talking_points     text[] not null default '{}',
  rationale          text not null,
  products_considered uuid[] not null default '{}',
  products_avoided   text[] not null default '{}',
  overridden         boolean not null default false,
  override_fields    jsonb,
  override_reason    rec_override_reason,
  created_at         timestamptz not null default now()
);
create index on recommendation (fitting_session_id, created_at desc);

create table assessment_delta (
  id                 uuid primary key default gen_random_uuid(),
  fitting_session_id uuid not null unique references fitting_session(id) on delete cascade,
  previous_session_id uuid not null references fitting_session(id),
  interval_days      integer not null,
  changes            jsonb not null,
  material_change    boolean not null default false,
  narrative          text
);

-- ────────────────────────────────────────────────────────── catalog ──
create table product_model (
  id               uuid primary key default gen_random_uuid(),
  brand            text not null,
  model            text not null,
  variant          text,
  model_year       integer,
  category         text not null,
  use_case         text[] not null default '{}',
  support_level    text not null,
  cushioning_level text not null,
  toe_box_shape    text,
  heel_structure   text,
  flexibility      text,
  volume           text,
  drop_mm          integer,
  weight_g         integer,
  removable_insole boolean not null default true,
  safety_toe       boolean not null default false,
  slip_resistant   boolean not null default false,
  waterproof       boolean not null default false,
  best_for         text[] not null default '{}',
  avoid_for        text[] not null default '{}',
  msrp             numeric(8,2),
  data_source      text not null default 'curated',
  verified_at      timestamptz,
  catalog_version  text not null default 'catalog-1.0.0'
);
create unique index on product_model (brand, model, coalesce(variant,''), coalesce(model_year,0));

create table product_variant (
  id               uuid primary key default gen_random_uuid(),
  product_model_id uuid not null references product_model(id) on delete cascade,
  gender           text,
  size             numeric(4,1),
  width            text,
  colorway         text,
  upc              text,
  manufacturer_sku text
);
create index on product_variant (product_model_id);

create table location_inventory (
  id                 uuid primary key default gen_random_uuid(),
  location_id        uuid not null references location(id) on delete cascade,
  organization_id    uuid not null references organization(id) on delete cascade,
  product_model_id   uuid not null references product_model(id),
  widths_stocked     text[] not null default '{}',
  size_low           numeric(4,1),
  size_high          numeric(4,1),
  retailer_sku       text,
  retail_price       numeric(8,2),
  stocked            boolean not null default true,
  quantity           integer,
  source             text not null default 'manual',
  last_synced_at     timestamptz,
  notes              text
);
create unique index on location_inventory (location_id, product_model_id);

-- ────────────────────────────────────── outcome, report, follow-up ──
create table outcome (
  id                       uuid primary key default gen_random_uuid(),
  fitting_session_id       uuid not null unique references fitting_session(id) on delete cascade,
  outcome                  outcome_kind not null,
  purchased_model_id       uuid references product_model(id),
  purchased_size           numeric(4,1),
  recommended_vs_purchased text,
  insole_attached          boolean not null default false,
  insole_type              text,
  sale_value               numeric(10,2),
  returned                 boolean,
  return_reason            text,
  returned_at              timestamptz,
  satisfaction             text,
  recorded_at              timestamptz not null default now()
);

create table report (
  id                       uuid primary key default gen_random_uuid(),
  fitting_session_id       uuid not null references fitting_session(id) on delete cascade,
  organization_customer_id uuid references organization_customer(id) on delete cascade,
  report_version           integer not null default 1,
  template_version         text not null default 'report-1.0.0',
  -- hashed: a database read cannot mint a working link
  access_token_hash        bytea not null,
  expires_at               timestamptz not null,
  revoked_at               timestamptz,
  generated_at             timestamptz not null default now(),
  emailed_at               timestamptz,
  printed_at               timestamptz,
  content_snapshot         jsonb not null
);
create unique index on report (access_token_hash);
create index on report (fitting_session_id, report_version desc);

create table report_view (
  id               uuid primary key default gen_random_uuid(),
  report_id        uuid not null references report(id) on delete cascade,
  viewed_at        timestamptz not null default now(),
  user_agent_class text,
  referrer_class   text
);

create table follow_up (
  id                       uuid primary key default gen_random_uuid(),
  organization_id          uuid not null references organization(id) on delete cascade,
  location_id              uuid not null references location(id),
  organization_customer_id uuid references organization_customer(id) on delete cascade,
  fitting_session_id       uuid references fitting_session(id) on delete cascade,
  follow_up_reason         text not null,
  follow_up_due_at         timestamptz not null,
  follow_up_status         follow_up_status not null default 'scheduled',
  channel                  text not null default 'in_store_reminder',
  completed_by_user_id     uuid references app_user(id),
  response                 text,
  response_note            text
);
create index on follow_up (location_id, follow_up_status, follow_up_due_at);

-- ─────────────────────────────────────────────── device and feedback ──
create table device (
  id                          uuid primary key default gen_random_uuid(),
  serial                      text not null unique,
  hardware_revision           text not null,
  manufactured_at             timestamptz,
  public_key                  text,
  current_firmware_version    text,
  current_calibration_version text,
  status                      device_status not null default 'provisioned'
);

create table device_installation (
  id              uuid primary key default gen_random_uuid(),
  device_id       uuid not null references device(id) on delete cascade,
  organization_id uuid not null references organization(id) on delete cascade,
  location_id     uuid not null references location(id) on delete cascade,
  installed_at    timestamptz not null default now(),
  removed_at      timestamptz,
  host_machine_id text
);

create table device_health_event (
  id                  uuid primary key default gen_random_uuid(),
  device_id           uuid not null references device(id) on delete cascade,
  event_type          text not null,
  firmware_version    text,
  calibration_version text,
  connectivity        text,
  signal_quality      numeric,
  component_status    jsonb,
  error_code          text,
  reported_at         timestamptz not null default now()
);
create index on device_health_event (device_id, reported_at desc);

create table pilot_feedback (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid not null references organization(id) on delete cascade,
  location_id        uuid references location(id),
  user_id            uuid references app_user(id),
  fitting_session_id uuid references fitting_session(id) on delete set null,
  type               feedback_type not null,
  screen             text,
  note               text,
  input_snapshot     jsonb,
  status             text not null default 'new',
  created_at         timestamptz not null default now()
);
