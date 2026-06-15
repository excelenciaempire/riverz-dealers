'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
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
import { useFetchWithCsrf } from '@/lib/api/fetch-with-csrf';
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
import { PLACEHOLDER_TEMPLATES } from '@/lib/templates/placeholder-data';

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
  const router = useRouter();
  const fetchWithCsrf = useFetchWithCsrf();
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
      const res = await fetchWithCsrf('/api/whatsapp/templates/sync', { method: 'POST' });
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
              Estas filas son de ejemplo. Desaparecen cuando creas o sincronizas tus plantillas de Meta.
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
                      className="cursor-pointer border-border hover:bg-muted/40"
                      onClick={() => router.push(`/plantillas/${template.id}`)}
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
                      <TableCell
                        className="w-10 text-right"
                        onClick={(e) => e.stopPropagation()}
                      >
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

