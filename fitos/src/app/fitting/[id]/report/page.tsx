import { notFound } from 'next/navigation';
import { loadReport } from '../../../../lib/queries';

export const dynamic = 'force-dynamic';

const LEVELS: Record<string, string[]> = {
  support: ['neutral', 'light_stability', 'stability', 'max_support'],
  cushioning: ['firm', 'moderate', 'plush', 'max'],
};
const dots = (level: string, scale: string[]) =>
  scale.map((_, i) => (i <= scale.indexOf(level) ? '●' : '○')).join('');
const pretty = (s: string) => s.replace(/_/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase());

/**
 * The report is the product — the only artifact the customer sees. A serif and
 * real margins make it read as a document rather than an app screen, which does
 * more for perceived premium than anything else in the build.
 */
export default async function ReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const r = await loadReport(id);
  if (!r) notFound();
  const snap = r.content_snapshot as any;
  const p = snap.fitProfile;

  return (
    <main className="max-w-[820px] mx-auto bg-surface-raised min-h-screen p-12 print:p-0">
      <header className="flex justify-between items-start border-b border-line pb-6">
        <div>
          <p className="font-serif text-[24px] font-semibold">{r.location_name}</p>
          <p className="text-[13px] text-ink-muted mt-1">
            {r.address_line1} · {r.city}, {r.region} · {r.location_phone}
          </p>
        </div>
        <div className="text-right">
          <p className="overline">Fit Report</p>
          <p className="text-[13px] text-ink-muted mt-1">
            {new Date(r.completed_at ?? r.generated_at).toLocaleDateString('en-US',
              { day: 'numeric', month: 'long', year: 'numeric' })}
          </p>
        </div>
      </header>

      <section className="py-6 border-b border-line">
        <p className="text-[13px] text-ink-secondary">Prepared for</p>
        <p className="font-serif text-[30px] font-semibold leading-tight">
          {r.first_name ? `${r.first_name} ${r.last_name}` : 'Guest fitting'}
        </p>
        <p className="text-[14px] text-ink-secondary mt-1">
          Fitted by {r.fitter} · Visit {r.visit_number ?? 1}
          {r.shopping_purpose && ` · ${pretty(r.shopping_purpose)}`}
        </p>
      </section>

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
        <h2 className="overline mb-3">Why</h2>
        <p className="font-serif text-[17px] leading-relaxed">{snap.rationale}</p>
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
          <span>{r.location_name} · {r.location_phone}</span>
          <span className="font-mono">Fitting powered by Stride Guide · {r.template_version}</span>
        </p>
      </footer>
    </main>
  );
}
