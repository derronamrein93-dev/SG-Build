-- Reverses 0005, restoring the person-scope read hole exactly as it was.
-- A policy change reads no rows and writes none, so this is fully reversible.
drop policy tenant_isolation on consent_record;
create policy tenant_isolation on consent_record
  using (organization_customer_id is null or exists (
          select 1 from organization_customer c
           where c.id = organization_customer_id
             and c.organization_id = app_current_org()))
  with check (organization_customer_id is null or exists (
          select 1 from organization_customer c
           where c.id = organization_customer_id
             and c.organization_id = app_current_org()));
