import { redirect } from 'next/navigation';
import Link from 'next/link';
import SmsCheckin from './SmsCheckin';
import { startSession } from '../../../lib/queries';
import { assertReportingAccess } from '../../../lib/reporting/access';

export const dynamic='force-dynamic';
export default function NewFitting() {
 assertReportingAccess(); // seeded demo staff cannot access production customer identities
 async function anonymous() {
  'use server';
  assertReportingAccess();
  const id=await startSession(null);
  redirect('/fitting/'+id);
 }
 return <main className="max-w-[720px] mx-auto p-8">
  <Link href="/" className="text-[14px] text-ink-muted hover:text-accent">← Dashboard</Link>
  <h1 className="text-[34px] font-semibold tracking-[-0.02em] mt-4 mb-6">Who are we fitting?</h1>
  <SmsCheckin/>
  <form action={anonymous} className="mt-6">
   <button type="submit" className="btn-ghost">Fitting without saving contact</button>
   <p className="text-[13px] text-ink-muted mt-2">No SMS or customer account is required for an anonymous fitting.</p>
  </form>
 </main>;
}
