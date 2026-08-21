-- =============================================================================
-- 0017 · customer numbering must not depend on who is looking
--
-- A BUG FOUND BY THE KIOSK WORK, in code that predates it.
--
-- assign_local_customer_number() computes `max(local_customer_number) + 1` from
-- organization_customer. That table's policy is
--
--     organization_id = app_current_org() AND app_can_access_customer(id)
--
-- and app_can_access_customer() resolves through location_customer_access,
-- which by default grants the CREATING LOCATION only. So the trigger's max()
-- sees only the customers the inserting location may see. At a second location
-- it sees none, returns 1, and the insert fails on
-- organization_customer_number_key.
--
-- Reproduced directly: with app.location_id set to Grand Ave the query returns
-- max = 21; with it set to Lakeview, in the same organization, it returns null.
--
-- It has never fired because every existing code path runs at the one seeded
-- location. The kiosk is the first thing in FitOS with a per-location identity,
-- and creating a customer at a chain's second door fails on the first attempt.
--
-- The fix: numbering is a per-ORGANIZATION fact and must be computed from the
-- whole organization, not from the subset the current location is authorized to
-- read. So the function runs as fitos_svc, which has BYPASSRLS.
--
-- Why that is safe here, stated because SECURITY DEFINER deserves the argument:
--   - the body is fixed SQL, no dynamic statement, no caller-supplied string;
--   - it reads one aggregate and writes one integer into NEW;
--   - it cannot return a row, a customer, or anything else to the caller;
--   - search_path is pinned, so nothing resolves through a caller's schema;
--   - the advisory lock from 0010 is unchanged and still serialises per org.
--
-- The alternative — a per-organization counter table with its own policy — is a
-- better long-term shape and a larger change. This restores correct behaviour
-- without touching the tenancy model.
-- =============================================================================

create or replace function assign_local_customer_number() returns trigger as $$
begin
  if new.local_customer_number is null or new.local_customer_number = 0 then
    perform pg_advisory_xact_lock(
      hashtext('organization_customer_number'), hashtext(new.organization_id::text));
    select coalesce(max(local_customer_number), 0) + 1
      into new.local_customer_number
      from organization_customer
     where organization_id = new.organization_id;
  end if;
  return new;
end $$ language plpgsql security definer set search_path = public, pg_temp;

-- fitos_owner still owns every table; only this one function runs elevated, and
-- only far enough to count rows in the organization the row already belongs to.
--
-- Transferring ownership requires the incoming owner to be able to create in the
-- schema, so the grant is opened for exactly one statement and closed again.
-- Ownership survives the revoke; the ability to create anything else does not.
grant create on schema public to fitos_svc;
alter function assign_local_customer_number() owner to fitos_svc;
revoke create on schema public from fitos_svc;
