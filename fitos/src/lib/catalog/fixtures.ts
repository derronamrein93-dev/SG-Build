/**
 * Synthetic catalog fixtures — test data, and only test data.
 *
 * Built to cover every comparator, both curve directions, each hard constraint
 * and both unknown paths. Deliberately NOT real products: a fixture asserting
 * "this shoe has a 12mm drop" is a claim, and claims about real shoes belong in
 * the catalog with provenance, not in a test file.
 *
 * Every attribute here carries `synthetic_fixture` provenance so it is
 * self-identifying, and a test asserts fixture-sourced evidence never attaches
 * to a real catalog model.
 */
import type { CatalogShoe } from './match';

const ev = (attrs: Record<string, number>) =>
  Object.fromEntries(Object.entries(attrs).map(([k, c]) => [k, { confidence: c, source: 'synthetic_fixture' }]));

const SPEC = 0.95, RESEARCH = 0.85, MARKETING = 0.38;

export function fixture(over: Partial<CatalogShoe> & { productModelId: string }): CatalogShoe {
  return {
    brand: 'Fixture', model: over.productModelId,
    category: 'running_neutral', secondaryUses: [],
    safetyToe: false, removableInsole: true, depth: 'standard',
    sizeLow: 6, sizeHigh: 14, widthsStocked: ['standard'], stocked: true,
    attributes: {}, evidence: {},
    ...over,
  };
}

/** A well-documented shoe that fits a wide, high-volume, standing-all-day foot. */
export const WIDE_COMFORT = fixture({
  productModelId: 'wide-comfort',
  category: 'walking_comfort',
  widthsStocked: ['standard', 'wide', 'extra_wide'],
  attributes: {
    cushioning_level: 'plush', support_level: 'stability',
    fit_width_tendency: 'runs_wide', toe_box_room: 'generous',
    forefoot_volume: 'high', heel_hold: 'secure',
    orthotic_compatibility: 'excellent', forefoot_flexibility: 'moderate',
  },
  evidence: ev({
    cushioning_level: RESEARCH, support_level: RESEARCH, fit_width_tendency: SPEC,
    toe_box_room: RESEARCH, forefoot_volume: RESEARCH, heel_hold: RESEARCH,
    orthotic_compatibility: SPEC, forefoot_flexibility: RESEARCH,
  }),
});

/** Narrow, low-volume, firm. The opposite foot. */
export const NARROW_PERFORMANCE = fixture({
  productModelId: 'narrow-performance',
  category: 'running_neutral',
  widthsStocked: ['standard'],
  attributes: {
    cushioning_level: 'firm', support_level: 'neutral',
    fit_width_tendency: 'runs_narrow', toe_box_room: 'shallow',
    forefoot_volume: 'low', heel_hold: 'locked',
    orthotic_compatibility: 'poor', forefoot_flexibility: 'flexible',
  },
  evidence: ev({
    cushioning_level: RESEARCH, support_level: RESEARCH, fit_width_tendency: SPEC,
    toe_box_room: RESEARCH, forefoot_volume: RESEARCH, heel_hold: RESEARCH,
    orthotic_compatibility: SPEC, forefoot_flexibility: RESEARCH,
  }),
});

/** Stocked only in small sizes — exists to be eliminated by H1. */
export const SMALL_SIZES_ONLY = fixture({
  productModelId: 'small-sizes-only',
  category: 'walking_comfort', sizeLow: 5, sizeHigh: 9,
  widthsStocked: ['standard', 'wide'],
  attributes: {
    cushioning_level: 'plush', support_level: 'stability',
    toe_box_room: 'generous', forefoot_volume: 'high', heel_hold: 'secure',
  },
  evidence: ev({ cushioning_level: RESEARCH, support_level: RESEARCH,
                 toe_box_room: RESEARCH, forefoot_volume: RESEARCH, heel_hold: RESEARCH }),
});

/** Glued-in footbed — exists to be eliminated by H5 when an orthotic is in play. */
export const GLUED_INSOLE = fixture({
  productModelId: 'glued-insole',
  category: 'walking_comfort', removableInsole: false,
  widthsStocked: ['standard', 'wide'],
  attributes: {
    cushioning_level: 'plush', support_level: 'stability',
    toe_box_room: 'generous', forefoot_volume: 'high', heel_hold: 'secure',
  },
  evidence: ev({ cushioning_level: RESEARCH, support_level: RESEARCH,
                 toe_box_room: RESEARCH, forefoot_volume: RESEARCH, heel_hold: RESEARCH }),
});

/** Almost nothing known. Must not be scored, must not be invented. */
export const UNDOCUMENTED = fixture({
  productModelId: 'undocumented',
  category: 'walking_comfort',
  widthsStocked: ['standard', 'wide'],
  attributes: { cushioning_level: 'moderate' },
  evidence: ev({ cushioning_level: RESEARCH }),
});

/** Values present, but every one of them from marketing copy. */
export const MARKETING_ONLY = fixture({
  productModelId: 'marketing-only',
  category: 'walking_comfort',
  widthsStocked: ['standard', 'wide'],
  attributes: {
    cushioning_level: 'plush', support_level: 'stability',
    fit_width_tendency: 'runs_wide', toe_box_room: 'generous',
    forefoot_volume: 'high', heel_hold: 'secure',
  },
  evidence: ev({
    cushioning_level: MARKETING, support_level: MARKETING, fit_width_tendency: MARKETING,
    toe_box_room: MARKETING, forefoot_volume: MARKETING, heel_hold: MARKETING,
  }),
});

/** Roomier than anyone needs — exercises the far end of the EXCESS curve. */
export const OVERSIZED = fixture({
  productModelId: 'oversized',
  category: 'walking_comfort',
  widthsStocked: ['standard', 'wide', 'extra_wide'],
  attributes: {
    cushioning_level: 'max', support_level: 'stability',
    fit_width_tendency: 'runs_wide', toe_box_room: 'generous',
    forefoot_volume: 'high', heel_hold: 'loose',
  },
  evidence: ev({
    cushioning_level: RESEARCH, support_level: RESEARCH, fit_width_tendency: SPEC,
    toe_box_room: RESEARCH, forefoot_volume: RESEARCH, heel_hold: RESEARCH,
  }),
});

export const ALL_FIXTURES = [
  WIDE_COMFORT, NARROW_PERFORMANCE, SMALL_SIZES_ONLY, GLUED_INSOLE,
  UNDOCUMENTED, MARKETING_ONLY, OVERSIZED,
];
