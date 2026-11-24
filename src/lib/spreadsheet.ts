import * as XLSX from 'xlsx';

export function parseSpreadsheetBuffer(
  buffer: ArrayBuffer,
  fileName: string
): Record<string, string>[] {
  const isCsv = fileName.toLowerCase().endsWith('.csv');
  const wb = isCsv
    ? XLSX.read(new TextDecoder('utf-8').decode(buffer).replace(/^\uFEFF/, ''), {
        type: 'string',
      })
    : XLSX.read(buffer, { type: 'array' });

  const firstSheet = wb.SheetNames[0];
  if (!firstSheet) {
    throw new Error('الملف لا يحتوي على أي ورقة بيانات.');
  }
  const ws = wb.Sheets[firstSheet];
  const jsonRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '' });
  return jsonRows.map((row) => {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(row)) {
      const cleanKey = k.replace(/^\uFEFF/, '').trim();
      out[cleanKey] = String(v ?? '').trim();
    }
    return out;
  });
}
