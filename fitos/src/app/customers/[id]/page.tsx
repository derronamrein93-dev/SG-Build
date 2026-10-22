import Link from 'next/link';
import { notFound } from 'next/navigation';
import { withTenant } from '../../../lib/db/client';
import { currentContext } from '../../../lib/session';

export const dynamic = 'force-dynamic';

type Fitting = {
  id: string; status: string; started_at: string; completed_at: string | null;
  visit_number: number | null; recommendation_count: string;
};

export default async function CustomerProfile({ params }: { params: { id: string } }) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(params.id)) notFound();
  const result = await withTenant(currentContext(), async (db) => {
    const customer = await db.query(
      `select id, first_name, last_name, local_customer_number, phone_last4, created_at
       from organization_customer
       where id = $1 and deleted_at is null`, [params.id]);
    if (!customer.rows.length) return null;
    const fittings = await db.query<Fitting>(
      `select fs.id, fs.status, fs.started_at, fs.completed_at, fs.visit_number,
              count(r.id)::text as recommendation_count
       from fitting_session fs
       left join recommendation r on r.fitting_session_id = fs.id
       where fs.organization_customer_id = $1
       group by fs.id
       order by fs.started_at desc limit 100`, [params.id]);
    return { customer: customer.rows[0], fittings: fittings.rows };
  });
  if (!result) notFound();
  const { customer, fittings } = result;
  return (
    <main className="max-w-[1000px] mx-auto p-8">
      <Link href="/" className="text-accent text-sm">← FitOS dashboard</Link>
      <p className="overline mt-8">MyStrideID · Retailer view</p>
      <h1 className="text-[32px] font-semibold mt-2">{customer.first_name} {customer.last_name}</h1>
      <p className="text-ink-secondary mt-1">Customer #{customer.local_customer_number}
        {customer.phone_last4 ? ` · Phone ending ${customer.phone_last4}` : ''}</p>
      <section className="card mt-8">
        <h2 className="text-xl font-semibold">Fitting history</h2>
        <p className="text-ink-secondary text-sm mt-1">Historical sessions are preserved, not overwritten.</p>
        {fittings.length === 0 ? <p className="mt-6">No fitting sessions yet.</p> : (
          <ul className="divide-y divide-line mt-4">
            {fittings.map(f => (
              <li key={f.id} className="py-4 flex justify-between gap-4 items-center">
                <div>
                  <p className="font-medium">{new Date(f.started_at).toLocaleDateString('en-US', {dateStyle:'medium'})}</p>
                  <p className="text-ink-secondary text-sm">{f.status} · {f.recommendation_count} recommendation records
                    {f.visit_number ? ` · Visit ${f.visit_number}` : ''}</p>
                </div>
                <Link className="text-accent" href={f.status === 'completed' ? `/fitting/${f.id}/report` : `/fitting/${f.id}`}>View fitting →</Link>
              </li>
            ))}
          </ul>
        )}
      </section>
      <p className="text-ink-muted text-sm mt-6">Purchase history and post-wear feedback are planned for the next milestone. This view uses existing tenant and location access policies.</p>
    </main>
  );
}
