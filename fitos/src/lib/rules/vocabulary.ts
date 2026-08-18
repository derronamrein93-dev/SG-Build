/**
 * Canonical vocabulary — docs/03 §2, docs/05 §15.
 *
 * Rules vote only on these attributes. The closed vocabulary is what makes a
 * fit profile portable to the hardware, the report and any catalog.
 */

export const ATTRIBUTES = {
  support_level:    ['neutral', 'light_stability', 'stability', 'max_support'],
  cushioning_level: ['firm', 'moderate', 'plush', 'max'],
  width:            ['standard', 'wide', 'extra_wide'],
  volume:           ['low', 'standard', 'high'],
  toe_box:          ['standard', 'roomy', 'wide_round'],
  heel_fit:         ['standard', 'secure_narrow', 'structured'],
  category: [
    'running_neutral', 'running_stability', 'walking_comfort', 'work_support',
    'work_safety', 'hiking', 'casual_comfort', 'orthopedic_friendly',
    'court_sport', 'kids',
  ],
  insole: ['none', 'cushion', 'arch_support', 'heel_cup', 'metatarsal', 'anti_fatigue'],
} as const;

export type AttributeKey = keyof typeof ATTRIBUTES;
export const ATTRIBUTE_KEYS = Object.keys(ATTRIBUTES) as AttributeKey[];

export type FitProfile = { [K in AttributeKey]: string };

export const FLAGS = [
  'size_up_check', 'size_asymmetry', 'removable_insole_required', 'break_in_guidance',
  'lacing_guidance', 'rotation_guidance', 'walk_test_required', 'referral_suggested',
  'extended_check_in', 'value_framing', 'seam_free_preferred', 'gait_review',
] as const;
export type Flag = (typeof FLAGS)[number];

/**
 * Signals that drive evidence strength (docs/03 §3). Primary signals are the
 * ones whose absence genuinely weakens a recommendation.
 */
export const PRIMARY_SIGNALS = [
  'purpose', 'discomfort_area', 'arch_type', 'width', 'pronation_tendency', 'wear_pattern',
] as const;

export const SECONDARY_SIGNALS = [
  'standing_hours', 'activity_level', 'fit_priority', 'current_shoe_age', 'previous_return_reason',
] as const;

/** Feature dictionary version. Additive-only within a major version. */
export const FEATURE_SCHEMA_VERSION = 'feature-1.0.0';
export const ENGINE_VERSION = 'engine-1.0.0';

/** Language guardrails — docs/03 §4. Enforced in code, not in a prompt. */
export const BANNED_TERMS = [
  'diagnose', 'diagnosis', 'treat', 'treatment', 'cure', 'correct your',
  'prevent injury', 'plantar fasciitis', 'tendonitis', 'neuroma', 'arthritis',
  'medically recommended', 'orthopedically necessary', 'will fix',
];

export function violatesGuardrails(text: string): string[] {
  const lower = text.toLowerCase();
  return BANNED_TERMS.filter((t) => lower.includes(t));
}
