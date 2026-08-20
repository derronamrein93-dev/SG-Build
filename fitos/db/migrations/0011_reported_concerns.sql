-- =============================================================================
-- 0011 · customer-reported concerns
--
-- Pilot feedback after the three-question intake was accepted: "there should be
-- a place for people to key in specifics, like plantar fasciitis, or neuroma."
--
-- These are things the CUSTOMER SAID. They are not findings, not observations,
-- and not diagnoses. That distinction is the reason this is a separate column
-- rather than more values in discomfort_area:
--
--   discomfort_area answers "where does it hurt" and is filled in during a
--   conversation about the foot in front of you. reported_concerns answers
--   "what did the customer tell us they have". Merging them would make
--   "customer reported plantar fasciitis" indistinguishable from "associate
--   noted heel discomfort", and provenance is the whole safety story here.
--
-- text[] with a check constraint rather than an enum array, matching
-- discomfort_area, fit_priority, current_shoe_problem and risk_flags, which are
-- all text[]. Adding a value stays a one-line migration instead of an enum
-- alter, and the check still refuses anything off the list.
-- =============================================================================

alter table fitting_session
  add column reported_concerns text[] not null default '{}',
  add column reported_concern_other text;

alter table fitting_session
  add constraint fitting_session_reported_concerns_known
    check (reported_concerns <@ array[
      'plantar_fasciitis', 'neuroma', 'bunion', 'heel_pain', 'arch_pain',
      'forefoot_pain', 'toe_pressure', 'ankle_pain', 'knee_pain',
      'diabetes_neuropathy', 'orthotics_inserts', 'other']::text[]),

  -- Free text is capped and only meaningful alongside the 'other' chip. The
  -- length limit is a storage and display bound, not a validation of content:
  -- whatever the customer said is what gets stored.
  add constraint fitting_session_concern_other_length
    check (reported_concern_other is null or length(reported_concern_other) <= 200),

  add constraint fitting_session_concern_other_requires_chip
    check (reported_concern_other is null or 'other' = any(reported_concerns));

comment on column fitting_session.reported_concerns is
  'Customer-reported concerns, selected by the associate from a fixed list. '
  'Never a Stride Guide finding — see docs/05 "Customer-reported concerns".';
comment on column fitting_session.reported_concern_other is
  'Optional free text accompanying the "other" chip. Customer-reported, stored '
  'verbatim within 200 chars, never parsed and never fed to inference.';
