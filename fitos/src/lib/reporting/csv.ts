/** RFC4180 cell quoting plus spreadsheet formula-injection mitigation. */
export function csvCell(value: unknown): string {
  const raw = value == null ? '' : String(value);
  const escaped = /^[\s\u0000-\u001f]*[=+@\-\t\r]/.test(raw) ? "'" + raw : raw;
  return '"' + escaped.replace(/"/g, '""') + '"';
}
export function csvRows(rows: unknown[][]): string {
  return rows.map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}
