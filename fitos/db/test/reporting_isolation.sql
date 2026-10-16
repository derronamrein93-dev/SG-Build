-- Execute after db/test/isolation.sql has seeded both organizations.
-- This is a separate destructive scratch-database test, not a production migration.
\set ON_ERROR_STOP on
set role fitos_svc;
insert into retail_sale (id,organization_id,location_id,source,external_transaction_id,
 occurred_at,subtotal,total) values
 ('aaaaaaaa-aaaa-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001',
  'aaaaaaaa-1111-0000-0000-000000000001','test','sale-a1',now(),100,100),
 ('aaaaaaaa-aaaa-0000-0000-000000000002','aaaaaaaa-0000-0000-0000-000000000001',
  'aaaaaaaa-1111-0000-0000-000000000002','test','sale-a2',now(),200,200),
 ('bbbbbbbb-aaaa-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-000000000001',
  'bbbbbbbb-1111-0000-0000-000000000001','test','sale-b1',now(),300,300);
insert into retail_sale_line (sale_id,line_number,quantity,unit_price) values
 ('aaaaaaaa-aaaa-0000-0000-000000000001',1,1,100),
 ('aaaaaaaa-aaaa-0000-0000-000000000002',1,1,200),
 ('bbbbbbbb-aaaa-0000-0000-000000000001',1,1,300);
set role fitos_app;
set app.organization_id = 'aaaaaaaa-0000-0000-000000000001';
set app.location_id = 'aaaaaaaa-1111-0000-0000-000000000001';
set app.bypass_location_scope = 'false';

do $$
declare n integer;
begin
 select count(*) into n from retail_sale;
 if n <> 1 then raise exception 'Location A1 can read % sales; expected 1',n; end if;
 select count(*) into n from retail_sale_line;
 if n <> 1 then raise exception 'Location A1 can read % lines; expected 1',n; end if;
 begin
  insert into retail_sale (organization_id,location_id,source,external_transaction_id,
    occurred_at,subtotal,total)
   values ('aaaaaaaa-0000-0000-0000-000000000001',
    'aaaaaaaa-1111-0000-0000-000000000002','test','forged',now(),10,10);
  raise exception 'Cross-store sale insert unexpectedly succeeded';
 exception when insufficient_privilege or check_violation then null;
 end;
 begin
  insert into fitting_sale_attribution
   (fitting_session_id,sale_id,organization_id,location_id,method)
  values ('aaaaaaaa-4444-0000-0000-000000000001',
   'aaaaaaaa-aaaa-0000-0000-000000000002',
   'aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-1111-0000-0000-000000000001','explicit');
  raise exception 'Forged cross-store sale attribution unexpectedly succeeded';
 exception when foreign_key_violation or insufficient_privilege or check_violation then null;
 end;
end $$;
set app.bypass_location_scope = 'true';
do $$
declare n integer;
begin
 select count(*) into n from retail_sale;
 if n <> 2 then raise exception 'Org-wide scope read % sales; expected 2',n; end if;
end $$;
reset role;
\echo 'Reporting isolation assertions passed'
