import type { ToldUsItem } from '../lib/report/toldUs';

const LEVELS: Record<string, string[]> = {
  support: ['neutral', 'light_stability', 'stability', 'max_support'],
  cushioning: ['firm', 'moderate', 'plush', 'max'],
};
const dots = (level: string, scale: string[]) =>
  scale.map((_, i) => (i <= scale.indexOf(level) ? '●' : '○')).join('');
const pretty = (s: string) => s.replace(/_/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase());

/**
 * The customer-facing document, rendered identically from the public token
 * route and the internal associate view. `internal` only adds a small footer
 * strip for the associate — nothing that changes what the customer reads.
 */
export default function ReportDocument({ report, internal = false }: { report: any; internal?: boolean }) {
  const snap = report.content_snapshot as any;
  const p = snap.fitProfile;
  const toldUs: ToldUsItem[] = snap.toldUs ?? [];

  return (
    <main className="max-w-[820px] mx-auto bg-surface-raised min-h-screen p-12 print:p-0">
      <header className="flex justify-between items-start border-b border-line pb-6">
        <div>
          <p className="font-serif text-[24px] font-semibold">{report.location_name}</p>
          <p className="text-[13px] text-ink-muted mt-1">
            {report.address_line1} · {report.city}, {report.region} · {report.location_phone}
          </p>
        </div>
        <div className="text-right">
          <p className="overline">Fit Report</p>
          <p className="text-[13px] text-ink-muted mt-1">
            {new Date(report.completed_at ?? report.generated_at).toLocaleDateString('en-US',
              { day: 'numeric', month: 'long', year: 'numeric' })}
          </p>
        </div>
      </header>

      <section className="py-6 border-b border-line">
        <p className="text-[13px] text-ink-secondary">Prepared for</p>
        <p className="font-serif text-[30px] font-semibold leading-tight">
          {report.first_name ? `${report.first_name} ${report.last_name}` : 'Guest fitting'}
        </p>
        <p className="text-[14px] text-ink-secondary mt-1">
          Fitted by {report.fitter} · Visit {report.visit_number ?? 1}
        </p>
      </section>

      {toldUs.length > 0 && (
        <section className="py-6 border-b border-line">
          <h2 className="overline mb-4">What you told us</h2>
          <dl className="grid grid-cols-2 gap-x-8 gap-y-3 text-[15px]">
            {toldUs.map((item) => (
              <div key={item.label} className="flex justify-between border-b border-line pb-2">
                <dt className="text-ink-secondary">{item.label}</dt>
                <dd className="font-medium text-right">{item.value}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}

      <section className="py-6 border-b border-line">
        <h2 className="overline mb-4">What we recommend</h2>
        <dl className="grid grid-cols-2 gap-x-8 gap-y-3 text-[15px]">
          <div className="flex justify-between border-b border-line pb-2 col-span-2">
            <dt className="text-ink-secondary">Shoe type</dt><dd className="font-medium">{pretty(p.category)}</dd>
          </div>
          <div className="flex justify-between border-b border-line pb-2">
            <dt className="text-ink-secondary">Support level</dt>
            <dd className="font-medium">
              <span className="text-accent tracking-[0.15em] mr-2">{dots(p.support_level, LEVELS.support)}</span>
              {pretty(p.support_level)}
            </dd>
          </div>
          <div className="flex justify-between border-b border-line pb-2">
            <dt className="text-ink-secondary">Cushioning</dt>
            <dd className="font-medium">
              <span className="text-accent tracking-[0.15em] mr-2">{dots(p.cushioning_level, LEVELS.cushioning)}</span>
              {pretty(p.cushioning_level)}
            </dd>
          </div>
          <div className="flex justify-between border-b border-line pb-2">
            <dt className="text-ink-secondary">Width &amp; toe box</dt>
            <dd className="font-medium">{pretty(p.width)}, {pretty(p.toe_box)}</dd>
          </div>
          {p.insole !== 'none' && (
            <div className="flex justify-between border-b border-line pb-2">
              <dt className="text-ink-secondary">Insole</dt><dd className="font-medium">{pretty(p.insole)}</dd>
            </div>
          )}
        </dl>
      </section>

      <section className="py-6 border-b border-line">
        <h2 className="overline mb-3">Why this recommendation makes sense</h2>
        <p className="font-serif text-[17px] leading-relaxed">{snap.why ?? snap.rationale}</p>
      </section>

      {snap.candidates?.length > 0 && (
        <section className="py-6 border-b border-line">
          <h2 className="overline mb-3">What to look for</h2>
          <ul className="text-[15px] space-y-1">
            {snap.candidates.map((c: any) => (
              <li key={c.productModelId}>{c.brand} {c.model} — {c.reasons.join(', ')}</li>
            ))}
          </ul>
        </section>
      )}

      <section className="py-6 border-b border-line">
        <h2 className="overline mb-3">Your next step</h2>
        <p className="text-[15px] leading-relaxed">
          Wear them indoors for a few days before a full day out. We will check in to see how they are
          working out — and your fit profile is saved, so your next fitting starts from here.
        </p>
      </section>

      <footer className="pt-6 text-[12px] text-ink-secondary leading-relaxed">
        <p>
          This fit report reflects a footwear fitting conducted in store. It is intended to help with shoe
          selection and comfort. It is not a medical assessment, diagnosis, or treatment recommendation.
          If you have ongoing pain or a foot health concern, please consult a qualified healthcare professional.
        </p>
        <p className="mt-4 flex justify-between text-ink-muted">
          <span>{report.location_name} · {report.location_phone}</span>
          <span className="font-mono">Fitting powered by Stride Guide · {report.template_version}</span>
        </p>
        {internal && (
          <p className="mt-3 font-mono text-[11px] text-ink-muted border-t border-line pt-3">
            Internal view · language: {snap.languageProvider}/{snap.languageVersion} · evidence: {snap.evidence}
          </p>
        )}
      </footer>
    </main>
  );
}
