/**
 * Phase 1 language layer — docs/07 §3.
 *
 * The engine decides; this layer only phrases. It never adds, removes, reorders
 * or re-ranks anything in the recommendation.
 *
 * The default composer is DETERMINISTIC, not a model call. Three reasons, and
 * they are the same reasons docs/07 keeps generation off the fitting path:
 * a demo in front of a store owner cannot depend on a network round trip, the
 * output has to be reproducible from a rule_set_version, and an unkeyed API
 * call is not something to discover at a pilot store. `LanguageProvider` is the
 * seam an LLM plugs into when there is a key and an eval set to hold it to;
 * whatever it returns is guardrail-checked and falls back to this composer.
 *
 * What makes it not-a-concatenation: rule `report` strings are never emitted.
 * The composer reads the structured facts, groups them into themes, drops
 * duplicate claims, and assembles sentences.
 */
import type { Recommendation, ObservedFeatures } from '../rules/engine';
import { violatesGuardrails } from '../rules/vocabulary';

export const LANGUAGE_LAYER_VERSION = 'language-1.0.0';

export interface ComposedLanguage {
  paragraph: string;
  provider: 'deterministic' | 'model';
  version: string;
  /** Set when a model was tried and rejected — kept for the pilot review loop. */
  fallbackReason?: string;
}

export interface LanguageProvider {
  name: string;
  compose(input: { facts: string[]; profile: Recommendation['fitProfile']; constraints: string[] }): Promise<string>;
}

/* ── evidence: structured facts, each stated once ─────────────────── */

const val = (f: ObservedFeatures, k: string) => f[k]?.value;
const arr = (f: ObservedFeatures, k: string): string[] => {
  const v = val(f, k);
  return Array.isArray(v) ? v.map(String) : v ? [String(v)] : [];
};

const AREA_WORDS: Record<string, string> = {
  heel: 'the heel', arch: 'the arch', ball_of_foot: 'the ball of the foot',
  toes: 'the toes', ankle: 'the ankle', knee: 'the knee', hip_back: 'the hip or back',
};
const PURPOSE_WORDS: Record<string, string> = {
  running: 'running', walking: 'walking', work: 'work', hiking: 'hiking',
  casual: 'everyday wear', kids: 'a growing foot', sports: 'sport',
  orthopedic: 'all-day comfort',
};
const HOURS_WORDS: Record<string, string> = {
  '8_plus': 'on your feet for most of the day', '4_8': 'on your feet for much of the day',
};

/** One clause per observation. Order is the order an associate would say them. */
function evidenceClauses(f: ObservedFeatures): string[] {
  const out: string[] = [];
  const areas = arr(f, 'discomfort_area').filter((a) => a !== 'none' && AREA_WORDS[a]);
  if (areas.length === 1) out.push(`discomfort in ${AREA_WORDS[areas[0]]}`);
  else if (areas.length > 1) out.push(`discomfort in ${AREA_WORDS[areas[0]]} and ${AREA_WORDS[areas[1]]}`);

  const wear = String(val(f, 'wear_pattern') ?? '');
  if (wear === 'inner_edge') out.push('wear along the inner edge of your current shoes');
  else if (wear === 'outer_edge') out.push('wear along the outer edge of your current shoes');
  else if (wear === 'uneven_lr') out.push('uneven wear between your left and right shoes');

  const arch = String(val(f, 'arch_type') ?? '');
  if (arch === 'low') out.push('a lower arch');
  else if (arch === 'high') out.push('a higher arch');

  const width = String(val(f, 'width') ?? '');
  if (width === 'wide' || width === 'extra_wide') out.push('a wider foot');

  if (String(val(f, 'uses_orthotics') ?? '').startsWith('custom')) out.push('the orthotics you already wear');
  return out;
}

