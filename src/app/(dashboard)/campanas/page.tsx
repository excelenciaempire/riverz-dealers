'use client';

import { useEffect, useState, useMemo, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Broadcast } from '@/types';
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
import { Plus, Loader2, Search, Info, ExternalLink } from 'lucide-react';
import { cn } from '@/lib/utils';
import { getBroadcastStatus } from '@/lib/broadcast-status';

/**
 * Poll cadence while any broadcast is sending. Kept modest so we don't
 * beat on Supabase — the aggregate trigger in migration 003 keeps
 * counts consistent; we just need to surface the freshest snapshot.
 */
const POLL_INTERVAL_MS = 5_000;

function percent(numerator: number, denominator: number): number {
  if (!denominator) return 0;
  return Math.round((numerator / denominator) * 100);
}

/**
 * RateCell — solo el número, sin barra coloreada. El competidor que el
 * cliente compartió usa puro texto tabular; menos ruido cromático.
 */
function RateCell({ value, total }: { value: number; total: number }) {
  if (!total) {
    return <span className="text-sm text-muted-foreground">—</span>;
  }
  return (
    <span className="text-sm tabular-nums text-foreground">
      {percent(value, total)}%
    </span>
  );
}

export default function BroadcastsPage() {
  const router = useRouter();
  const [broadcasts, setBroadcasts] = useState<Broadcast[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  // Used to kick off polling only while something is actively sending.
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  async function fetchBroadcasts() {
    try {
      const supabase = createClient();
      const { data, error: fetchError } = await supabase
        .from('broadcasts')
        .select('*')
        .order('created_at', { ascending: false });

      if (fetchError) throw fetchError;
      setBroadcasts(data ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se cargaron las campañas');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchBroadcasts();
  }, []);

  const anySending = useMemo(
    () => broadcasts.some((b) => b.status === 'sending'),
    [broadcasts],
  );

  useEffect(() => {
    function startPolling() {
      if (pollTimer.current) return;
      pollTimer.current = setInterval(fetchBroadcasts, POLL_INTERVAL_MS);
    }
    function stopPolling() {
      if (!pollTimer.current) return;
      clearInterval(pollTimer.current);
      pollTimer.current = null;
    }

    // Pause polling while the tab is hidden — keeps Supabase cold when
    // the user is away, and ensures a fresh fetch the moment they
    // refocus so they don't see stale data on return.
    function handleVisibilityChange() {
      if (!anySending) return;
      if (document.visibilityState === 'hidden') {
        stopPolling();
      } else {
        fetchBroadcasts();
        startPolling();
      }
    }

    if (anySending && document.visibilityState === 'visible') {
      startPolling();
    } else {
      stopPolling();
    }
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      stopPolling();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [anySending]);

  const rows = broadcasts.length === 0 ? PLACEHOLDER_BROADCASTS : broadcasts;
  const filteredRows = useMemo(() => {
    if (!query.trim()) return rows;
    const q = query.trim().toLowerCase();
    return rows.filter(
      (b) =>
        b.name.toLowerCase().includes(q) ||
        (b.template_name ?? '').toLowerCase().includes(q),
    );
  }, [rows, query]);

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-2">
        <p className="text-sm text-red-500">{error}</p>
        <Button variant="outline" onClick={() => window.location.reload()}>
          Reintentar
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Top indeterminate progress bar: only visible while a broadcast
          is mid-send. Pure CSS animation so no extra deps. */}
      {anySending && (
        <div
          role="progressbar"
          aria-label="Campaña en curso"
          className="broadcast-indeterminate fixed inset-x-0 top-0 z-40 h-0.5 overflow-hidden bg-muted"
        >
          <div className="broadcast-indeterminate-bar h-0.5 bg-foreground" />
          <style jsx>{`
            .broadcast-indeterminate-bar {
              width: 33%;
              transform: translateX(-100%);
              animation: broadcast-slide 1.6s cubic-bezier(0.4, 0, 0.2, 1)
                infinite;
            }
            @keyframes broadcast-slide {
              0% {
                transform: translateX(-100%);
              }
              100% {
                transform: translateX(400%);
              }
            }
          `}</style>
        </div>
      )}

      {/* ── Header ── */}
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          Campañas masivas
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Enviá una plantilla aprobada a una lista de contactos.{' '}
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

      {/* ── Toolbar: search + action ── */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full max-w-md">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar campaña…"
            className="h-9 pl-8"
          />
        </div>
        <Button
          onClick={() => router.push('/campanas/nueva')}
          className="h-9 bg-foreground text-background hover:bg-foreground/90"
        >
          <Plus className="size-4" />
          Nueva campaña
        </Button>
      </div>

      {/* ── Empty-state info banner ── */}
      {broadcasts.length === 0 && (
        <div className="flex items-start gap-2.5 rounded-lg border border-border bg-muted/40 px-3.5 py-2.5">
          <Info className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-foreground">
              Vista previa con datos de ejemplo
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Estas filas son ilustrativas — desaparecen cuando creás tu primera campaña.
            </p>
          </div>
        </div>
      )}

      {/* ── Table ── */}
      <div className="overflow-x-auto rounded-lg border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow className="border-border hover:bg-transparent">
              <TableHead className="text-xs font-medium text-muted-foreground">
                Nombre
              </TableHead>
              <TableHead className="hidden text-xs font-medium text-muted-foreground md:table-cell">
                Plantilla
              </TableHead>
              <TableHead className="hidden text-right text-xs font-medium text-muted-foreground sm:table-cell">
                Destinatarios
              </TableHead>
              <TableHead className="hidden text-xs font-medium text-muted-foreground lg:table-cell">
                Entrega
              </TableHead>
              <TableHead className="hidden text-xs font-medium text-muted-foreground lg:table-cell">
                Lectura
              </TableHead>
              <TableHead className="text-xs font-medium text-muted-foreground">
                Estado
              </TableHead>
              <TableHead className="hidden text-xs font-medium text-muted-foreground sm:table-cell">
                Fecha
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredRows.length === 0 ? (
              <TableRow className="border-border hover:bg-transparent">
                <TableCell
                  colSpan={7}
                  className="py-10 text-center text-sm text-muted-foreground"
                >
                  No encontramos campañas que coincidan con “{query}”.
                </TableCell>
              </TableRow>
            ) : (
              filteredRows.map((broadcast) => {
                const status = getBroadcastStatus(broadcast.status);
                const isPlaceholder = broadcast.id.startsWith('demo-');
                return (
                  <TableRow
                    key={broadcast.id}
                    className={cn(
                      'border-border',
                      isPlaceholder
                        ? 'cursor-default'
                        : 'cursor-pointer hover:bg-muted/40',
                    )}
                    onClick={() =>
                      !isPlaceholder && router.push(`/campanas/${broadcast.id}`)
                    }
                  >
                    <TableCell className="font-medium text-foreground">
                      {broadcast.name}
                    </TableCell>
                    <TableCell className="hidden text-sm text-muted-foreground md:table-cell">
                      {broadcast.template_name}
                    </TableCell>
                    <TableCell className="hidden text-right text-sm tabular-nums text-foreground sm:table-cell">
                      {broadcast.total_recipients || '—'}
                    </TableCell>
                    <TableCell className="hidden lg:table-cell">
                      <RateCell
                        value={broadcast.delivered_count}
                        total={broadcast.total_recipients}
                      />
                    </TableCell>
                    <TableCell className="hidden lg:table-cell">
                      <RateCell
                        value={broadcast.read_count}
                        total={broadcast.total_recipients}
                      />
                    </TableCell>
                    <TableCell>
                      <span
                        className={cn(
                          'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium',
                          status.classes,
                        )}
                      >
                        {status.pulse && (
                          <span className="relative flex h-1.5 w-1.5">
                            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-current opacity-60" />
                            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-current" />
                          </span>
                        )}
                        {status.label}
                      </span>
                    </TableCell>
                    <TableCell className="hidden whitespace-nowrap text-sm text-muted-foreground sm:table-cell">
                      {new Date(broadcast.created_at).toLocaleDateString('es-ES', {
                        day: '2-digit',
                        month: 'short',
                      })}
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

// ============================================================
// Placeholder data — shown when the user hasn't created any real
// campaign yet, so the list page reads as populated and the merchant
// can evaluate the layout. Rows have id "demo-*" so the row click
// short-circuits (no real detail page exists).
// ============================================================
const PLACEHOLDER_BROADCASTS: Broadcast[] = [
  {
    id: 'demo-1',
    user_id: 'demo',
    name: 'Lanzamiento serum vitamina C',
    template_name: 'lanzamiento_serum_vit_c',
    template_language: 'es',
    template_variables: {},
    audience_filter: { type: 'all' },
    status: 'sent',
    total_recipients: 487,
    sent_count: 487,
    delivered_count: 458,
    read_count: 330,
    replied_count: 59,
    failed_count: 29,
    created_at: new Date(Date.now() - 1000 * 60 * 60 * 24 * 2).toISOString(),
    updated_at: new Date().toISOString(),
  } as unknown as Broadcast,
  {
    id: 'demo-2',
    user_id: 'demo',
    name: 'Black Friday — 25% off',
    template_name: 'black_friday_2026',
    template_language: 'es',
    template_variables: {},
    audience_filter: { type: 'all' },
    status: 'sending',
    total_recipients: 1240,
    sent_count: 744,
    delivered_count: 699,
    read_count: 503,
    replied_count: 90,
    failed_count: 45,
    created_at: new Date(Date.now() - 1000 * 60 * 18).toISOString(),
    updated_at: new Date().toISOString(),
  } as unknown as Broadcast,
  {
    id: 'demo-3',
    user_id: 'demo',
    name: 'Reactivación clientes inactivos',
    template_name: 'recompra_30dias',
    template_language: 'es',
    template_variables: {},
    audience_filter: { type: 'all' },
    status: 'scheduled',
    total_recipients: 312,
    sent_count: 0,
    delivered_count: 0,
    read_count: 0,
    replied_count: 0,
    failed_count: 0,
    scheduled_at: new Date(Date.now() + 1000 * 60 * 60 * 26).toISOString(),
    created_at: new Date(Date.now() - 1000 * 60 * 90).toISOString(),
    updated_at: new Date().toISOString(),
  } as unknown as Broadcast,
  {
    id: 'demo-4',
    user_id: 'demo',
    name: 'Newsletter junio',
    template_name: 'newsletter_mensual',
    template_language: 'es',
    template_variables: {},
    audience_filter: { type: 'all' },
    status: 'draft',
    total_recipients: 0,
    sent_count: 0,
    delivered_count: 0,
    read_count: 0,
    replied_count: 0,
    failed_count: 0,
    created_at: new Date(Date.now() - 1000 * 60 * 60 * 6).toISOString(),
    updated_at: new Date().toISOString(),
  } as unknown as Broadcast,
];
