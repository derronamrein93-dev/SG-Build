-- 0013 · per-attribute provenance.
--
-- Provenance was per-row (product_model.data_source), so there was no way to say
-- "drop came from the spec sheet, toe box is our judgement, heel counter is
-- unknown". Confidence-aware explanation is impossible on that shape.
--
-- Global, like product_model: this describes shoes, not tenants. No RLS.
create type attribute_source as enum (
  'manufacturer_technical_spec',   -- a published spec sheet
  'independent_measurement',       -- somebody measured the shoe
  'manual_reviewed_research',      -- researched AND checked by a person
  'retailer_structured_data',      -- from a retailer feed
  'stride_guide_normalization',    -- our own REVIEWED judgement, see the check below
  'manufacturer_marketing_claim',  -- copy, not specification
  'outcome_derived',               -- reserved; nothing writes this yet
  'synthetic_fixture');            -- test data, never a real catalog row

create type attribute_review as enum ('unreviewed','accepted','disputed','rejected');

create table shoe_attribute_evidence (
  id               uuid primary key default gen_random_uuid(),
  product_model_id uuid not null references product_model(id) on delete cascade,
  attribute_name   text not null,
  value_text       text,
  value_numeric    numeric,
  source_type      attribute_source not null,
  source_url       text,
  source_name      text,
  captured_at      timestamptz not null default now(),
  confidence       numeric not null check (confidence >= 0 and confidence <= 1),
  reviewed_by      uuid,
  review_status    attribute_review not null default 'unreviewed',
  superseded_by    uuid references shoe_attribute_evidence(id),
  created_at       timestamptz not null default now(),

  -- A value must actually be a value.
  constraint evidence_has_a_value
    check (value_text is not null or value_numeric is not null),

  -- A Stride Guide normalization is a REVIEWED judgement. This makes it
  -- impossible to label an unreviewed guess as one -- the distinction between
  -- "we decided this" and "something asserted this" is the whole point of the
  -- table, and a convention would not survive contact with a bulk import.
  constraint normalization_requires_review
    check (source_type <> 'stride_guide_normalization' or review_status <> 'unreviewed'),

  -- Marketing copy is not specification, and must never be dressed as one.
  constraint marketing_confidence_ceiling
    check (source_type <> 'manufacturer_marketing_claim' or confidence <= 0.40)
);

-- One current row per attribute; history kept via superseded_by, the same
-- append-only shape as fitting_feature.
create unique index shoe_attribute_evidence_current
  on shoe_attribute_evidence (product_model_id, attribute_name)
  where superseded_by is null;
create index shoe_attribute_evidence_model on shoe_attribute_evidence (product_model_id);

grant select on shoe_attribute_evidence to fitos_app, fitos_svc;
grant insert, update on shoe_attribute_evidence to fitos_svc;
