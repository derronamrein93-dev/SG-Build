-- Reverses 0011. Loses every recorded customer concern; the pre-existing intake
-- columns are untouched because 0011 did not touch one.
alter table fitting_session
  drop constraint if exists fitting_session_concern_other_requires_chip,
  drop constraint if exists fitting_session_concern_other_length,
  drop constraint if exists fitting_session_reported_concerns_known,
  drop column if exists reported_concern_other,
  drop column if exists reported_concerns;
