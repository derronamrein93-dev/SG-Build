-- 0015 · the remaining snapshot columns.
--
-- 0014 froze the shoe side (catalog_snapshot) and the weights. These freeze the
-- customer side and the rendered reasons, so a historical explanation is
-- reconstructible from the row alone -- no join to a catalog that may have
-- changed, and no recomputation.
alter table recommendation_candidate
  -- What the customer needed, and from which source, at fitting time.
  add column requirement_snapshot jsonb not null default '{}'::jsonb,
  -- The strong-match sentences as they were shown. Rendered once, from the
  -- dimensions below, and never regenerated.
  add column reasons jsonb not null default '[]'::jsonb;

comment on column recommendation_candidate.requirement_snapshot is
  'Requirement profile used for scoring, with the source of each dimension.';
comment on column recommendation_candidate.reasons is
  'Strong-match statements as displayed. Derived from dimensions at generation.';

-- 0014 granted INSERT per column, and a column-level grant does not extend to
-- columns added later. Without this the whole insert fails with "permission
-- denied for table recommendation_candidate", which is a confusing error for a
-- missing column privilege.
grant insert (requirement_snapshot, reasons) on recommendation_candidate to fitos_app, fitos_svc;
