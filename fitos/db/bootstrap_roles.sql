-- Cluster-level roles. Run once as a superuser, before migrations.
-- fitos_app  — the application. RLS always applies; no BYPASSRLS, ever.
-- fitos_svc  — background jobs and identity resolution. Separated and audited.
do $$ begin
  if not exists (select 1 from pg_roles where rolname='fitos_app') then
    create role fitos_app nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname='fitos_svc') then
    create role fitos_svc nologin bypassrls;
  end if;
end $$;
