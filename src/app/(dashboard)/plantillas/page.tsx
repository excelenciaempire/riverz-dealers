'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import {
  Loader2,
  Plus,
  RefreshCw,
  Trash2,
  Search,
  Info,
  ExternalLink,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';
import type { MessageTemplate } from '@/types';

const CATEGORY_LABELS: Record<string, string> = {
  Marketing: 'Marketing',
  Utility: 'Utilidad',
  Authentication: 'Autenticación',
};

const STATUS_LABELS: Record<string, string> = {
  Draft: 'Borrador',
  Pending: 'Pendiente',
  Approved: 'Aprobada',
  Rejected: 'Rechazada',
};

/**
 * Status pill — only color the states the merchant needs to react to:
 * Approved (verde sutil) and Rejected (rojo sutil). Borrador y Pendiente
 * quedan neutros para reducir ruido cromático.
 */
function StatusPill({ status }: { status: string }) {
  const tone =
    status === 'Approved'
      ? 'border-emerald-600/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300'
      : status === 'Rejected'
        ? 'border-red-600/30 bg-red-500/10 text-red-600 dark:text-red-300'
        : status === 'Pending'
          ? 'border-amber-600/25 bg-amber-500/10 text-amber-700 dark:text-amber-300'
          : 'border-border bg-muted text-muted-foreground';
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium',
        tone,
      )}
    >
      {STATUS_LABELS[status] ?? status}
    </span>
  );
}

function formatRelative(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('es-ES', { day: '2-digit', month: 'short' });
}

