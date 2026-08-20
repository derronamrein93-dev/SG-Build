/**
 * Recommendation engine — the six-stage contract from docs/03 §1.
 *
 *   observed_features → derived_fit_profile → product_requirements
 *                     → candidate_products → ranking → explanation
 *
 * Deterministic by design: no network, no model, no randomness. A language
 * model may later render `explanation` prose, but it may never alter a value
 * produced here (docs/07 §3).
 */
import ruleData from './rules.json';
import {
  ATTRIBUTES, ATTRIBUTE_KEYS, AttributeKey, FitProfile,
  PRIMARY_SIGNALS, SECONDARY_SIGNALS, ENGINE_VERSION, FEATURE_SCHEMA_VERSION,
} from './vocabulary';

// ─────────────────────────────────────────────────────────── types ──

export type FeatureSource = 'manual' | 'sensor_derived' | 'intake_inferred' | 'imported' | 'default';

export interface ObservedFeature {
  key: string;
  // boolean joins the union for the quick-intake answers. They are genuinely
  // binary; encoding them as 'yes'/'no' strings would invite a truthiness bug
  // the first time someone wrote `if (f.value)` against 'no'.
  value: string | number | boolean | string[];
  source: FeatureSource;
  algorithmVersion?: string;
  quality?: number;
}

export type ObservedFeatures = Record<string, ObservedFeature>;

export interface Condition {
  field: string;
  in?: string[];
  not_in?: string[];
  includes?: string;
  includes_any?: string[];
  gte?: number;
  lte?: number;
}

export interface Rule {
  id: string;
  name: string;
  when: { all?: Condition[]; any?: Condition[] };
  then: Partial<Record<AttributeKey, Record<string, number>>>;
  flags?: string[];
  say: string;
  report: string;
  upsell?: string;
  guard?: string;
}

export type EvidenceStrength = 'high' | 'moderate' | 'low';

export interface Conflict { attribute: string; between: [string, string]; resolution: string; }

export interface ProductRequirements {
  category: string;
  supportStructure: string;
  cushioning: string;
  lastWidth: string;
  toeBox: string;
  heelStructure: string;
  volume: string;
  removableInsoleRequired: boolean;
  excludeCategories: string[];
}

export interface Candidate {
  productModelId: string;
  brand: string;
  model: string;
  score: number;
  reasons: string[];
  misses: string[];
}

export interface Recommendation {
  fitProfile: FitProfile;
  flags: string[];
  evidenceStrength: EvidenceStrength;
  evidenceDetail: {
    missingPrimary: string[];
    presentPrimary: string[];
    missingSecondary: string[];
    supportMargin: number;
    cushioningMargin: number;
    conflicts: Conflict[];
    reason: string;
  };
  productRequirements: ProductRequirements;
  candidates: Candidate[];
  avoid: string[];
  talkingPoints: string[];
  rationale: string;
  upsells: string[];
  firedRuleIds: string[];
  tallies: Record<string, Record<string, number>>;
  versions: {
    recommendation_engine_version: string;
    rule_set_version: string;
    catalog_version: string;
    feature_schema_version: string;
    assessment_schema_version: string;
  };
  featureSnapshot: ObservedFeatures;
}

export interface CatalogItem {
  productModelId: string;
  brand: string;
  model: string;
  category: string;
  supportLevel: string;
  cushioningLevel: string;
  widthsStocked: string[];
  toeBoxShape?: string;
  heelStructure?: string;
  volume?: string;
  removableInsole: boolean;
  bestFor?: string[];
}

const RULES = ruleData.rules as Rule[];
export const RULE_SET_VERSION = ruleData.rule_set_version;

// ───────────────────────────────────────── stage 1 · observed features ──

/** Intake + assessment → canonical, provenanced features. Sensor derivations
 *  land in the same shape, which is why the engine never learns about hardware. */
