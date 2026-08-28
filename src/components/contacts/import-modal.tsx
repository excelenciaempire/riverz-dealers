'use client';

import { useState, useRef, useMemo } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useWorkspace } from '@/hooks/use-workspace';
import { fetchAllRows } from '@/lib/supabase/paginate';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Upload, FileText, Loader2, CheckCircle, XCircle, Download } from 'lucide-react';
import { useT } from '@/hooks/use-locale';

interface ImportModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImported: () => void;
}

/** The four contact fields the import can populate. `phone` is required —
 *  it's the WhatsApp identity, so a row without it can't become a contact. */
type Field = 'phone' | 'name' | 'email' | 'company';
const FIELDS: Field[] = ['phone', 'name', 'email', 'company'];

/** Header synonyms (accent-stripped, lowercased) used to auto-guess which
 *  column maps to which field, so a Spanish OR English export both line up
 *  without the merchant touching anything. */
const SYNONYMS: Record<Field, string[]> = {
  phone: [
    'phone', 'telefono', 'tel', 'celular', 'movil', 'whatsapp', 'wa',
    'numero', 'number', 'cel', 'phonenumber', 'telefonocelular', 'contacto telefono',
  ],
  name: [
    'name', 'nombre', 'nombrecompleto', 'fullname', 'contacto', 'cliente',
    'firstname', 'nombres', 'nombreyapellido',
  ],
  email: ['email', 'correo', 'correoelectronico', 'mail', 'e-mail', 'emailaddress'],
  company: [
    'company', 'empresa', 'negocio', 'compania', 'organizacion', 'organization',
    'marca', 'tienda',
  ],
};

const norm = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

/** Detect the delimiter from the header line. Excel exported from a Spanish
 *  locale uses ';'; English/CSV uses ','. Tab-separated is also common. */
function detectDelimiter(headerLine: string): string {
  const counts: Record<string, number> = {
    ',': (headerLine.match(/,/g) ?? []).length,
    ';': (headerLine.match(/;/g) ?? []).length,
    '\t': (headerLine.match(/\t/g) ?? []).length,
  };
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
}

/** Full-text CSV tokenizer — handles quoted fields with embedded commas,
 *  doubled "" quotes and quoted newlines. Returns rows of raw string cells.
 *  No field-name assumptions: the caller maps columns afterwards. */
function parseCsv(text: string): string[][] {
  const firstLine = text.slice(0, text.indexOf('\n') === -1 ? undefined : text.indexOf('\n'));
  const delim = detectDelimiter(firstLine);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === delim) {
      row.push(field);
      field = '';
    } else if (c === '\r') {
      // ignore — handled by \n
    } else if (c === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += c;
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  // Drop fully-blank rows.
  return rows.filter((r) => r.some((f) => f.trim() !== ''));
}

const onlyDigits = (s: string) => s.replace(/\D/g, '');

