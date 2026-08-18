import { notFound } from 'next/navigation';
import { loadReport } from '../../../../lib/reports';
import ReportDocument from '../../../../components/ReportDocument';

export const dynamic = 'force-dynamic';

/**
 * Internal associate view: tenant-scoped through RLS, reached from the
 * dashboard, no token involved. Distinct from the customer's public link so
 * that revoking a customer link never blocks the store from seeing its own
 * record — and so the customer link never depends on store credentials.
 */
export default async function InternalReport({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const report = await loadReport(id);
  if (!report) notFound();
  return <ReportDocument report={report} internal />;
}