export function toObservedFeatures(
  intake: Record<string, unknown>,
  assessment: Record<string, unknown>,
): ObservedFeatures {
  const out: ObservedFeatures = {};
  const put = (key: string, value: unknown, source: FeatureSource) => {
    if (value === undefined || value === null || value === '') return;
    if (Array.isArray(value) && value.length === 0) return;
    out[key] = { key, value: value as string | number | string[], source };
  };

  put('purpose', intake.shopping_purpose, 'intake_inferred');
  put('discomfort_area', intake.discomfort_area, 'intake_inferred');
  put('discomfort_timing', intake.discomfort_timing, 'intake_inferred');
  put('activity_level', intake.activity_level, 'intake_inferred');
  put('standing_hours', intake.standing_hours_per_day, 'intake_inferred');
  put('current_shoe_problem', intake.current_shoe_problem, 'intake_inferred');
  put('current_shoe_age', intake.current_shoe_age, 'intake_inferred');
  put('fit_priority', intake.fit_priority, 'intake_inferred');
  put('previous_return_reason', intake.previous_return_reason, 'intake_inferred');
  put('uses_orthotics', intake.uses_orthotics, 'intake_inferred');
  put('red_flags', intake.red_flags, 'intake_inferred');

  // Quick intake. Booleans, so `put`'s empty-value guard would drop a legitimate
  // false — passed through explicitly instead. Null still means "not asked".
  for (const k of ['intake_discomfort', 'intake_shoe_issue', 'intake_high_activity',
                   'intake_new_discomfort_since_last', 'intake_use_changed_since_last']) {
    if (typeof intake[k] === 'boolean') {
      out[k] = { key: k, value: intake[k] as boolean, source: 'intake_inferred' };
    }
  }
  put('age_range', intake.age_range, 'intake_inferred');

  put('arch_type', assessment.arch_type, 'manual');
  put('width', assessment.width, 'manual');
  put('foot_shape', assessment.foot_shape, 'manual');
  put('pronation_tendency', assessment.pronation_tendency, 'manual');
  put('heel_slip_risk', assessment.heel_slip_risk, 'manual');
  put('toe_box_issue', assessment.toe_box_issue, 'manual');
  put('balance_concern', assessment.balance_concern, 'manual');
  put('pressure_concern', assessment.pressure_concern, 'manual');

  // wear pattern may come from either side of the conversation
  const wear = assessment.wear_pattern ?? intake.shoe_wear_concern;
  put('wear_pattern', wear, assessment.wear_pattern ? 'manual' : 'intake_inferred');

  const left = Number(assessment.size_left);
  const right = Number(assessment.size_right);
  if (Number.isFinite(left) && Number.isFinite(right)) {
    put('size_left', left, 'manual');
    put('size_right', right, 'manual');
    put('size_asymmetry', Math.abs(left - right), 'manual');
  }
  return out;
}

// ───────────────────────────────────────────────── condition matching ──

function valueOf(features: ObservedFeatures, field: string): string | number | boolean | string[] | undefined {
  return features[field]?.value;
}

function matches(features: ObservedFeatures, c: Condition, derived: Record<string, string>): boolean {
  const raw = field(c.field, features, derived);
  if (raw === undefined) return false;
  const asArray = Array.isArray(raw) ? raw : [raw];

  if (c.in && !asArray.some((v) => c.in!.includes(String(v)))) return false;
  if (c.not_in && asArray.some((v) => c.not_in!.includes(String(v)))) return false;
  if (c.includes && !asArray.map(String).includes(c.includes)) return false;
  if (c.includes_any && !asArray.map(String).some((v) => c.includes_any!.includes(v))) return false;
  if (c.gte !== undefined && !(Number(raw) >= c.gte)) return false;
  if (c.lte !== undefined && !(Number(raw) <= c.lte)) return false;
  return true;
}

/** Two-pass fields: some rules read a value the first pass derived. */
function field(name: string, features: ObservedFeatures, derived: Record<string, string>) {
  if (name in derived) return derived[name];
  return valueOf(features, name);
}

function ruleFires(rule: Rule, features: ObservedFeatures, derived: Record<string, string>): boolean {
  const all = rule.when.all ?? [];
  const any = rule.when.any ?? [];
  if (all.length && !all.every((c) => matches(features, c, derived))) return false;
  if (any.length && !any.some((c) => matches(features, c, derived))) return false;
  return all.length > 0 || any.length > 0;
}

// ────────────────────────────────────── stage 2 · derived fit profile ──

const DEFAULTS: FitProfile = {
  support_level: 'neutral', cushioning_level: 'moderate', width: 'standard',
  volume: 'standard', toe_box: 'standard', heel_fit: 'standard',
  category: 'casual_comfort', insole: 'none',
};

