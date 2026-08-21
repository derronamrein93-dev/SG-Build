-- 0014 · the persisted explanation.
--
-- recommendation.products_considered is uuid[] -- ids only, no scores, no
-- reasons. "Why did FitOS recommend this shoe at that time" cannot be answered
-- today even approximately. This table is the answer, frozen at generation.
create table recommendation_candidate (
  id                uuid primary key default gen_random_uuid(),
  recommendation_id uuid not null references recommendation(id) on delete cascade,
  -- Denormalised so the policy is a simple predicate, the same move
  -- location_customer_access and report_view already use to avoid recursion.
  organization_id   uuid not null references organization(id) on delete cascade,
  product_model_id  uuid not null references product_model(id),

  rank              integer,
  eliminated        boolean not null default false,
  elimination_reason text,
  overall_score     numeric check (overall_score >= 0 and overall_score <= 1),
  scored_dimension_count integer not null default 0,
  scoring_version   text not null,

  hard_constraints  jsonb not null default '[]'::jsonb,
  dimensions        jsonb not null default '[]'::jsonb,
  considerations    jsonb not null default '[]'::jsonb,
  -- The attribute values and weights AS THEY WERE. A later catalog edit or a
  -- weight change must not rewrite a historical explanation.
  catalog_snapshot  jsonb not null default '{}'::jsonb,
  weights_snapshot  jsonb not null default '{}'::jsonb,
  created_at        timestamptz not null default now(),

  -- Eliminated candidates carry no rank or score and must say why; ranked
  -- candidates must carry both. This is what lets the panel answer "why NOT
  -- this shoe" without a second code path.
  constraint eliminated_shape check (
    (eliminated and rank is null and overall_score is null and elimination_reason is not null)
    or (not eliminated and rank is not null))
);

create index recommendation_candidate_rec on recommendation_candidate (recommendation_id, rank);

alter table recommendation_candidate enable row level security;
alter table recommendation_candidate force  row level security;
create policy recommendation_candidate_select on recommendation_candidate
  for select using (organization_id = app_current_org());
create policy recommendation_candidate_insert on recommendation_candidate
  for insert with check (organization_id = app_current_org());

-- Append-only: an explanation is a record of a decision, not a document.
grant select on recommendation_candidate to fitos_app, fitos_svc;
grant insert (recommendation_id, organization_id, product_model_id, rank, eliminated,
              elimination_reason, overall_score, scored_dimension_count, scoring_version,
              hard_constraints, dimensions, considerations, catalog_snapshot, weights_snapshot)
  on recommendation_candidate to fitos_app, fitos_svc;
