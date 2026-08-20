-- Reverses 0009. Drops only columns 0009 added; no pre-existing intake column
-- is touched, because 0009 did not touch one.
--
-- Loses the quick-intake answers and the intake_duration_seconds measurements.
-- The pre-existing intake fields are unaffected either way.
alter table fitting_session
  drop column if exists intake_duration_seconds,
  drop column if exists intake_use_changed_since_last,
  drop column if exists intake_new_discomfort_since_last,
  drop column if exists intake_high_activity,
  drop column if exists intake_shoe_issue,
  drop column if exists intake_discomfort,
  drop column if exists intake_mode;
