'use client';

import { useState } from 'react';

type Preview = {
  valid?: boolean;
  transactionCount?: number;
  lineCount?: number;
  totalCents?: number;
  sampleTransactionIds?: string[];
  note?: string;
  error?: string;
};

export default function CsvPreview() {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [loading, setLoading] = useState(false);
  async function inspect() {
    if (!file) return;
    setLoading(true);
    setPreview(null);
    try {
      if (file.size > 1024 * 1024) throw new Error('File exceeds 1 MiB');
      const response = await fetch('/api/reporting/sales/preview?source=manual_csv', {
        method: 'POST', body: await file.text(),
        headers: { 'Content-Type': 'text/csv' }, cache: 'no-store',
      });
      const result = await response.json() as Preview;
      if (!response.ok) throw new Error(result.error ?? 'CSV preview failed');
      setPreview(result);
    } catch (error) {
      setPreview({ valid: false, error: error instanceof Error ? error.message : 'Preview failed' });
    } finally {
      setLoading(false);
    }
  }
  return (
    <div className="card mt-6 space-y-4">
      <label className="label block" htmlFor="salesCsv">Select a CSV file (maximum 1 MiB)</label>
      <input id="salesCsv" type="file" accept=".csv,text/csv" className="block w-full"
        onChange={e => { setFile(e.target.files?.[0] ?? null); setPreview(null); }} />
      <button className="btn-primary" type="button" disabled={!file || loading} onClick={inspect}>
        {loading ? 'Validating…' : 'Validate CSV'}
      </button>
      {preview && (
        <div role="status" className="border-t border-line-strong pt-4 text-[14px]">
          {preview.valid ? (
            <>
              <p className="font-semibold">Validation passed. No sales have been saved.</p>
              <p className="mt-2">{preview.transactionCount} transactions · {preview.lineCount} line items</p>
              <p>Sales total: {new Intl.NumberFormat('en-US', {
                style: 'currency', currency: 'USD',
              }).format((preview.totalCents ?? 0) / 100)}</p>
              <p className="text-ink-muted mt-2">Review transaction IDs: {preview.sampleTransactionIds?.join(', ')}</p>
            </>
          ) : <p className="text-alert">{preview.error}</p>}
        </div>
      )}
    </div>
  );
}