function joinNaturally(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? '';
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(', ')}, and ${parts[parts.length - 1]}`;
}

/* ── what the profile means, in retail words ──────────────────────── */

const SUPPORT_WORDS: Record<string, string> = {
  neutral: 'a neutral shoe that lets your foot move naturally',
  light_stability: 'a shoe with a little built-in structure',
  stability: 'a supportive shoe with a firmer platform underfoot',
  max_support: 'a shoe with a firm, structured base',
};
const CUSHION_WORDS: Record<string, string> = {
  firm: 'a firmer ride', moderate: 'a moderate amount of cushioning',
  plush: 'cushioning that holds up over a long day', max: 'the most cushioning we carry',
};
const INSOLE_WORDS: Record<string, string> = {
  cushion: 'a cushioning insole', arch_support: 'an arch-support insole',
  heel_cup: 'a heel-comfort insole', metatarsal: 'an insole with forefoot padding',
  anti_fatigue: 'an anti-fatigue insole',
};

/** The deterministic composer. Same input, same paragraph, every time. */
export function composeWhy(rec: Recommendation, features: ObservedFeatures): ComposedLanguage {
  const sentences: string[] = [];
  const said = new Set<string>();
  const say = (s: string) => { const k = s.toLowerCase(); if (!said.has(k)) { said.add(k); sentences.push(s); } };

  // 1 · what we saw, and what it points to
  const evidence = evidenceClauses(features).slice(0, 3);
  const purpose = PURPOSE_WORDS[String(val(features, 'purpose') ?? '')];
  const hours = HOURS_WORDS[String(val(features, 'standing_hours') ?? '')];

  const opener = purpose ? `You came in for ${purpose}` : 'You came in for a fitting today';
  say(hours ? `${opener}, and you are ${hours}.` : `${opener}.`);
  if (evidence.length) say(`We noted ${joinNaturally(evidence)}.`);
  else if (!hours) say('We fitted you on what felt best walking on the hard floor.');

  // 2 · the shoe itself — support, cushioning and shape in one sentence
  const shape: string[] = [];
  if (rec.fitProfile.width !== 'standard') shape.push(`a ${rec.fitProfile.width.replace('_', ' ')} fit`);
  if (rec.fitProfile.toe_box !== 'standard') shape.push('a roomier toe box');
  if (rec.fitProfile.heel_fit === 'structured') shape.push('a back that holds you more securely');
  else if (rec.fitProfile.heel_fit === 'secure_narrow') shape.push('a closer hold around the back of the foot');

  const core = `${SUPPORT_WORDS[rec.fitProfile.support_level]}, paired with ${CUSHION_WORDS[rec.fitProfile.cushioning_level]}`;
  say(shape.length
    ? `That points to ${core}, in ${joinNaturally(shape)}.`
    : `That points to ${core}.`);

  // 3 · the insole, only when there is one, and framed as part of the fit
  const insole = INSOLE_WORDS[rec.fitProfile.insole];
  if (insole) say(`We added ${insole} to take a little more pressure off through the day.`);

  // 4 · one practical note, whichever matters most — never a list of flags.
  // Accommodating something the customer already owns outranks the sizing note:
  // it answers the question they walked in with.
  if (rec.flags.includes('removable_insole_required'))
    say('We chose a shoe whose insole lifts out, so your own orthotic sits properly inside it.');
  else if (rec.flags.includes('size_asymmetry'))
    say('Your feet measured slightly different sizes, which is common, so we fitted the larger one.');
  else if (rec.flags.includes('break_in_guidance'))
    say('A new pair will feel firmer at first — that is the cushioning doing its job, not the fit being wrong.');
  else if (rec.flags.includes('size_up_check'))
    say('We checked length and width carefully, since a lot of discomfort comes down to sizing.');

  // 5 · referral, in neutral words, always last
  if (rec.flags.includes('referral_suggested'))
    say('If the discomfort continues, it is worth having a healthcare professional take a look as well.');

  const paragraph = sentences.join(' ');
  return { paragraph, provider: 'deterministic', version: LANGUAGE_LAYER_VERSION };
}

/* ── the seam a model plugs into ──────────────────────────────────── */

/** Facts a provider is allowed to speak about. It may not introduce others. */
export function factsFor(rec: Recommendation, features: ObservedFeatures) {
  return {
    facts: evidenceClauses(features),
    profile: rec.fitProfile,
    constraints: [
      'Write one paragraph of three to five sentences.',
      'Plain retail English, second person, no exclamation marks.',
      'Never name a medical condition, diagnose, or promise a health outcome.',
      'Do not introduce any fact that is not in the supplied list.',
      'Do not repeat the same observation twice.',
    ],
  };
}

/**
 * Try a provider, then verify. Anything that trips the guardrail lexicon or
 * invents a fact outside the supplied evidence is discarded and the
 * deterministic paragraph is used instead — a filter, not a prompt instruction.
 */
export async function composeWhyWithProvider(
  rec: Recommendation, features: ObservedFeatures, provider?: LanguageProvider,
): Promise<ComposedLanguage> {
  const deterministic = composeWhy(rec, features);
  if (!provider) return deterministic;
  try {
    const text = (await provider.compose(factsFor(rec, features))).trim();
    const banned = violatesGuardrails(text);
    if (banned.length) return { ...deterministic, fallbackReason: `guardrail: ${banned.join(', ')}` };
    if (text.length < 80 || text.length > 900) return { ...deterministic, fallbackReason: 'length out of range' };
    if (/\d+\s*%/.test(text)) return { ...deterministic, fallbackReason: 'implied precision' };
    return { paragraph: text, provider: 'model', version: `${LANGUAGE_LAYER_VERSION}+${provider.name}` };
  } catch (err) {
    return { ...deterministic, fallbackReason: `provider error: ${(err as Error).message}` };
  }
}
