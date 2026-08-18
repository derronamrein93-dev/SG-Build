import Link from 'next/link';
import { dashboard } from '../lib/queries';

export const dynamic = 'force-dynamic';

function timeOf(d: string | null) {
  if (!d) return '';
  return new Date(d).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

export default async function Dashboard() {
  const d = await dashboard();
  return (
    <main className="max-w-[1200px] mx-auto p-8">
      <header className="flex items-baseline justify-between mb-8">
        <div>
          <p className="overline">Stride Guide FitOS</p>
          <h1 className="text-[34px] font-semibold tracking-[-0.02em] mt-1">{d.locationName}</h1>
        </div>
        <p className="text-ink-muted text-[14px]">Denise Okonkwo · Associate</p>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_1.1fr] gap-6">
        <section className="space-y-6">
          <Link href="/fitting/new" className="btn-primary w-full text-[19px] !min-h-[120px] rounded-card">
            + New Fitting
          </Link>

          <div className="card">
            <h2 className="overline mb-4">Recent fittings</h2>
            {d.recent.length === 0 && <p className="text-ink-muted text-[15px]">No fittings yet today.</p>}
            <ul className="divide-y divide-line">
              {d.recent.map((r: any) => (
                <li key={r.id} className="py-3 flex items-center justify-between gap-4">
                  <Link href={r.status === 'completed' ? `/fitting/${r.id}/report` : `/fitting/${r.id}`}
                        className="flex-1 hover:text-accent">
                    <span className="font-medium">
                      {r.first_name ? `${r.first_name} ${r.last_name}` : 'Anonymous fitting'}
                    </span>
                    {r.local_customer_number && (
                      <span className="font-mono text-[12px] text-ink-muted ml-2">#{r.local_customer_number}</span>
                    )}
                  </Link>
                  {r.status !== 'completed' && (
                    <span className="text-[12px] font-medium text-attention">In progress</span>
                  )}
                  <span className="text-[13px] text-ink-muted tabular-nums">
                    {timeOf(r.completed_at ?? r.started_at)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="space-y-6">
          <div className="grid grid-cols-3 gap-3">
            {[['Fittings', d.fittingsToday], ['Reports sent', d.reportsSent], ['Follow-ups due', d.followUpsDue]]
              .map(([label, value]) => (
              <div key={label as string} className="card !p-4">
                <p className="text-[13px] text-ink-secondary">{label as string}</p>
                <p className="text-[32px] font-semibold tabular-nums leading-tight mt-1">{value as number}</p>
              </div>
            ))}
          </div>

          <div className="card">
            <h2 className="overline mb-4">Follow-ups due</h2>
            {d.followUps.length === 0 && <p className="text-ink-muted text-[15px]">Nothing due.</p>}
            <ul className="divide-y divide-line">
              {d.followUps.map((f: any) => {
                const overdue = new Date(f.follow_up_due_at) < new Date();
                return (
                  <li key={f.id} className="py-3 flex items-center justify-between gap-3">
                    <span className="text-[15px]">
                      {f.first_name} {f.last_name} · <span className="text-ink-secondary">{f.follow_up_reason}</span>
                    </span>
                    <span className={`text-[12px] font-medium ${overdue ? 'text-attention' : 'text-ink-muted'}`}>
                      {overdue ? 'Overdue' : new Date(f.follow_up_due_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>

          <p className="text-[13px] text-ink-muted">
            Something wrong or slow? <span className="text-accent">Add pilot feedback</span> from any screen.
          </p>
        </section>
      </div>
    </main>
  );
}
