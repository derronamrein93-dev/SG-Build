/** Reporting is disabled until real staff authentication replaces the demo context. */
export function assertReportingAccess(): void {
  if (process.env.NODE_ENV === 'production' || process.env.FITOS_REPORTING_DEMO_ENABLED !== 'true') {
    throw new Error('Reporting requires authenticated staff access.');
  }
}
