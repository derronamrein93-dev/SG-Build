-- =============================================================================
-- 0005 · consent_record — close the person-scope read hole
--
-- The previous policy admitted "organization_customer_id is null or ...", which
-- left every scope='person' row readable by every tenant. Those rows carry
-- person_identity_id, and the application role is forbidden from reading
-- person_identity itself (see 0003) — so this leaked precisely what that
-- prohibition exists to protect: which identity, what was consented to, whether
-- it was granted or withdrawn, when, and by what method.
--
-- Organization-scoped rows: unchanged, scoped through their customer.
-- Person-scoped rows: scoped through the location that captured them.
--
-- Scoped rather than hidden outright. Hiding them from the application role is
-- the tighter reading of "identity belongs to resolution, not to retailers",
-- but the with-check would then reject any person-scoped consent written from
-- the tablet — and identity_resolution and portable_profile_share are consents
-- a customer plausibly grants mid-fitting, under the app role. A row with no
-- location resolves to visible-to-nobody, which is the correct failure
-- direction.
-- =============================================================================

drop policy tenant_isolation on consent_record;

create policy tenant_isolation on consent_record
  using (
    case
      when organization_customer_id is not null then exists (
        select 1 from organization_customer c
         where c.id = organization_customer_id
           and c.organization_id = app_current_org())
      else exists (
        select 1 from location l
         where l.id = location_id
           and l.organization_id = app_current_org())
    end)
  with check (
    case
      when organization_customer_id is not null then exists (
        select 1 from organization_customer c
         where c.id = organization_customer_id
           and c.organization_id = app_current_org())
      else exists (
        select 1 from location l
         where l.id = location_id
           and l.organization_id = app_current_org())
    end);
