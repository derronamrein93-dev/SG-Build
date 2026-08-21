alter table recommendation_candidate
  drop column if exists reasons,
  drop column if exists requirement_snapshot;
