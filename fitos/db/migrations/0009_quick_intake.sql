-- =============================================================================
-- 0009 · quick intake
--
-- Pilot-store feedback: the intake is too long, and the associate wants yes/no
-- questions only. The default retail flow becomes three binary questions (two
-- for a returning customer) and then measurement.
--
-- ADDITIVE ONLY. Every existing intake column stays exactly as it is —
-- shopping_purpose, discomfort_area, fit_priority, standing_hours_per_day and
-- the rest are still written by the optional "Add detail" panel, and are still
-- read by the recommendation engine and the report. The default UX stops asking
-- for them; the schema has not lost the ability to hold them.
-- =============================================================================

alter table fitting_session
  -- Which intake produced this session. 'quick' is the new default; 'detailed'
  -- records that the associate opened Add detail, so time-to-scan can be
  -- compared honestly between the two.
  add column intake_mode text not null default 'quick'
    check (intake_mode in ('quick', 'detailed')),

  -- New-customer questions. Nullable on purpose: null means "not asked", which
  -- is not the same as "No". The report prints only what was answered.
  add column intake_discomfort         boolean,
  add column intake_shoe_issue         boolean,
  add column intake_high_activity      boolean,

  -- Returning-customer questions. Separate columns rather than reusing the
  -- three above: "any new pain SINCE YOUR LAST VISIT" is a different claim from
  -- "any discomfort today", and collapsing them would quietly corrupt both.
  add column intake_new_discomfort_since_last boolean,
  add column intake_use_changed_since_last    boolean,

  -- The metric the redesign is judged on. Seconds from the intake appearing to
  -- Start Scan being pressed. Sits alongside time_to_recommendation_ms, which
  -- already works this way.
  add column intake_duration_seconds integer
    check (intake_duration_seconds is null or intake_duration_seconds >= 0);

comment on column fitting_session.intake_mode is
  'quick = the three-question default; detailed = the associate opened Add detail.';
comment on column fitting_session.intake_duration_seconds is
  'Customer lookup complete to Start Scan pressed. Target 15-30s.';
