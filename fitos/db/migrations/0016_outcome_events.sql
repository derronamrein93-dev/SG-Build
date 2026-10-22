-- Append-only history of fitting-linked retail outcomes.
create table outcome_event (
  id uuid primary key default gen_random_uuid(),
  fitting_session_id uuid not null references fitting_session(id) on delete cascade,
  event_type text not null check (event_type in ('purchase_recorded','return_recorded','feedback_recorded')),
  outcome outcome_kind,
  sale_value numeric(10,2) check (sale_value is null or sale_value >= 0),
  return_status text check (return_status in ('unknown','not_returned','returned')),
  return_reason text,
  satisfaction text,
  recorded_by_user_id uuid references app_user(id),
  recorded_at timestamptz not null default now()
);
create index outcome_event_session_date on outcome_event(fitting_session_id, recorded_at desc);
alter table outcome_event enable row level security;
alter table outcome_event force row level security;
create policy outcome_event_tenant on outcome_event
  for select using (
    exists (select 1 from fitting_session s join organization_customer c on c.id=s.organization_customer_id
      where s.id=fitting_session_id and s.organization_id=app_current_org()
        and app_can_access_customer(c.id))
  );
create policy outcome_event_insert on outcome_event
  for insert with check (
    exists (select 1 from fitting_session s join organization_customer c on c.id=s.organization_customer_id
      where s.id=fitting_session_id and s.organization_id=app_current_org()
        and app_can_access_customer(c.id))
  );
grant select, insert on outcome_event to fitos_app, fitos_svc;
-- Block mutation even when a privileged role is used inadvertently.
create function outcome_event_immutable() returns trigger language plpgsql as $$
begin raise exception 'outcome_event is append-only'; end $$;
create trigger outcome_event_no_update before update or delete on outcome_event
for each row execute function outcome_event_immutable();
