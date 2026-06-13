'use client';

import { useEffect, useState, useMemo, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Broadcast } from '@/types';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Radio, Plus, Loader2 } from 'lucide-react';
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

function RateCell({
  value,
  total,
  color,
}: {
  value: number;
  total: number;
  /** Tailwind bg class for the fill, e.g. "bg-primary" */
  color: string;
}) {
  const pct = percent(value, total);
  return (
    <div className="flex items-center gap-2">
      <span className="w-10 text-right text-xs tabular-nums text-foreground">
        {pct}%
      </span>
      <div className="h-1.5 w-20 overflow-hidden rounded-full bg-muted">
        <div
          className={`h-1.5 rounded-full ${color}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

export default function BroadcastsPage() {
  const router = useRouter();
  const [broadcasts, setBroadcasts] = useState<Broadcast[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
      setError(err instanceof Error ? err.message : 'No se cargaron las difusiones');
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

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-accent-ink" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-2">
        <p className="text-sm text-red-400">{error}</p>
        <Button variant="outline" onClick={() => window.location.reload()}>
          Reintentar
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Top indeterminate progress bar: only visible while a broadcast
          is mid-send. Pure CSS animation so no extra deps. */}
      {anySending && (
        <div
          role="progressbar"
          aria-label="Difusión en curso"
          className="broadcast-indeterminate fixed inset-x-0 top-0 z-40 h-0.5 overflow-hidden bg-muted"
        >
          <div className="broadcast-indeterminate-bar h-0.5 bg-primary" />
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

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Campañas masivas</h1>
        </div>
        <Button
          onClick={() => router.push('/broadcasts/new')}
          className="bg-primary text-primary-foreground hover:bg-primary/90"
        >
          <Plus className="h-4 w-4" />
          Nueva campaña
        </Button>
      </div>

      {broadcasts.length === 0 && (
        <p className="-mb-2 text-[11px] italic text-muted-foreground">
          Vista previa con datos de ejemplo. Cuando creés tu primera campaña, esta lista se reemplaza con tus datos reales.
        </p>
      )}
      <div
        className={cn(
          'overflow-x-auto rounded-xl border border-border bg-card',
          broadcasts.length === 0 && 'opacity-60',
        )}
      >
          <Table>
            <TableHeader>
              <TableRow className="border-border hover:bg-transparent">
                <TableHead className="text-muted-foreground">Nombre</TableHead>
                <TableHead className="hidden text-muted-foreground md:table-cell">Plantilla</TableHead>
                <TableHead className="hidden text-right text-muted-foreground sm:table-cell">
                  Destinatarios
                </TableHead>
                <TableHead className="hidden text-muted-foreground lg:table-cell">Entrega</TableHead>
                <TableHead className="hidden text-muted-foreground lg:table-cell">Lectura</TableHead>
                <TableHead className="text-muted-foreground">Estado</TableHead>
                <TableHead className="hidden text-muted-foreground sm:table-cell">Fecha</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(broadcasts.length === 0 ? PLACEHOLDER_BROADCASTS : broadcasts).map((broadcast) => {
                const status = getBroadcastStatus(broadcast.status);
                const isPlaceholder = broadcast.id.startsWith('demo-');
                return (
                  <TableRow
                    key={broadcast.id}
                    className={cn(
                      "border-border",
                      isPlaceholder
                        ? "cursor-default"
                        : "cursor-pointer hover:bg-accent/50",
                    )}
                    onClick={() =>
                      !isPlaceholder && router.push(`/broadcasts/${broadcast.id}`)
                    }
                  >
                    <TableCell className="font-medium text-foreground">
                      {broadcast.name}
                    </TableCell>
                    <TableCell className="hidden text-foreground md:table-cell">
                      {broadcast.template_name}
                    </TableCell>
                    <TableCell className="hidden text-right text-foreground tabular-nums sm:table-cell">
                      {broadcast.total_recipients}
                    </TableCell>
                    <TableCell className="hidden lg:table-cell">
                      <RateCell
                        value={broadcast.delivered_count}
                        total={broadcast.total_recipients}
                        color="bg-primary"
                      />
                    </TableCell>
                    <TableCell className="hidden lg:table-cell">
                      <RateCell
                        value={broadcast.read_count}
                        total={broadcast.total_recipients}
                        color="bg-blue-500"
                      />
                    </TableCell>
                    <TableCell>
                      <span
                        className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium ${status.classes}`}
                      >
                        {status.pulse && (
                          <span className="relative flex h-1.5 w-1.5">
                            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-yellow-400 opacity-75" />
                            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-yellow-400" />
                          </span>
                        )}
                        {status.label}
                      </span>
                    </TableCell>
                    <TableCell className="hidden text-muted-foreground sm:table-cell">
                      {new Date(broadcast.created_at).toLocaleDateString('es-ES')}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
        {/* Lint silencer — Radio icon kept for the eventual empty-state
            illustration once real broadcasts arrive. */}
        <span className="hidden">
          <Radio />
        </span>
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
