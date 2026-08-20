-- =============================================================================
-- 0010 · serialise per-retailer customer numbering
--
-- assign_local_customer_number() computed `max(local_customer_number) + 1` with
-- no lock. Two transactions inserting a customer for the same organization at
-- the same moment both read the same max and both write N+1, and the second one
-- fails on organization_customer_number_key.
--
-- In a store that is two associates at two tills creating a walk-in at the same
-- moment: rare, real, and it surfaces as an unexplainable error on the screen
-- that creates customers. It was found when a third test file began creating
-- customers concurrently and the suite started failing about one run in three.
--
-- The fix is a transaction-scoped advisory lock keyed on the organization, so
-- numbering serialises per retailer and never across retailers. Released
-- automatically at commit or rollback; nothing to leak.
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
end $$ language plpgsql;