/**
 * Baseline seeding — the identity mapping from observation to requirement.
 *
 * Found by walking a real fitting: an associate measured a wide foot and chose
 * "work" as the purpose, and neither reached the profile, because every rule in
 * the set encodes an *inference* and none encodes "what you measured is what you
 * need." Direct observations are not inferences and do not belong in the rule
 * file — they have no reasoning and deserve no talking point. They seed the
 * tally at weight 1 so any real rule (weight 2–3) still overrides them.
 */
const PURPOSE_CATEGORY: Record<string, string> = {
  running: 'running_neutral', walking: 'walking_comfort', work: 'work_support',
  hiking: 'hiking', kids: 'kids', casual: 'casual_comfort',
  sports: 'court_sport', orthopedic: 'orthopedic_friendly',
};

function seedFromObservations(features: ObservedFeatures) {
  const seed: Record<string, Record<string, number>> = {};
  const add = (attr: string, value: string, weight = 1) => {
    seed[attr] = seed[attr] ?? {};
    seed[attr][value] = (seed[attr][value] ?? 0) + weight;
  };

  const purpose = features.purpose?.value;
  if (typeof purpose === 'string' && PURPOSE_CATEGORY[purpose]) add('category', PURPOSE_CATEGORY[purpose]);

  const width = features.width?.value;
  if (width === 'wide') add('width', 'wide');
  if (width === 'extra_wide') add('width', 'extra_wide');

  const shape = features.foot_shape?.value;
  if (Array.isArray(shape)) {
    if (shape.includes('high_volume')) add('volume', 'high');
    if (shape.includes('low_volume')) add('volume', 'low');
  }

  // ── quick-intake context signals ──────────────────────────────────────────
  // Weight 0.25, deliberately a quarter of a direct observation and a tenth of
  // a rule. Three yes/no answers are the weakest thing in the pipeline: they
  // sit below pressure data, below measured size and width, below prior
  // fittings, and below what the associate sees with the shoe in their hand.
  // They are context, not diagnosis — a Yes says "ask about this", never "this
  // person has that condition", so nothing here votes on support or arch.
  const CONTEXT = 0.25;
  if (features.intake_discomfort?.value === true) add('cushioning_level', 'plush', CONTEXT);
  if (features.intake_high_activity?.value === true) add('cushioning_level', 'plush', CONTEXT);
  // intake_shoe_issue casts no vote at all. "Something is wrong with the
  // current shoes" is a prompt to look at the current shoes, and the looking is
  // what produces a signal worth acting on.

  return seed;
}

function tally(fired: Rule[], seed: Record<string, Record<string, number>> = {}) {
  const tallies: Record<string, Record<string, number>> = {};
  for (const key of ATTRIBUTE_KEYS) tallies[key] = { ...(seed[key] ?? {}) };
  for (const rule of fired) {
    for (const [attr, votes] of Object.entries(rule.then)) {
      for (const [value, weight] of Object.entries(votes as Record<string, number>)) {
        tallies[attr][value] = (tallies[attr][value] ?? 0) + weight;
      }
    }
  }
  return tallies;
}

function winner(votes: Record<string, number>, fallback: string) {
  const ranked = Object.entries(votes).filter(([, w]) => w > 0).sort((a, b) => b[1] - a[1]);
  if (!ranked.length) return { value: fallback, margin: 0 };
  const [top, second] = ranked;
  return { value: top[0], margin: top[1] - (second?.[1] ?? 0) };
}

// ─────────────────────────────────────────────── evidence strength ──

