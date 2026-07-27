/**
 * CSV de descarga — una sola implementación para toda la app (contactos,
 * registro de llamadas, lo que venga). Sin ella cada pantalla reinventaba el
 * escapado y el BOM, y bastaba olvidarse de uno para que Excel abriera el
 * archivo con las tildes rotas.
 */

/** Escapa un valor para CSV (comillas, comas, saltos de línea). */
export function csvCell(v: unknown): string {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * Dispara la descarga de un CSV. Lleva BOM UTF-8 adelante para que Excel
 * respete tildes y ñ, y el nombre del archivo termina en la fecha del día.
 */
export function downloadCsv(
  filename: string,
  headers: string[],
  rows: Array<Array<string | number | null | undefined>>,
): void {
  const lines = [headers.map(csvCell).join(',')];
  for (const row of rows) lines.push(row.map(csvCell).join(','));
  const csv = '﻿' + lines.join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${filename}-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
