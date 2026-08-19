-- =============================================================================
-- 0006 · audit_log
--
-- Append-only, tenant-scoped record of consequential actions. Built now because
-- identity merge (a later step) is not reconstructible without it: a merge that
-- leaves no trail cannot be reversed or explained.
--
-- CLAUDE.md: "Log identifiers, not people." Nothing in here is meant to hold a
-- phone number, an email, a name, an address, or a raw token — and three
-- separate mechanisms are used to keep it that way, because a log is exactly
-- the place where PII accumulates by accident.
-- =============================================================================

-- ── Metadata safety: reject PII-shaped keys at any depth ────────────────────
-- A check constraint rather than application validation alone. The helper in
-- src/lib/db/audit.ts checks the same thing, but the helper can be bypassed and
-- the constraint cannot.
create or replace function audit_metadata_has_banned_key(m jsonb)
returns boolean as $$
declare k text; v jsonb;
begin
  if jsonb_typeof(m) = 'object' then
    for k, v in select * from jsonb_each(m) loop
      if lower(k) ~ '(phone|mobile|email|name|address|street|city|postal|zip|token|secret|password|passwd|pepper|ssn|dob|birth)' then
        return true;
      end if;
      if audit_metadata_has_banned_key(v) then return true; end if;
    end loop;
  elsif jsonb_typeof(m) = 'array' then
    for v in select * from jsonb_array_elements(m) loop
      if audit_metadata_has_banned_key(v) then return true; end if;
    end loop;
  end if;
  return false;
end $$ language plpgsql immutable;

-- The pattern is deliberately broad. It rejects `location_name` and
-- `product_name` as readily as `customer_name`, and that is the intended
-- trade-off: audit metadata carries ids and enums, so the fix for a rejected
-- key is to log `location_id` instead of `location_name`, not to loosen the
-- rule. A false positive is a rename; a false negative is a name in a log.

create table audit_log (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organization(id) on delete cascade,

  -- No foreign keys on the actor or location. Every other table here uses them,
  -- but an audit row must outlive the user or location it names: an
  -- `on delete set null` would erase the actor from the record of their own
  -- action, which is the one thing this table exists to remember.
  location_id     uuid,
  actor_user_id   uuid,
  actor_type      text not null default 'user'
                    check (actor_type in ('user', 'service', 'system')),

  -- namespace.event — e.g. customer_identity.merge_completed. Format is
  -- constrained; the vocabulary is not, because a whitelist here means a
  -- migration for every new event type. The authoritative list of names lives
  -- in src/lib/db/audit.ts.
  action          text not null check (action ~ '^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$'),

  -- What was acted on, and (optionally) what it was acted on *with*. For a
  -- merge: subject is the surviving customer, target is the one merged away.
  subject_type    text not null check (subject_type ~ '^[a-z][a-z0-9_]*$'),
  subject_id      uuid,
  target_type     text check (target_type ~ '^[a-z][a-z0-9_]*$'),
  target_id       uuid,

  correlation_id  uuid,   -- groups events belonging to one operation
  request_id      text constraint audit_log_request_id_len check (length(request_id) <= 128),

  metadata        jsonb not null default '{}'::jsonb
                    constraint audit_log_metadata_is_object
                      check (jsonb_typeof(metadata) = 'object')
                    constraint audit_log_metadata_no_pii_keys
                      check (not audit_metadata_has_banned_key(metadata)),

  -- clock_timestamp(), not now(). now() is transaction start time, so two
  -- events written in one transaction would share a timestamp exactly. Still
  -- entirely server-generated: the column is excluded from the INSERT grant
  -- below, so no caller can supply or backdate it.
  created_at      timestamptz not null default clock_timestamp(),

  -- Ordering is `seq`, not `created_at`. clock_timestamp() is microsecond
  -- resolution, and two inserts in one transaction can and do land in the same
  -- microsecond — observed intermittently in AU10 before this column existed. A
  -- timestamp answers "when"; only a sequence answers "in what order", and a
  -- merge trail (requested → completed → reverted) is worthless without that.
  -- GENERATED ALWAYS refuses a caller-supplied value outright.
  seq             bigint generated always as identity
);

create unique index audit_log_seq on audit_log (seq);

create index audit_log_org_time     on audit_log (organization_id, created_at desc);
create index audit_log_subject      on audit_log (subject_type, subject_id);
create index audit_log_correlation  on audit_log (correlation_id) where correlation_id is not null;

-- ── RLS ─────────────────────────────────────────────────────────────────────
alter table audit_log enable row level security;
alter table audit_log force  row level security;

-- Two policies with explicit verbs rather than one FOR ALL policy. Permissive
-- policies are OR'd, so a FOR ALL policy would silently authorise UPDATE and
-- DELETE the moment anyone granted them. With no policy naming those verbs,
-- RLS denies them even if the grant is added later.
create policy audit_log_select on audit_log
  for select using (organization_id = app_current_org());

create policy audit_log_insert on audit_log
  for insert with check (organization_id = app_current_org());

-- ── Grants ──────────────────────────────────────────────────────────────────
-- Column-level INSERT, deliberately: `id` and `created_at` are absent, so the
-- server generates both and no caller can backdate an audit row. No UPDATE and
-- no DELETE grant to anyone — append-only is enforced by privilege and by the
-- absence of a policy, not by convention.
grant select on audit_log to fitos_app, fitos_svc;
grant insert (organization_id, location_id, actor_user_id, actor_type,
              action, subject_type, subject_id, target_type, target_id,
              correlation_id, request_id, metadata)
  on audit_log to fitos_app, fitos_svc;
