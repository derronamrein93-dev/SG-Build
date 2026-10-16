-- FitOS reporting foundation. Additive: existing outcome is associate-reported, not a verified sale.
-- Store timestamps in UTC; interpret report boundaries in the location timezone.
create table retail_visit (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references organization(id),
 location_id uuid not null references location(id),
 organization_customer_id uuid references organization_customer(id),
 visited_at timestamptz not null default now(),
 source text not null default 'associate',
 external_visit_id text,
 created_at timestamptz not null default now(),
 unique (organization_id, source, external_visit_id)
);
create table retail_sale (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references organization(id),
 location_id uuid not null references location(id),
 organization_customer_id uuid references organization_customer(id),
 source text not null,
 external_transaction_id text,
 occurred_at timestamptz not null,
 currency char(3) not null default 'USD',
 status text not null default 'completed' check (status in ('completed','voided')),
 subtotal numeric(14,2) not null check (subtotal >= 0),
 discount_total numeric(14,2) not null default 0 check (discount_total >= 0),
 tax_total numeric(14,2) not null default 0 check (tax_total >= 0),
 total numeric(14,2) not null check (total >= 0),
 recorded_at timestamptz not null default now(),
 unique (organization_id, source, external_transaction_id),
 unique (id, organization_id, location_id)
);
create table retail_sale_line (
 id uuid primary key default gen_random_uuid(),
 sale_id uuid not null references retail_sale(id),
 line_number integer not null check (line_number > 0),
 sku text, brand text, model text, shoe_size text,
 quantity numeric(12,3) not null check (quantity > 0),
 unit_price numeric(14,2) not null check (unit_price >= 0),
 discount numeric(14,2) not null default 0 check (discount >= 0),
 unique (sale_id, line_number),
 unique (id, sale_id)
);
create table retail_refund (
 id uuid primary key default gen_random_uuid(),
 sale_id uuid not null references retail_sale(id),
 sale_line_id uuid,
 source text not null,
 external_refund_id text,
 occurred_at timestamptz not null,
 quantity numeric(12,3) check (quantity is null or quantity > 0),
 amount numeric(14,2) not null check (amount >= 0),
 reason text,
 fit_related boolean,
 created_at timestamptz not null default now(),
 foreign key (sale_line_id, sale_id) references retail_sale_line(id, sale_id),
 unique (sale_id, source, external_refund_id)
);
create table fitting_sale_attribution (
 id uuid primary key default gen_random_uuid(),
 fitting_session_id uuid not null references fitting_session(id),
 sale_id uuid not null references retail_sale(id),
 method text not null check (method in ('explicit','pos_customer_match','time_window')),
 recorded_at timestamptz not null default now(),
 recorded_by_user_id uuid references app_user(id),
 unique (fitting_session_id, sale_id)
);
-- A retail visit can exist without any scan. Session-to-visit links are optional.
create table fitting_visit_link (
 fitting_session_id uuid primary key references fitting_session(id),
 visit_id uuid not null references retail_visit(id)
);
create index on retail_visit (organization_id, location_id, visited_at desc);
create index on retail_visit (organization_customer_id, visited_at desc);
create index on retail_sale (organization_id, location_id, occurred_at desc) where status = 'completed';
create index on retail_sale (organization_customer_id, occurred_at desc);
create index on retail_refund (sale_id, occurred_at desc);
create index on fitting_sale_attribution (sale_id);
-- Policies check BOTH sides of every relationship, preventing cross-store joins.
do $$
declare t text;
begin
 foreach t in array array['retail_visit','retail_sale','retail_sale_line','retail_refund','fitting_sale_attribution','fitting_visit_link'] loop
  execute format('alter table %I enable row level security',t);
  execute format('alter table %I force row level security',t);
  execute format('grant select, insert, update, delete on %I to fitos_app, fitos_svc',t);
 end loop;
end $$;
create policy visit_scope on retail_visit
 using (organization_id = app_current_org() and (location_id = app_current_location() or app_bypass_location_scope()) and (organization_customer_id is null or app_can_access_customer(organization_customer_id)))
 with check (organization_id = app_current_org() and (location_id = app_current_location() or app_bypass_location_scope()) and (organization_customer_id is null or app_can_access_customer(organization_customer_id)));
create policy sale_scope on retail_sale
 using (organization_id = app_current_org() and (location_id = app_current_location() or app_bypass_location_scope()) and (organization_customer_id is null or app_can_access_customer(organization_customer_id)))
 with check (organization_id = app_current_org() and (location_id = app_current_location() or app_bypass_location_scope()) and (organization_customer_id is null or app_can_access_customer(organization_customer_id)));
create policy line_scope on retail_sale_line
 using (exists (select 1 from retail_sale s where s.id = sale_id))
 with check (exists (select 1 from retail_sale s where s.id = sale_id));
create policy refund_scope on retail_refund
 using (exists (select 1 from retail_sale s where s.id = sale_id))
 with check (exists (select 1 from retail_sale s where s.id = sale_id));
create policy attribution_scope on fitting_sale_attribution
 using (exists (select 1 from fitting_session f join retail_sale s on s.id = sale_id where f.id = fitting_session_id and f.organization_id = s.organization_id and f.location_id = s.location_id and f.organization_id = app_current_org() and (f.location_id = app_current_location() or app_bypass_location_scope())))
 with check (exists (select 1 from fitting_session f join retail_sale s on s.id = sale_id where f.id = fitting_session_id and f.organization_id = s.organization_id and f.location_id = s.location_id and f.organization_id = app_current_org() and (f.location_id = app_current_location() or app_bypass_location_scope())));
create policy fitting_visit_scope on fitting_visit_link
 using (exists (select 1 from fitting_session f join retail_visit v on v.id = visit_id where f.id = fitting_session_id and f.organization_id = v.organization_id and f.location_id = v.location_id and f.organization_id = app_current_org() and (f.location_id = app_current_location() or app_bypass_location_scope())))
 with check (exists (select 1 from fitting_session f join retail_visit v on v.id = visit_id where f.id = fitting_session_id and f.organization_id = v.organization_id and f.location_id = v.location_id and f.organization_id = app_current_org() and (f.location_id = app_current_location() or app_bypass_location_scope())));