function detectConflicts(t: Record<string, Record<string, number>>, f: ObservedFeatures): Conflict[] {
  const conflicts: Conflict[] = [];
  const sup = t.support_level ?? {}; const cush = t.cushioning_level ?? {};

  if ((cush.max ?? 0) > 0 && (sup.max_support ?? 0) > 0)
    conflicts.push({ attribute: 'cushioning_level', between: ['max cushioning', 'max support'],
      resolution: 'Cushioned stability — carry both, and let the try-on decide.' });

  if ((t.width?.wide ?? 0) > 0 && (t.heel_fit?.secure_narrow ?? 0) > 0)
    conflicts.push({ attribute: 'width', between: ['wide forefoot', 'secure narrow heel'],
      resolution: 'Heel-to-forefoot mismatch: fit the forefoot, secure the heel with lacing.' });

  const roll = valueOf(f, 'pronation_tendency'); const wear = valueOf(f, 'wear_pattern');
  if (roll === 'outward' && wear === 'inner_edge')
    conflicts.push({ attribute: 'support_level', between: ['outward roll', 'inner-edge wear'],
      resolution: 'Data disagreement — re-check the wear pattern before deciding.' });

  const priority = valueOf(f, 'fit_priority');
  const wantsPrice = Array.isArray(priority) && priority.includes('price');
  if (wantsPrice && ((sup.max_support ?? 0) > 0 || (sup.stability ?? 0) >= 3))
    conflicts.push({ attribute: 'support_level', between: ['price priority', 'support need'],
      resolution: 'Offer the insole as the lower-cost route to support.' });

  return conflicts;
}

function evidence(
  features: ObservedFeatures, supportMargin: number, cushioningMargin: number, conflicts: Conflict[],
) {
  const presentPrimary = PRIMARY_SIGNALS.filter((s) => features[s] !== undefined);
  const missingPrimary = PRIMARY_SIGNALS.filter((s) => features[s] === undefined);
  const missingSecondary = SECONDARY_SIGNALS.filter((s) => features[s] === undefined);
  const contradiction = conflicts.some((c) => c.between.includes('outward roll'));
  const margin = Math.min(supportMargin, cushioningMargin);

  let strength: EvidenceStrength;
  let reason: string;
  if (contradiction || missingPrimary.length >= 2) {
    strength = 'low';
    reason = contradiction
      ? 'Two primary signals contradict each other'
      : `Missing ${missingPrimary.slice(0, 2).join(' and ')}`;
  } else if (missingPrimary.length === 1 || margin <= 1 || conflicts.length > 0) {
    strength = 'moderate';
    reason = missingPrimary.length === 1
      ? `${missingPrimary[0].replace(/_/g, ' ')} would sharpen this`
      : conflicts.length > 0 ? conflicts[0].resolution : 'Signals agree, but not strongly';
  } else {
    strength = 'high';
    reason = 'All primary signals present and agreeing';
  }
  return { strength, detail: { missingPrimary: [...missingPrimary], presentPrimary: [...presentPrimary],
    missingSecondary: [...missingSecondary], supportMargin, cushioningMargin, conflicts, reason } };
}

// ────────────────────────────────── stage 3 · product requirements ──

function toRequirements(profile: FitProfile, flags: string[], tallies: Record<string, Record<string, number>>): ProductRequirements {
  const exclude = ATTRIBUTE_KEYS.flatMap((k) =>
    Object.entries(tallies[k] ?? {}).filter(([, w]) => w < 0).map(([v]) => v));
  return {
    category: profile.category,
    supportStructure: profile.support_level,
    cushioning: profile.cushioning_level,
    lastWidth: profile.width,
    toeBox: profile.toe_box,
    heelStructure: profile.heel_fit,
    volume: profile.volume,
    removableInsoleRequired: flags.includes('removable_insole_required'),
    excludeCategories: exclude,
  };
}

// ──────────────────────────── stages 4 & 5 · candidates and ranking ──

export function rankCandidates(req: ProductRequirements, catalog: CatalogItem[]): Candidate[] {
  return catalog
    .filter((item) => !req.excludeCategories.includes(item.category))
    .filter((item) => !req.removableInsoleRequired || item.removableInsole)
    .map((item) => {
      const reasons: string[] = []; const misses: string[] = []; let score = 0;
      if (item.category === req.category) { score += 4; reasons.push('right category'); }
      if (item.supportLevel === req.supportStructure) { score += 3; reasons.push(`${req.supportStructure.replace(/_/g, ' ')} support`); }
      if (item.cushioningLevel === req.cushioning) { score += 3; reasons.push(`${req.cushioning} cushioning`); }
      if (req.lastWidth !== 'standard') {
        if (item.widthsStocked.includes(req.lastWidth)) { score += 3; reasons.push(`${req.lastWidth} width in stock`); }
        else misses.push(`no ${req.lastWidth} width`);
      }
      if (req.toeBox !== 'standard') {
        if (item.toeBoxShape === req.toeBox || item.toeBoxShape === 'wide_round') { score += 2; reasons.push('roomy toe box'); }
        else misses.push('toe box narrower than ideal');
      }
      if (req.heelStructure === 'structured' && item.heelStructure === 'structured') { score += 2; reasons.push('structured heel'); }
      if (req.removableInsoleRequired && item.removableInsole) reasons.push('takes your orthotic');
      return { productModelId: item.productModelId, brand: item.brand, model: item.model, score, reasons, misses };
    })
    .filter((c) => c.score > 0 && c.misses.length === 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);
}

