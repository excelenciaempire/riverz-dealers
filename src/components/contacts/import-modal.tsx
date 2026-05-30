'use client';

import { useState, useRef } from 'react';
import { createClient } from '@/lib/supabase/client';
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
import { Upload, FileText, Loader2, CheckCircle, XCircle } from 'lucide-react';

interface ImportModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImported: () => void;
}

interface ParsedRow {
  phone: string;
  name?: string;
  email?: string;
  company?: string;
}

function parseCSV(text: string): ParsedRow[] {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return [];

  const headerLine = lines[0];
  const headers = headerLine.split(',').map((h) => h.trim().toLowerCase().replace(/["']/g, ''));

  const phoneIdx = headers.indexOf('phone');
  if (phoneIdx === -1) return [];

  const nameIdx = headers.indexOf('name');
  const emailIdx = headers.indexOf('email');
  const companyIdx = headers.indexOf('company');

  const rows: ParsedRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    // Simple CSV parse (handles quoted fields)
    const values: string[] = [];
    let current = '';
    let inQuotes = false;
    for (const char of line) {
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        values.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    values.push(current.trim());

    const phone = values[phoneIdx]?.replace(/["']/g, '').trim();
    if (!phone) continue;

    rows.push({
      phone,
      name: nameIdx >= 0 ? values[nameIdx]?.replace(/["']/g, '').trim() || undefined : undefined,
      email: emailIdx >= 0 ? values[emailIdx]?.replace(/["']/g, '').trim() || undefined : undefined,
      company:
        companyIdx >= 0 ? values[companyIdx]?.replace(/["']/g, '').trim() || undefined : undefined,
    });
  }

  return rows;
}

export function ImportModal({ open, onOpenChange, onImported }: ImportModalProps) {
  const supabase = createClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [file, setFile] = useState<File | null>(null);
  const [parsedRows, setParsedRows] = useState<ParsedRow[]>([]);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<{ imported: number; failed: number } | null>(null);

  function reset() {
    setFile(null);
    setParsedRows([]);
    setResult(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  function handleOpenChange(open: boolean) {
    if (!open) reset();
    onOpenChange(open);
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const selected = e.target.files?.[0];
    if (!selected) return;

    setFile(selected);
    setResult(null);

    const text = await selected.text();
    const rows = parseCSV(text);

    if (rows.length === 0) {
      toast.error('No se encontraron filas válidas. Asegúrate de que el CSV tenga una columna "phone".');
      setParsedRows([]);
      return;
    }

    setParsedRows(rows);
  }

  async function handleImport() {
    if (parsedRows.length === 0) return;
    setImporting(true);

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const user = session?.user;
      if (!user) throw new Error('No autenticado');

      let imported = 0;
      let failed = 0;

      // Batch insert in chunks of 50
      const chunkSize = 50;
      for (let i = 0; i < parsedRows.length; i += chunkSize) {
        const chunk = parsedRows.slice(i, i + chunkSize);
        const rows = chunk.map((row) => ({
          user_id: user.id,
          phone: row.phone,
          name: row.name || null,
          email: row.email || null,
          company: row.company || null,
        }));

        const { data, error } = await supabase
          .from('contacts')
          .insert(rows)
          .select('id');

        if (error) {
          // Try individual inserts for this chunk
          for (const row of rows) {
            const { error: singleErr } = await supabase.from('contacts').insert(row);
            if (singleErr) {
              failed++;
            } else {
              imported++;
            }
          }
        } else {
          imported += data?.length ?? chunk.length;
        }
      }

      setResult({ imported, failed });
      if (imported > 0) {
        toast.success(`${imported} contacto${imported !== 1 ? 's' : ''} importado${imported !== 1 ? 's' : ''}`);
        onImported();
      }
      if (failed > 0) {
        toast.error(`No se pudo importar ${failed} contacto${failed !== 1 ? 's' : ''}`);
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Falló la importación';
      toast.error(message);
    } finally {
      setImporting(false);
    }
  }

  const preview = parsedRows.slice(0, 5);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="bg-card border-border text-foreground sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-foreground">Importar contactos</DialogTitle>
          <DialogDescription className="text-muted-foreground">
            Sube un archivo CSV con una columna &quot;phone&quot; (obligatoria). Columnas opcionales:
            name, email, company.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Upload area */}
          <div
            onClick={() => fileInputRef.current?.click()}
            className="flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border p-6 cursor-pointer hover:border-primary/50 transition-colors"
          >
            {file ? (
              <>
                <FileText className="size-8 text-accent-ink" />
                <p className="text-sm text-foreground">{file.name}</p>
                <p className="text-xs text-muted-foreground">
                  {parsedRows.length} fila{parsedRows.length !== 1 ? 's' : ''} detectada{parsedRows.length !== 1 ? 's' : ''}
                </p>
              </>
            ) : (
              <>
                <Upload className="size-8 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">
                  Haz clic para subir un CSV
                </p>
              </>
            )}
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,text/csv"
            onChange={handleFileChange}
            className="hidden"
          />

          {/* Preview table */}
          {preview.length > 0 && !result && (
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Vista previa (primeras {preview.length} filas)
              </p>
              <div className="rounded-lg border border-border overflow-hidden">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-muted">
                      <th className="px-3 py-1.5 text-left text-muted-foreground font-medium">Teléfono</th>
                      <th className="px-3 py-1.5 text-left text-muted-foreground font-medium">Nombre</th>
                      <th className="px-3 py-1.5 text-left text-muted-foreground font-medium">Correo</th>
                      <th className="px-3 py-1.5 text-left text-muted-foreground font-medium">Empresa</th>
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
                  ...y {parsedRows.length - 5} filas más
                </p>
              )}
            </div>
          )}

          {/* Results */}
          {result && (
            <div className="rounded-lg border border-border p-4 space-y-2">
              <p className="text-sm font-medium text-foreground">Importación completada</p>
              <div className="flex items-center gap-4">
                {result.imported > 0 && (
                  <div className="flex items-center gap-1.5 text-accent-ink text-sm">
                    <CheckCircle className="size-4" />
                    {result.imported} importado{result.imported !== 1 ? 's' : ''}
                  </div>
                )}
                {result.failed > 0 && (
                  <div className="flex items-center gap-1.5 text-red-400 text-sm">
                    <XCircle className="size-4" />
                    {result.failed} con error
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
            {result ? 'Cerrar' : 'Cancelar'}
          </Button>
          {!result && (
            <Button
              type="button"
              disabled={parsedRows.length === 0 || importing}
              onClick={handleImport}
              className="bg-primary hover:bg-primary/90 text-primary-foreground"
            >
              {importing && <Loader2 className="size-4 animate-spin" />}
              Importar {parsedRows.length > 0 ? `${parsedRows.length} contacto${parsedRows.length !== 1 ? 's' : ''}` : ''}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
