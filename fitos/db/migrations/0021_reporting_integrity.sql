-- Referential integrity across organization and store boundaries.
-- RLS limits visibility; these composite keys additionally prevent invalid links
-- written by privileged ingestion or service processes.
alter table organization_customer add constraint reporting_customer_org_key unique (id, organization_id);
alter table location add constraint reporting_location_org_key unique (id, organization_id);
alter table fitting_session add constraint reporting_session_scope_key unique (id, organization_id, location_id);
alter table retail_visit add constraint reporting_visit_scope_key unique (id, organization_id, location_id);
alter table retail_visit add constraint reporting_visit_location_fk
 foreign key (location_id, organization_id) references location(id, organization_id);
alter table retail_visit add constraint reporting_visit_customer_fk
 foreign key (organization_customer_id, organization_id) references organization_customer(id, organization_id);
alter table retail_sale add constraint reporting_sale_location_fk
 foreign key (location_id, organization_id) references location(id, organization_id);
alter table retail_sale add constraint reporting_sale_customer_fk
 foreign key (organization_customer_id, organization_id) references organization_customer(id, organization_id);
-- Keep attribution denormalized for declarative composite foreign keys.
alter table fitting_sale_attribution
 add column organization_id uuid,
 add column location_id uuid;
-- The first release contains no persisted attribution records yet.
alter table fitting_sale_attribution alter column organization_id set not null;
alter table fitting_sale_attribution alter column location_id set not null;
alter table fitting_sale_attribution add constraint reporting_attribution_session_fk
 foreign key (fitting_session_id, organization_id, location_id)
 references fitting_session(id, organization_id, location_id);
alter table fitting_sale_attribution add constraint reporting_attribution_sale_fk
 foreign key (sale_id, organization_id, location_id)
 references retail_sale(id, organization_id, location_id);
alter table fitting_visit_link add column organization_id uuid;
alter table fitting_visit_link add column location_id uuid;
alter table fitting_visit_link alter column organization_id set not null;
alter table fitting_visit_link alter column location_id set not null;
alter table fitting_visit_link add constraint reporting_visitlink_session_fk
 foreign key (fitting_session_id, organization_id, location_id)
 references fitting_session(id, organization_id, location_id);
alter table fitting_visit_link add constraint reporting_visitlink_visit_fk
 foreign key (visit_id, organization_id, location_id)
 references retail_visit(id, organization_id, location_id);
-- Prevent direct RLS bypass by writing another location's IDs in link rows.
drop policy attribution_scope on fitting_sale_attribution;
create policy attribution_scope on fitting_sale_attribution
 using (organization_id = app_current_org() and (location_id = app_current_location() or app_bypass_location_scope()))
 with check (organization_id = app_current_org() and (location_id = app_current_location() or app_bypass_location_scope()));
drop policy fitting_visit_scope on fitting_visit_link;
create policy fitting_visit_scope on fitting_visit_link
 using (organization_id = app_current_org() and (location_id = app_current_location() or app_bypass_location_scope()))
 with check (organization_id = app_current_org() and (location_id = app_current_location() or app_bypass_location_scope()));