/** Characteristics to steer away from — never a competitor's product name. */
function avoidList(profile: FitProfile, flags: string[]): string[] {
  const avoid: string[] = [];
  if (profile.support_level === 'max_support' || profile.support_level === 'stability')
    avoid.push('Soft foam without a stable base');
  if (profile.width !== 'standard') avoid.push('Narrow-last models');
  if (profile.cushioning_level === 'plush' || profile.cushioning_level === 'max')
    avoid.push('Minimalist or low-stack styles');
  if (flags.includes('removable_insole_required')) avoid.push('Shoes with a glued-in footbed');
  if (profile.toe_box === 'wide_round') avoid.push('Tapered or pointed toe shapes');
  return avoid.slice(0, 3);
}

// ────────────────────────────────────────────── stage 6 · explanation ──

const SUPPRESS_UPSELL = /SUPPRESS_UPSELL/;

function explain(fired: Rule[], profile: FitProfile) {
  const talkingPoints = fired.map((r) => r.say).slice(0, 4);
  const rationale = fired.map((r) => r.report).slice(0, 3).join(' ');
  const suppressed = fired.some((r) => r.guard && SUPPRESS_UPSELL.test(r.guard))
    || fired.some((r) => (r.flags ?? []).includes('referral_suggested'));
  const upsells = suppressed ? [] : Array.from(new Set(fired.map((r) => r.upsell).filter(Boolean) as string[]));
  return { talkingPoints, rationale, upsells };
}

// ─────────────────────────────────────────────────────── the engine ──

export function recommend(
  features: ObservedFeatures,
  catalog: CatalogItem[] = [],
  opts: { catalogVersion?: string; assessmentSchemaVersion?: string } = {},
): Recommendation {
  // Pass 1: rules that read only observed features.
  const seed = seedFromObservations(features);
  let fired = RULES.filter((r) => ruleFires(r, features, {}));
  let tallies = tally(fired, seed);
  let support = winner(tallies.support_level, DEFAULTS.support_level);

  // Pass 2: a few rules (R-29) read a value the first pass derived. Two fixed
  // passes, not a loop — the engine must always terminate and stay explainable.
  const derived = { derived_support_need: support.value };
  fired = RULES.filter((r) => ruleFires(r, features, derived));
  tallies = tally(fired, seed);

  const profile = { ...DEFAULTS } as FitProfile;
  const margins: Record<string, number> = {};
  for (const key of ATTRIBUTE_KEYS) {
    const w = winner(tallies[key], DEFAULTS[key]);
    profile[key] = w.value;
    margins[key] = w.margin;
  }

  const flags = Array.from(new Set(fired.flatMap((r) => r.flags ?? [])));
  const conflicts = detectConflicts(tallies, features);
  const { strength, detail } = evidence(features, margins.support_level, margins.cushioning_level, conflicts);
  const requirements = toRequirements(profile, flags, tallies);
  const candidates = rankCandidates(requirements, catalog);
  const { talkingPoints, rationale, upsells } = explain(fired, profile);

  return {
    fitProfile: profile,
    flags,
    evidenceStrength: strength,
    evidenceDetail: detail,
    productRequirements: requirements,
    candidates,
    avoid: avoidList(profile, flags),
    talkingPoints,
    rationale,
    upsells,
    firedRuleIds: fired.map((r) => r.id),
    tallies,
    versions: {
      recommendation_engine_version: ENGINE_VERSION,
      rule_set_version: RULE_SET_VERSION,
      catalog_version: opts.catalogVersion ?? 'catalog-1.0.0',
      feature_schema_version: FEATURE_SCHEMA_VERSION,
      assessment_schema_version: opts.assessmentSchemaVersion ?? 'assessment-1.0.0',
    },
    featureSnapshot: features,
  };
}

export { ATTRIBUTES, RULES };
