import { redirect } from 'next/navigation';
import Link from 'next/link';
import { findCustomerByPhone, createCustomer, startSession } from '../../../lib/queries';

export const dynamic = 'force-dynamic';

/**
 * Search-first, not create-first: creation is what happens when search fails,
 * which is the opposite of most CRM screens and the reason duplicates get
 * avoided. Phone lookup is exact-match only — it runs against a keyed hash.
 */
export default async function NewFitting({
  searchParams,
}: { searchParams: Promise<{ phone?: string; error?: string }> }) {
  const params = await searchParams;
  const phone = params.phone ?? '';
  const match = phone ? await findCustomerByPhone(phone) : null;

  async function search(formData: FormData) {
    'use server';
    redirect(`/fitting/new?phone=${encodeURIComponent(String(formData.get('phone') ?? ''))}`);
  }

  async function continueReturning(formData: FormData) {
    'use server';
    const id = await startSession(String(formData.get('customerId')));
    redirect(`/fitting/${id}`);
  }

  async function create(formData: FormData) {
    'use server';
    try {
      const customer = await createCustomer({
        firstName: String(formData.get('firstName') ?? '').trim(),
        lastName: String(formData.get('lastName') ?? '').trim(),
        phone: String(formData.get('phone') ?? ''),
        consent: formData.get('consent') === 'on',
      });
      const id = await startSession(customer.id);
      redirect(`/fitting/${id}`);
    } catch (e) {
      if (e && typeof e === 'object' && 'digest' in e) throw e; // redirect
      redirect(`/fitting/new?phone=${encodeURIComponent(String(formData.get('phone') ?? ''))}&error=${
        encodeURIComponent((e as Error).message)}`);
    }
  }

  async function anonymous() {
    'use server';
    const id = await startSession(null);
    redirect(`/fitting/${id}`);
  }

  return (
    <main className="max-w-[720px] mx-auto p-8">
      <Link href="/" className="text-[14px] text-ink-muted hover:text-accent">← Dashboard</Link>
      <h1 className="text-[34px] font-semibold tracking-[-0.02em] mt-4 mb-6">Who are we fitting?</h1>

      <form action={search} className="card mb-4">
        <label className="label block mb-2" htmlFor="phone">Phone number</label>
        <div className="flex gap-3">
          <input id="phone" name="phone" defaultValue={phone} inputMode="tel" autoFocus
                 placeholder="(612) 555-4417"
                 className="flex-1 min-h-touch px-4 rounded-control border border-line-strong text-[17px]" />
          <button className="btn-primary" type="submit">Find</button>
        </div>
        <p className="text-[13px] text-ink-muted mt-3">
          Full number required — lookup runs against a protected identifier, so partial search is not possible.
        </p>
      </form>

      {params.error && <p className="text-alert text-[14px] mb-4">{params.error}</p>}

      {match && (
        <form action={continueReturning} className="card mb-4 border-accent">
          <input type="hidden" name="customerId" value={match.id} />
          <p className="overline mb-2">Returning customer</p>
          <p className="text-[22px] font-semibold">{match.first_name} {match.last_name}</p>
          <p className="text-[14px] text-ink-secondary mt-1">
            Customer #{match.local_customer_number} · {match.visits} previous fitting{match.visits === 1 ? '' : 's'}
            {match.lastVisit && ` · last ${new Date(match.lastVisit).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}`}
          </p>
          <button className="btn-primary mt-4" type="submit">Continue as returning customer</button>
        </form>
      )}

      {phone && !match && (
        <form action={create} className="card space-y-4">
          <p className="overline">No match — create customer</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label block mb-1" htmlFor="firstName">First name</label>
              <input id="firstName" name="firstName" required
                     className="w-full min-h-touch px-4 rounded-control border border-line-strong text-[17px]" />
            </div>
            <div>
              <label className="label block mb-1" htmlFor="lastName">Last name</label>
              <input id="lastName" name="lastName" required
                     className="w-full min-h-touch px-4 rounded-control border border-line-strong text-[17px]" />
            </div>
          </div>
          <input type="hidden" name="phone" value={phone} />
          <label className="flex gap-3 items-start text-[15px] leading-relaxed">
            <input type="checkbox" name="consent" required className="mt-1 w-5 h-5 accent-[#0F5C5B]" />
            <span>
              I agree that <strong>Northside Running Co.</strong> may store my fitting information to help
              with future fittings. My information is not sold. I can ask for it to be deleted at any time.
            </span>
          </label>
          <button className="btn-primary" type="submit">Start fitting</button>
        </form>
      )}

      <form action={anonymous} className="mt-6">
        <button className="btn-ghost" type="submit">Fitting without saving contact</button>
        <p className="text-[13px] text-ink-muted mt-2">
          Full workflow, printed report, no stored identity. Some customers will decline — the associate
          must never be stuck.
        </p>
      </form>
    </main>
  );
}
