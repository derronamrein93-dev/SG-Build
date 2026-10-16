-- SMS proof of possession for identified fitting check-in.
-- Store no OTP and no plaintext phone; SMS delivery/validation belongs to provider.
create table customer_sms_verification (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references organization(id),
 location_id uuid not null references location(id),
 phone_lookup_hash bytea not null,
 phone_last4 char(4) not null,
 provider_challenge_id text,
 state text not null default 'pending' check (state in ('pending','verified','consumed','expired')),
 attempts integer not null default 0 check (attempts between 0 and 5),
 created_at timestamptz not null default now(),
 expires_at timestamptz not null default (now() + interval '10 minutes'),
 verified_at timestamptz,
 consumed_at timestamptz,
 fitting_session_id uuid references fitting_session(id),
 unique (id, organization_id, location_id)
);
create index customer_sms_verification_rate on customer_sms_verification
 (organization_id,phone_lookup_hash,created_at desc);
create index customer_sms_verification_expiry on customer_sms_verification (expires_at);
alter table customer_sms_verification enable row level security;
alter table customer_sms_verification force row level security;
grant select,insert,update on customer_sms_verification to fitos_app;
create policy customer_sms_scope on customer_sms_verification
 using (organization_id = app_current_org() and location_id = app_current_location())
 with check (organization_id = app_current_org() and location_id = app_current_location());