export default function TemplatesPage() {
  const supabase = createClient();
  const { user, loading: authLoading } = useAuth();

  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [templates, setTemplates] = useState<MessageTemplate[]>([]);
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      setLoading(false);
      return;
    }
    void fetchTemplates(user.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, user?.id]);

  async function fetchTemplates(userId: string) {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('message_templates')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      setTemplates(data || []);
    } catch (err) {
      console.error('Failed to fetch templates:', err);
      toast.error('No se cargaron las plantillas');
    } finally {
      setLoading(false);
    }
  }

  async function handleSync() {
    if (!user) return;
    setSyncing(true);
    try {
      const res = await fetch('/api/whatsapp/templates/sync', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Sincronización fallida');
      toast.success(
        `${data.total} plantilla${data.total === 1 ? '' : 's'} sincronizada${data.total === 1 ? '' : 's'} desde Meta`,
      );
      await fetchTemplates(user.id);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se pudo sincronizar');
    } finally {
      setSyncing(false);
    }
  }

  async function handleDelete(id: string) {
    try {
      const { error } = await supabase
        .from('message_templates')
        .delete()
        .eq('id', id);
      if (error) throw error;
      toast.success('Plantilla eliminada');
      setTemplates((prev) => prev.filter((t) => t.id !== id));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se pudo eliminar');
    }
  }

  const rows = templates.length === 0 ? PLACEHOLDER_TEMPLATES : templates;
  const filteredRows = useMemo(() => {
    if (!query.trim()) return rows;
    const q = query.trim().toLowerCase();
    return rows.filter(
      (t) =>
        t.name.toLowerCase().includes(q) ||
        (t.body_text ?? '').toLowerCase().includes(q) ||
        (t.category ?? '').toLowerCase().includes(q),
    );
  }, [rows, query]);

  return (
    <div className="space-y-5">
      {/* ── Header ── */}
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          Plantillas de WhatsApp
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Prepará el mensaje antes de enviarlo a tus clientes.{' '}
          <a
            href="https://www.facebook.com/business/help/2055875911147364"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-0.5 text-foreground underline underline-offset-2 hover:text-accent-ink"
          >
            Saber más
            <ExternalLink className="size-3" />
          </a>
        </p>
      </div>

      {/* ── Top toolbar: search + actions ── */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full max-w-md">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar plantilla…"
            className="h-9 pl-8"
          />
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={handleSync}
            disabled={syncing}
            className="h-9 border-border bg-transparent text-foreground hover:bg-muted"
          >
            <RefreshCw className={cn('size-4', syncing && 'animate-spin')} />
            {syncing ? 'Sincronizando…' : 'Sincronizar'}
          </Button>
          <Button
            render={<Link href="/plantillas/nueva" />}
            className="h-9 bg-foreground text-background hover:bg-foreground/90"
          >
            <Plus className="size-4" />
            Nueva plantilla
          </Button>
        </div>
      </div>

      {/* ── Empty-state info banner (only when real list is empty) ── */}
      {!loading && templates.length === 0 && (
        <div className="flex items-start gap-2.5 rounded-lg border border-border bg-muted/40 px-3.5 py-2.5">
          <Info className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-foreground">
              Vista previa con datos de ejemplo
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Estas filas son ilustrativas — desaparecen cuando creás tu primera plantilla o sincronizás las que ya tenés en Meta.
            </p>
          </div>
        </div>
      )}

      {/* ── Table ── */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border bg-card">
          <Table>
            <TableHeader>
              <TableRow className="border-border hover:bg-transparent">
                <TableHead className="text-xs font-medium text-muted-foreground">
                  Nombre
                </TableHead>
                <TableHead className="text-xs font-medium text-muted-foreground">
                  Categoría
                </TableHead>
                <TableHead className="hidden text-xs font-medium text-muted-foreground md:table-cell">
                  Mensaje
                </TableHead>
                <TableHead className="text-xs font-medium text-muted-foreground">
                  Estado
                </TableHead>
                <TableHead className="hidden text-xs font-medium text-muted-foreground sm:table-cell">
                  Actualizada
                </TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredRows.length === 0 ? (
                <TableRow className="border-border hover:bg-transparent">
                  <TableCell
                    colSpan={6}
                    className="py-10 text-center text-sm text-muted-foreground"
                  >
                    No encontramos plantillas que coincidan con “{query}”.
                  </TableCell>
                </TableRow>
              ) : (
                filteredRows.map((template) => {
                  const isPlaceholder = template.id.startsWith('demo-');
                  return (
                    <TableRow
                      key={template.id}
                      className="border-border hover:bg-muted/40"
                    >
                      <TableCell className="font-medium text-foreground">
                        {template.name}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {CATEGORY_LABELS[template.category] ?? template.category}
                      </TableCell>
                      <TableCell className="hidden max-w-[420px] truncate text-sm text-muted-foreground md:table-cell">
                        {template.body_text}
                      </TableCell>
                      <TableCell>
                        <StatusPill status={template.status || 'Draft'} />
                      </TableCell>
                      <TableCell className="hidden whitespace-nowrap text-sm text-muted-foreground sm:table-cell">
                        {formatRelative(template.created_at)}
                      </TableCell>
                      <TableCell className="w-10 text-right">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() =>
                            !isPlaceholder && handleDelete(template.id)
                          }
                          disabled={isPlaceholder}
                          className="h-7 w-7 text-muted-foreground hover:bg-red-500/10 hover:text-red-500 disabled:cursor-default disabled:opacity-30"
                          aria-label="Eliminar plantilla"
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

// ============================================================
// Placeholder data — shown while the merchant doesn't have any real
// templates yet so the list reads as populated. Rows have id "demo-*"
// so the delete handler short-circuits.
// ============================================================
const PLACEHOLDER_TEMPLATES: MessageTemplate[] = [
  {
    id: 'demo-1',
    user_id: 'demo',
    name: 'bienvenida_nuevo_cliente',
    category: 'Utility',
    language: 'es',
    header_type: 'text',
    header_content: '¡Bienvenido a Vitalú!',
    body_text:
      'Hola {{1}}, gracias por unirte a Vitalú. Soy María, tu asesora. ¿En qué te puedo ayudar hoy?',
    footer_text: 'Equipo Vitalú',
    buttons: undefined,
    status: 'Approved',
    created_at: new Date(Date.now() - 1000 * 60 * 60 * 24 * 7).toISOString(),
  } as unknown as MessageTemplate,
  {
    id: 'demo-2',
    user_id: 'demo',
    name: 'confirmacion_pedido',
    category: 'Utility',
    language: 'es',
    body_text:
      '¡Listo {{1}}! Tu pedido {{2}} fue confirmado por {{3}}. Te avisamos cuando salga del centro de despacho.',
    status: 'Approved',
    created_at: new Date(Date.now() - 1000 * 60 * 60 * 24 * 5).toISOString(),
  } as unknown as MessageTemplate,
  {
    id: 'demo-3',
    user_id: 'demo',
    name: 'despacho_con_tracking',
    category: 'Utility',
    language: 'es',
    body_text:
      '¡Tu pedido {{1}} ya está en camino! Lo lleva {{2}} con la guía {{3}}. Seguilo con el botón de abajo.',
    footer_text: 'Llega entre 2 y 5 días hábiles.',
    status: 'Approved',
    created_at: new Date(Date.now() - 1000 * 60 * 60 * 24 * 4).toISOString(),
  } as unknown as MessageTemplate,
  {
    id: 'demo-4',
    user_id: 'demo',
    name: 'carrito_abandonado_24h',
    category: 'Marketing',
    language: 'es',
    header_type: 'text',
    header_content: '¿Lo dejaste pendiente?',
    body_text:
      'Hola {{1}}, ayer dejaste {{2}} en el carrito. Te dejamos un 10% con el código VUELVE10 — vale por 24 horas.',
    footer_text: 'Sin presión, tú sabes cuándo es el momento.',
    status: 'Approved',
    created_at: new Date(Date.now() - 1000 * 60 * 60 * 24 * 3).toISOString(),
  } as unknown as MessageTemplate,
  {
    id: 'demo-5',
    user_id: 'demo',
    name: 'recompra_30dias',
    category: 'Marketing',
    language: 'es',
    body_text:
      'Hola {{1}}, hace un mes pediste {{2}}. ¿Cómo te fue? Si necesitas reponer, te dejamos envío gratis con FIDELIDAD.',
    status: 'Pending',
    created_at: new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString(),
  } as unknown as MessageTemplate,
  {
    id: 'demo-6',
    user_id: 'demo',
    name: 'codigo_verificacion_otp',
    category: 'Authentication',
    language: 'es',
    body_text:
      'Tu código de verificación de Vitalú es {{1}}. Vence en 10 minutos. No lo compartas con nadie.',
    footer_text: 'Si no fuiste tú, ignorá este mensaje.',
    status: 'Draft',
    created_at: new Date(Date.now() - 1000 * 60 * 30).toISOString(),
  } as unknown as MessageTemplate,
  {
    id: 'demo-7',
    user_id: 'demo',
    name: 'aviso_stock_agotado',
    category: 'Utility',
    language: 'es',
    body_text:
      'Hola {{1}}, lamentablemente {{2}} se agotó antes de despacharlo. Te devolvemos el dinero a {{3}} en 24-48 hs. Disculpá la molestia.',
    status: 'Rejected',
    created_at: new Date(Date.now() - 1000 * 60 * 60 * 24 * 10).toISOString(),
  } as unknown as MessageTemplate,
];
