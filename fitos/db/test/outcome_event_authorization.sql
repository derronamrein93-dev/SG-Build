-- Run after migrations as a privileged test role.
-- Structural authorization checks, not a substitute for multi-tenant fixture tests.
do $$
begin
  if not (select relrowsecurity and relforcerowsecurity
          from pg_class where oid = 'outcome_event'::regclass) then
    raise exception 'outcome_event must force RLS';
  end if;
  if has_table_privilege('fitos_app','outcome_event','UPDATE')
     or has_table_privilege('fitos_app','outcome_event','DELETE') then
    raise exception 'fitos_app must not mutate audit events';
  end if;
  if not has_table_privilege('fitos_app','outcome_event','SELECT')
     or not has_table_privilege('fitos_app','outcome_event','INSERT') then
    raise exception 'fitos_app requires read and append access';
  end if;
  if (select count(*) from pg_policies where tablename='outcome_event'
      and policyname in ('outcome_event_tenant','outcome_event_insert')) <> 2 then
    raise exception 'missing outcome_event access policies';
  end if;
end $$;
