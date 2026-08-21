/**
 * How evidence is named to a human. Data only — no imports, no logic.
 *
 * This lives apart from the scoring engine on purpose. The Why? panel renders a
 * persisted explanation and must not be able to recompute one, so it may not
 * import the engine (see NC03). It still needs the vocabulary, and a second
 * hand-kept copy of these maps inside the component would drift the first time
 * a source type was added. A leaf module with nothing behind it is safe for
 * both sides to import.
 */

/** Never present one source as another. */
export const LABEL_SOURCE: Record<string, string> = {
  pressure_measurement:         'Measured today',
  foot_measurement:             'Measured today',
  associate_observation:        'Observed during fitting',
  reported_concern:             'Customer reported',
  prior_fitting:                'Prior individual history',
  aggregate_outcome:            'Aggregated outcomes',
  manufacturer_technical_spec:  'Shoe technical specification',
  independent_measurement:      'Independent measurement',
  manual_reviewed_research:     'Reviewed research',
  retailer_structured_data:     'Retailer data',
  stride_guide_normalization:   'Stride Guide reviewed normalization',
  manufacturer_marketing_claim: 'Lower-confidence manufacturer claim',
  synthetic_fixture:            'Demonstration data',
  legacy_catalog_row:           'Catalog entry, unverified',
};

/**
 * The two kinds of unknown are different facts and read differently. Nothing
 * was recorded is not the same as we recorded it and do not trust it here.
 */
export const LABEL_UNKNOWN: Record<string, string> = {
  no_value:                   'No verified value available',
  below_confidence_threshold: 'Value exists, but its source was below the confidence required here',
  no_requirement:             'Not applicable to this fitting',
};

/** Dimension names as an associate says them. */
export const LABEL_DIMENSION: Record<string, string> = {
  use_case: 'Intended use', cushioning: 'Cushioning', support: 'Support',
  width_fit: 'Width', forefoot_room: 'Forefoot room', volume: 'Volume',
  heel_hold: 'Heel hold', orthotic_compatibility: 'Orthotic accommodation',
  flexibility: 'Flexibility',
};
