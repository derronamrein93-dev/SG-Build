-- Back to the invoker-rights version. Note that this restores the bug described
-- in 0017: creating a customer at a second location in the same organization
-- will fail on organization_customer_number_key.
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
grant create on schema public to fitos_owner;
alter function assign_local_customer_number() owner to fitos_owner;
