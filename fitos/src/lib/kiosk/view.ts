/**
 * The customer-facing projection of a finished fitting, for a 7.9-inch screen.
 *
 * This file computes NOTHING. It reads `report.content_snapshot` — the record
 * `finishFitting()` froze at completion — and rearranges it for a small display.
 * There is no second scoring system here and there must never be one: the report
 * a customer reads on the kiosk and the report they open from their link are the
 * same frozen document, or the two will disagree in front of a customer one day.
 *
 * Two things it does do, both subtractive:
 *
 *   - **Internal ids are dropped.** `candidates[].productModelId` is a uuid that
 *     identifies a row in a shared catalog. The customer gets a brand and a
 *     model, which is what they will say to an associate anyway.
 *   - **`ruleRationale` never leaves the server.** It is the raw rule strings,
 *     kept on the record for audit. The customer reads the composed paragraph,
 *     which has been through the guardrail lexicon; the rule strings have not.
 */

/** Mirrors the scales in components/ReportDocument.tsx. Four steps each. */
const LEVELS: Record<string, string[]> = {
  support: ['neutral', 'light_stability', 'stability', 'max_support'],
  cushioning: ['firm', 'moderate', 'plush', 'max'],
};

function pretty(s: string): string {
  return String(s ?? '').replace(/_/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase());
}

/** 0–3. Rendered as filled pips, not as a slider: nothing here is adjustable. */
function level(value: string, scale: string[]): number {
  const i = scale.indexOf(value);
  return i < 0 ? 0 : i;
}

export interface KioskFitRow { label: string; value: string; filled?: number; of?: number }
export interface KioskProduct { brand: string; model: string; reasons: string[] }

export interface KioskResults {
  /** One line, read at arm's length while standing. */
  headline: string;
  subhead: string;
  profile: KioskFitRow[];
  why: string;
  /** Echoed back in the customer's own terms — never presented as findings. */
  toldUs: KioskFitRow[];
  products: KioskProduct[];
  avoid: string[];
  disclaimer: string;
}

const DISCLAIMER =
  'This is a footwear fitting to help with shoe selection and comfort. It is not ' +
  'a medical assessment or diagnosis.';

export function projectResults(contentSnapshot: any): KioskResults {
  const snap = contentSnapshot ?? {};
  const p = snap.fitProfile ?? {};

  const profile: KioskFitRow[] = [
    { label: 'Shoe type', value: pretty(p.category ?? 'casual_comfort') },
    {
      label: 'Support',
      value: pretty(p.support_level ?? 'neutral'),
      filled: level(p.support_level ?? 'neutral', LEVELS.support) + 1,
      of: LEVELS.support.length,
    },
    {
      label: 'Cushioning',
      value: pretty(p.cushioning_level ?? 'moderate'),
      filled: level(p.cushioning_level ?? 'moderate', LEVELS.cushioning) + 1,
      of: LEVELS.cushioning.length,
    },
    { label: 'Width & toe box', value: `${pretty(p.width ?? 'standard')}, ${pretty(p.toe_box ?? 'standard')}` },
  ];
  if (p.insole && p.insole !== 'none') {
    profile.push({ label: 'Insole', value: pretty(p.insole) });
  }

  return {
    // The decision, in the two words a customer repeats to an associate.
    headline: `${pretty(p.category ?? 'casual_comfort')}`,
    subhead: `${pretty(p.support_level ?? 'neutral')} support · ${pretty(p.cushioning_level ?? 'moderate')} cushioning`,
    profile,
    why: String(snap.why ?? ''),
    toldUs: Array.isArray(snap.toldUs)
      ? snap.toldUs.map((t: any) => ({ label: String(t.label), value: String(t.value) }))
      : [],
    // Three, at most. A 7.9-inch screen showing eight shoes is a catalog, and a
    // catalog is not a decision.
    products: (Array.isArray(snap.candidates) ? snap.candidates : []).slice(0, 3)
      .map((c: any) => ({
        brand: String(c.brand ?? ''),
        model: String(c.model ?? ''),
        reasons: (Array.isArray(c.reasons) ? c.reasons : []).slice(0, 2).map(String),
      })),
    avoid: (Array.isArray(snap.avoid) ? snap.avoid : []).map((a: any) => pretty(String(a))),
    disclaimer: DISCLAIMER,
  };
}