export function ImportModal({ open, onOpenChange, onImported }: ImportModalProps) {
  const supabase = createClient();
  const { workspace } = useWorkspace();
  const t = useT();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [file, setFile] = useState<File | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [dataRows, setDataRows] = useState<string[][]>([]);
  // Column index per field (-1 = not mapped).
  const [mapping, setMapping] = useState<Record<Field, number>>({
    phone: -1,
    name: -1,
    email: -1,
    company: -1,
  });
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<{ imported: number; skipped: number; failed: number } | null>(null);

  function reset() {
    setFile(null);
    setHeaders([]);
    setDataRows([]);
    setMapping({ phone: -1, name: -1, email: -1, company: -1 });
    setResult(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  function handleOpenChange(open: boolean) {
    if (!open) reset();
    onOpenChange(open);
  }

  function downloadTemplate() {
    const csv = 'name,phone,email,company\nJuan Perez,573001112233,juan@example.com,Mi Empresa\n';
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = t('contacts.templateFileName');
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const selected = e.target.files?.[0];
    if (!selected) return;

    setFile(selected);
    setResult(null);

    const text = await selected.text();
    const rows = parseCsv(text);
    if (rows.length < 2) {
      toast.error(t('contacts.importNoValidRows'));
      setHeaders([]);
      setDataRows([]);
      return;
    }

    const head = rows[0].map((h) => h.trim());
    const body = rows.slice(1);
    setHeaders(head);
    setDataRows(body);

    // Auto-guess each field from the header names.
    const guess: Record<Field, number> = { phone: -1, name: -1, email: -1, company: -1 };
    head.forEach((h, idx) => {
      const n = norm(h);
      for (const field of FIELDS) {
        if (guess[field] === -1 && SYNONYMS[field].some((syn) => n === norm(syn) || n.includes(norm(syn)))) {
          guess[field] = idx;
        }
      }
    });
    setMapping(guess);
  }

  // Build the contact rows from the current mapping. Phone is required.
  const parsedRows = useMemo(() => {
    if (mapping.phone === -1) return [];
    const pick = (row: string[], idx: number) =>
      idx >= 0 ? (row[idx] ?? '').trim() : '';
    return dataRows
      .map((row) => ({
        phone: pick(row, mapping.phone),
        name: pick(row, mapping.name),
        email: pick(row, mapping.email),
        company: pick(row, mapping.company),
      }))
      .filter((r) => onlyDigits(r.phone).length > 0);
  }, [dataRows, mapping]);

  const preview = parsedRows.slice(0, 5);

  async function handleImport() {
    if (parsedRows.length === 0 || !workspace) return;
    setImporting(true);

    try {
      // Dedupe against contacts already in this workspace (and within the
      // file itself) by WhatsApp identity = phone digits. The unique index
      // (workspace_id, channel, external_id) would otherwise reject repeats
      // on re-import; we skip them cleanly instead of erroring.
      // Paginado: la lista de los que ya están se cortaba en 1.000, así que a
      // partir de ahí el importador no reconocía duplicados y los reintentaba.
      const existing = await fetchAllRows<{ external_id: string | null }>(
        (from, to) =>
          supabase
            .from('contacts')
            .select('external_id')
            .eq('workspace_id', workspace.id)
            .eq('channel', 'whatsapp')
            .order('id', { ascending: true })
            .range(from, to),
      );
      const seen = new Set(
        existing
          .map((c) => (c.external_id ? onlyDigits(String(c.external_id)) : ''))
          .filter(Boolean),
      );

      let imported = 0;
      let skipped = 0;
      let failed = 0;

      const toInsert: Record<string, unknown>[] = [];
      for (const row of parsedRows) {
        const externalId = onlyDigits(row.phone);
        if (seen.has(externalId)) {
          skipped++;
          continue;
        }
        seen.add(externalId);
        toInsert.push({
          workspace_id: workspace.id,
          channel: 'whatsapp',
          external_id: externalId,
          phone: row.phone,
          name: row.name || null,
          email: row.email || null,
          company: row.company || null,
        });
      }

      const chunkSize = 200;
      for (let i = 0; i < toInsert.length; i += chunkSize) {
        const chunk = toInsert.slice(i, i + chunkSize);
        const { data, error } = await supabase.from('contacts').insert(chunk).select('id');
        if (error) {
          // Retry the chunk row-by-row so one bad row (e.g. a late duplicate)
          // doesn't sink the other 199.
          for (const single of chunk) {
            const { error: singleErr } = await supabase.from('contacts').insert(single);
            if (singleErr) {
              // 23505 = unique violation → it already existed; count as skipped.
              if ((singleErr as { code?: string }).code === '23505') skipped++;
              else failed++;
            } else {
              imported++;
            }
          }
        } else {
          imported += data?.length ?? chunk.length;
        }
      }

      setResult({ imported, skipped, failed });
      if (imported > 0) {
        toast.success(t('contacts.importedToast', { count: imported }));
        onImported();
      } else if (skipped > 0 && failed === 0) {
        toast.success(t('contacts.importAllSkipped', { count: skipped }));
      }
      if (failed > 0) {
        toast.error(t('contacts.importFailedToast', { count: failed }));
      }
    } catch (err: unknown) {
      const message = t('contacts.importFailed');
      toast.error(message);
    } finally {
      setImporting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="bg-card border-border text-foreground sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="text-foreground">{t('contacts.importContacts')}</DialogTitle>
          <DialogDescription className="text-muted-foreground">
            {t('contacts.importIntro')}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Template + upload */}
          {!result && (
            <button
              type="button"
              onClick={downloadTemplate}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-accent-ink hover:underline"
            >
              <Download className="size-3.5" />
              {t('contacts.downloadTemplate')}
            </button>
          )}

          {/* Upload area */}
          {!result && (
            <div
              onClick={() => fileInputRef.current?.click()}
              className="flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border p-6 cursor-pointer hover:border-primary/50 transition-colors"
            >
              {file ? (
                <>
                  <FileText className="size-8 text-accent-ink" />
                  <p className="text-sm text-foreground">{file.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {t('contacts.importRowsDetected', { count: parsedRows.length })}
                  </p>
                </>
              ) : (
                <>
                  <Upload className="size-8 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">{t('contacts.uploadCsvPrompt')}</p>
                </>
              )}
            </div>
          )}

          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,text/csv"
            onChange={handleFileChange}
            className="hidden"
          />

          {/* Column mapping */}
          {headers.length > 0 && !result && (
            <div className="space-y-2">
              <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                {t('contacts.mapColumns')}
              </p>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {FIELDS.map((field) => (
                  <label key={field} className="flex items-center justify-between gap-2 rounded-md border border-border bg-muted/40 px-2.5 py-1.5">
                    <span className="text-xs text-foreground">
                      {t(`contacts.col${field[0].toUpperCase()}${field.slice(1)}`)}
                      {field === 'phone' && <span className="text-red-700 dark:text-red-400"> *</span>}
                    </span>
                    <select
                      value={mapping[field]}
                      onChange={(e) =>
                        setMapping((m) => ({ ...m, [field]: Number(e.target.value) }))
                      }
                      className="max-w-[55%] rounded border border-border bg-card px-1.5 py-1 text-xs text-foreground focus:border-primary focus:outline-none"
                    >
                      <option value={-1}>{t('contacts.columnNone')}</option>
                      {headers.map((h, idx) => (
                        <option key={idx} value={idx}>
                          {h || `#${idx + 1}`}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>
              {mapping.phone === -1 && (
                <p className="text-xs text-amber-600 dark:text-amber-400">
                  {t('contacts.importNeedPhone')}
                </p>
              )}
            </div>
          )}

          {/* Preview table */}
          {preview.length > 0 && !result && (
            <div className="space-y-2">
              <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                {t('contacts.preview')}
              </p>
              <div className="overflow-hidden rounded-lg border border-border">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-muted">
                      <th className="px-3 py-1.5 text-left font-medium text-muted-foreground">{t('contacts.colPhone')}</th>
                      <th className="px-3 py-1.5 text-left font-medium text-muted-foreground">{t('contacts.colName')}</th>
                      <th className="px-3 py-1.5 text-left font-medium text-muted-foreground">{t('contacts.colEmail')}</th>
                      <th className="px-3 py-1.5 text-left font-medium text-muted-foreground">{t('contacts.colCompany')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.map((row, i) => (
                      <tr key={i} className="border-t border-border/50">
                        <td className="px-3 py-1.5 text-foreground">{row.phone}</td>
                        <td className="px-3 py-1.5 text-foreground">{row.name || '-'}</td>
                        <td className="px-3 py-1.5 text-foreground">{row.email || '-'}</td>
                        <td className="px-3 py-1.5 text-foreground">{row.company || '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {parsedRows.length > 5 && (
                <p className="text-xs text-muted-foreground">
                  {t('contacts.andMoreRows', { count: parsedRows.length - 5 })}
                </p>
              )}
            </div>
          )}

          {/* Results */}
          {result && (
            <div className="space-y-2 rounded-lg border border-border p-4">
              <div className="flex flex-wrap items-center gap-4">
                {result.imported > 0 && (
                  <div className="flex items-center gap-1.5 text-sm text-accent-ink">
                    <CheckCircle className="size-4" />
                    {t('contacts.importedCount', { count: result.imported })}
                  </div>
                )}
                {result.skipped > 0 && (
                  <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                    {t('contacts.skippedCount', { count: result.skipped })}
                  </div>
                )}
                {result.failed > 0 && (
                  <div className="flex items-center gap-1.5 text-sm text-red-700 dark:text-red-400">
                    <XCircle className="size-4" />
                    {t('contacts.failedCount', { count: result.failed })}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="bg-card border-border">
          <Button
            type="button"
            variant="outline"
            onClick={() => handleOpenChange(false)}
            className="border-border text-foreground hover:bg-accent"
          >
            {result ? t('contacts.close') : t('contacts.cancel')}
          </Button>
          {!result && (
            <Button
              type="button"
              disabled={parsedRows.length === 0 || importing}
              onClick={handleImport}
              className="bg-primary hover:bg-primary/90 text-primary-foreground"
            >
              {importing && <Loader2 className="size-4 animate-spin" />}
              {parsedRows.length > 0
                ? t('contacts.importCount', { count: parsedRows.length })
                : t('contacts.importEmpty')}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
