import { notFound } from 'next/navigation';
import { loadReportByToken } from '../../../lib/reports';
import ReportDocument from '../../../components/ReportDocument';

export const dynamic = 'force-dynamic';

/**
 * The public customer report. Resolves ONLY through the hashed token — an
 * expired, revoked, unknown or malformed token is a 404, and a session id is
 * not an accepted input on this route at all.
 */
export default async function PublicReport({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const report = await loadReportByToken(token);
  if (!report) notFound();
  return <ReportDocument report={report} />;
}
