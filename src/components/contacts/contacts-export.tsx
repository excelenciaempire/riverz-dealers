'use client';

import { useState } from 'react';
import { Download, Loader2 } from 'lucide-react';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Contact, Tag } from '@/types';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { useT } from '@/hooks/use-locale';
import { downloadCsv } from '@/lib/export/csv';

type FmtLike = { date: (v: string | number | Date, o?: Intl.DateTimeFormatOptions) => string };

function sdOf(c: Contact): Record<string, unknown> | null {
  return (c as unknown as { shopify_customer_data?: Record<string, unknown> | null })
    .shopify_customer_data ?? null;
}
function addrOf(c: Contact): Record<string, unknown> | null {
  const s = sdOf(c);
  return (s?.default_address ?? s?.address ?? null) as Record<string, unknown> | null;
}

export interface ExportColumn {
  key: string;
  labelKey: string;
  get: (c: Contact, tags: string[], fmt: FmtLike) => string;
}

/** Columna ya resuelta a su encabezado en el idioma activo. */
export type ResolvedColumn = { header: string; get: ExportColumn['get'] };

/** Todas las columnas exportables. El usuario elige cuáles antes de exportar. */
export const EXPORT_COLUMNS: ExportColumn[] = [
  { key: 'name', labelKey: 'contacts.colName', get: (c) => c.name ?? '' },
  { key: 'phone', labelKey: 'contacts.colPhone', get: (c) => c.phone ?? '' },
  { key: 'email', labelKey: 'contacts.colEmail', get: (c) => c.email ?? '' },
  { key: 'company', labelKey: 'contacts.colCompany', get: (c) => c.company ?? '' },
  { key: 'tags', labelKey: 'contacts.colTags', get: (_c, tags) => tags.join('; ') },
  { key: 'shopify', labelKey: 'contacts.shopifyCustomer', get: (c) => (c.is_shopify_customer ? 'Sí' : 'No') },
  { key: 'total_spent', labelKey: 'contacts.shopTotalSpent', get: (c) => String(sdOf(c)?.total_spent ?? sdOf(c)?.totalSpent ?? '') },
  { key: 'currency', labelKey: 'contacts.shopCurrency', get: (c) => String(sdOf(c)?.currency ?? '') },
  { key: 'orders', labelKey: 'contacts.shopOrders', get: (c) => String(sdOf(c)?.orders_count ?? sdOf(c)?.ordersCount ?? '') },
  { key: 'last_purchase', labelKey: 'contacts.buyLast', get: (c, _tags, fmt) => { const d = sdOf(c)?.last_order_date; return d ? fmt.date(String(d), { year: 'numeric', month: '2-digit', day: '2-digit' }) : ''; } },
  { key: 'address', labelKey: 'contacts.shopAddress', get: (c) => { const a = addrOf(c); return a ? [a.address1, a.address2].filter(Boolean).join(' ') : ''; } },
  { key: 'city', labelKey: 'contacts.shopCity', get: (c) => String(addrOf(c)?.city ?? '') },
  { key: 'province', labelKey: 'contacts.shopProvince', get: (c) => String(addrOf(c)?.province ?? '') },
  { key: 'country', labelKey: 'contacts.shopCountry', get: (c) => String(addrOf(c)?.country ?? '') },
  { key: 'zip', labelKey: 'contacts.shopZip', get: (c) => String(addrOf(c)?.zip ?? '') },
  { key: 'channel', labelKey: 'contacts.colChannel', get: (c) => String((c as unknown as { channel?: string }).channel ?? '') },
  { key: 'created', labelKey: 'contacts.colCreated', get: (c, _tags, fmt) => (c.created_at ? fmt.date(c.created_at, { year: 'numeric', month: '2-digit', day: '2-digit' }) : '') },
];

/**
 * Descarga los contactos como CSV usando SOLO las columnas elegidas por el
 * usuario (en el orden de EXPORT_COLUMNS).
 */
