-- Reverses 0010, restoring the unlocked numbering. Reintroduces the race: two
-- concurrent inserts for one organization can collide on
-- organization_customer_number_key.
create or replace function assign_local_customer_number() returns trigger as $$
begin
  if new.local_customer_number is null or new.local_customer_number = 0 then
    select coalesce(max(local_customer_number), 0) + 1
      into new.local_customer_number
      from organization_customer
     where organization_id = new.organization_id;
  end if;
  return new;
end $$ language plpgsql;
