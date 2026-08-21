/**
 * The Why? panel.
 *
 * Renders a PERSISTED explanation. It never recomputes: everything shown comes
 * from the recommendation_candidate row written when the fitting happened, so a
 * catalog edit tomorrow cannot change what this fitting says today.
 *
 * No model call, no generated prose. The engine decided; this reads the record.
 */
'use client';
import { useState } from 'react';

export interface StoredDimension {
  dimension: string; requirement: string | null; customerSource: string | null;
  shoeAttribute: string; shoeValue: string | null; shoeSource: string;
  confidence: number; score: number | null; weight: number;
  known: boolean; unknownReason?: string;
}

export interface StoredCandidate {
  product_model_id: string; brand?: string; model?: string;
  rank: number | null; eliminated: boolean; elimination_reason: string | null;
  overall_score: string | number | null; scored_dimension_count: number;
  hard_constraints: { constraint: string; applied: boolean; passed: boolean; detail: string }[];
  dimensions: StoredDimension[];
  considerations: string[];
  reasons: string[];
  scoring_version: string;
}

// Labels come from the shared leaf module, never from the engine: this panel
// renders what was stored and has no way to recompute it.
import { LABEL_DIMENSION as LABEL, LABEL_SOURCE as SOURCE,
         LABEL_UNKNOWN as UNKNOWN } from '../lib/catalog/labels';

const pct = (n: number) => `${Math.round(n * 100)}%`;

export function WhyPanel({ candidate, onClose }: { candidate: StoredCandidate; onClose: () => void }) {
  const [showBreakdown, setShowBreakdown] = useState(false);
  const overall = candidate.overall_score === null ? null : Number(candidate.overall_score);
  const scored = candidate.dimensions.filter((d) => d.known && d.score !== null);
  const unknown = candidate.dimensions.filter((d) => !d.known && d.unknownReason !== 'no_requirement');
  const sizeCheck = candidate.hard_constraints.find((h) => h.constraint === 'size_available');

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end md:items-center justify-center"
      role="dialog" aria-modal="true" aria-label="Why FitOS recommended this shoe">
      <div className="bg-surface-raised w-full md:max-w-[720px] md:rounded-2xl rounded-t-2xl
                      p-6 max-h-[88vh] overflow-y-auto" data-why-panel>
        <header className="flex items-start justify-between gap-4">
          <h2 className="text-[24px] font-semibold tracking-[-0.01em]">
            Why FitOS recommended this shoe
          </h2>
          <button type="button" onClick={onClose} data-why-close
            className="btn-ghost min-h-[48px] px-5 text-[17px]">Close</button>
        </header>

        {candidate.reasons.length > 0 && (
          <section className="mt-6">
            <h3 className="overline">Strong matches</h3>
            <ul className="mt-3 space-y-2">
              {candidate.reasons.map((r, i) => (
                <li key={i} className="text-[16px] leading-snug" data-why-reason>{r}</li>
              ))}
            </ul>
          </section>
        )}

        {candidate.considerations.length > 0 && (
          <section className="mt-6">
            <h3 className="overline">Things to consider</h3>
            <ul className="mt-3 space-y-2">
              {candidate.considerations.map((c, i) => (
                <li key={i} className="text-[16px] leading-snug text-ink-secondary"
                  data-why-consideration>{c}</li>
              ))}
            </ul>
          </section>
        )}

        {unknown.length > 0 && (
          <section className="mt-6">
            <h3 className="overline">Not enough data to score</h3>
            <ul className="mt-3 space-y-1">
              {unknown.map((d, i) => (
                <li key={i} className="text-[14px] text-ink-muted" data-why-unknown>
                  {LABEL[d.dimension] ?? d.dimension} — {UNKNOWN[d.unknownReason ?? ''] ?? 'Unknown'}
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="mt-6 pt-6 border-t border-line">
          {overall === null ? (
            <p className="text-[16px]" data-why-overall="suppressed">
              Not enough verified detail about this model to give an overall match figure.
              {' '}Only {candidate.scored_dimension_count} of the fit dimensions could be scored.
            </p>
          ) : (
            <p className="text-[22px] font-semibold" data-why-overall={pct(overall)}>
              Overall match — {pct(overall)}
            </p>
          )}

          <button type="button" className="btn-ghost mt-4 min-h-[48px] text-[16px]"
            data-why-breakdown onClick={() => setShowBreakdown((v) => !v)}>
            {showBreakdown ? 'Hide score breakdown' : 'See score breakdown'}
          </button>

          {showBreakdown && (
            <table className="w-full mt-4 text-[15px]">
              <tbody>
                {sizeCheck?.applied && (
                  <tr className="border-b border-line" data-why-row="size">
                    <td className="py-2">Size</td>
                    <td className="py-2 text-right font-mono">
                      {sizeCheck.passed ? 'Pass' : 'Fail'}
                    </td>
                    <td className="py-2 pl-4 text-[13px] text-ink-muted">hard constraint</td>
                  </tr>
                )}
                {scored.map((d) => (
                  <tr key={d.dimension} className="border-b border-line"
                    data-why-row={d.dimension} data-why-score={pct(d.score as number)}>
                    <td className="py-2">{LABEL[d.dimension] ?? d.dimension}</td>
                    <td className="py-2 text-right font-mono">{pct(d.score as number)}</td>
                    <td className="py-2 pl-4 text-[13px] text-ink-muted">
                      {SOURCE[d.customerSource ?? ''] ?? 'From this fitting'} ·{' '}
                      {SOURCE[d.shoeSource] ?? d.shoeSource}
                    </td>
                  </tr>
                ))}
                {overall !== null && (
                  <tr>
                    <td className="py-2 font-semibold">Overall</td>
                    <td className="py-2 text-right font-mono font-semibold">{pct(overall)}</td>
                    <td className="py-2 pl-4 text-[13px] text-ink-muted">
                      weighted by confidence
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </section>

        <p className="mt-6 text-[12px] text-ink-muted">
          Match assessment for footwear fit. Not a medical assessment, diagnosis,
          or treatment recommendation. · {candidate.scoring_version}
        </p>
      </div>
    </div>
  );
}