export function downloadContactsCsv(
  rows: Contact[],
  tagsByContact: Record<string, string[]>,
  fmt: FmtLike,
  columns: ResolvedColumn[],
  filename = 'contactos',
): void {
  downloadCsv(
    filename,
    columns.map((col) => col.header),
    rows.map((c) => columns.map((col) => col.get(c, tagsByContact[c.id] ?? [], fmt))),
  );
}

/**
 * Nombres de etiqueta por contacto, en lotes: un `.in()` con miles de UUIDs
 * revienta el límite de URL de PostgREST y trunca en silencio.
 */
export async function tagNamesByContact(
  supabase: SupabaseClient,
  ids: string[],
  tagsById: Record<string, Tag>,
): Promise<Record<string, string[]>> {
  const out: Record<string, string[]> = {};
  const PAGE = 1000;
  for (let i = 0; i < ids.length; i += 300) {
    const chunk = ids.slice(i, i + 300);
    // Y dentro de cada lote se pagina: un contacto tiene varias etiquetas, así
    // que 300 contactos pasan de las 1.000 filas que PostgREST devuelve como
    // máximo por respuesta — sin esto el CSV salía con etiquetas de menos. El
    // orden explícito evita que las páginas se solapen.
    for (let from = 0; ; from += PAGE) {
      const { data } = await supabase
        .from('contact_tags')
        .select('contact_id, tag_id')
        .in('contact_id', chunk)
        .order('contact_id', { ascending: true })
        .order('tag_id', { ascending: true })
        .range(from, from + PAGE - 1);
      const rows = (data ?? []) as Array<{ contact_id: string; tag_id: string }>;
      rows.forEach((ct) => {
        const name = tagsById[ct.tag_id]?.name;
        if (!name) return;
        (out[ct.contact_id] ??= []).push(name);
      });
      if (rows.length < PAGE) break;
    }
  }
  return out;
}

/**
 * Selector de columnas del CSV. Mismo diálogo para exportar una selección de
 * contactos o un segmento guardado, así el CSV sale igual desde cualquier lado.
 */
export function ExportColumnsDialog({
  open,
  onOpenChange,
  count,
  exporting,
  onExport,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  count: number;
  exporting: boolean;
  onExport: (columns: ResolvedColumn[]) => void | Promise<void>;
}) {
  const t = useT();
  const [cols, setCols] = useState<Set<string>>(
    () => new Set(EXPORT_COLUMNS.map((c) => c.key)),
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-card border-border text-foreground sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-foreground">{t('contacts.exportColumnsTitle')}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">
              {t('contacts.exportColumnsHint', { count })}
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                className="text-accent-ink hover:underline"
                onClick={() => setCols(new Set(EXPORT_COLUMNS.map((c) => c.key)))}
              >
                {t('contacts.selectAllCols')}
              </button>
              <button
                type="button"
                className="text-muted-foreground hover:text-foreground"
                onClick={() => setCols(new Set())}
              >
                {t('contacts.selectNoneCols')}
              </button>
            </div>
          </div>
          <div className="grid max-h-72 grid-cols-2 gap-x-4 gap-y-2 overflow-y-auto pr-1">
            {EXPORT_COLUMNS.map((col) => (
              <label key={col.key} className="flex cursor-pointer items-center gap-2 text-sm text-foreground">
                <input
                  type="checkbox"
                  checked={cols.has(col.key)}
                  onChange={() =>
                    setCols((prev) => {
                      const next = new Set(prev);
                      if (next.has(col.key)) next.delete(col.key);
                      else next.add(col.key);
                      return next;
                    })
                  }
                  className="size-4 cursor-pointer accent-primary"
                />
                {t(col.labelKey)}
              </label>
            ))}
          </div>
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="border-border text-foreground hover:bg-accent"
          >
            {t('contacts.cancel')}
          </Button>
          <Button
            onClick={() =>
              onExport(
                EXPORT_COLUMNS.filter((c) => cols.has(c.key)).map((c) => ({
                  header: t(c.labelKey),
                  get: c.get,
                })),
              )
            }
            disabled={exporting || cols.size === 0}
            className="bg-primary text-primary-foreground hover:bg-primary/90"
          >
            {exporting ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
            {t('contacts.exportCsv')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
