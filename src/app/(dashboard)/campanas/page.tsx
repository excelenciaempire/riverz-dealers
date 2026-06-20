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
import { Plus, Loader2, Search, Send } from 'lucide-react';
import { cn } from '@/lib/utils';
import { getBroadcastStatus } from '@/lib/broadcast-status';
import { useT } from '@/hooks/use-locale';

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
  const t = useT();
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
      setError(err instanceof Error ? err.message : t('broadcasts.listLoadError'));
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

  const filteredRows = useMemo(() => {
    if (!query.trim()) return broadcasts;
    const q = query.trim().toLowerCase();
    return broadcasts.filter(
      (b) =>
        b.name.toLowerCase().includes(q) ||
        (b.template_name ?? '').toLowerCase().includes(q),
    );
  }, [broadcasts, query]);

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
          {t('broadcasts.retry')}
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
          aria-label={t('broadcasts.campaignInProgress')}
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
          {t('broadcasts.pageTitle')}
        </h1>
      </div>

      {/* ── Toolbar: search + action ── */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full max-w-md">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('broadcasts.searchCampaign')}
            className="h-9 pl-8"
          />
        </div>
        <Button
          onClick={() => router.push('/campanas/nueva')}
          className="h-9 bg-foreground text-background hover:bg-foreground/90"
        >
          <Plus className="size-4" />
          {t('broadcasts.newCampaign')}
        </Button>
      </div>

      {/* ── Empty state: ilustración + CTA centrada. Reemplaza los
            datos de ejemplo cuando todavía no hay ninguna campaña. ── */}
      {broadcasts.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card/40 px-6 py-14 text-center">
          <div className="flex size-14 items-center justify-center rounded-2xl bg-primary/10 text-accent-ink">
            <Send className="size-7" />
          </div>
          <p className="mt-4 text-base font-semibold text-foreground">
            {t('broadcasts.emptyTitle')}
          </p>
          <p className="mt-1 max-w-md text-sm text-muted-foreground">
            {t('broadcasts.emptyDescription')}
          </p>
          <Button
            onClick={() => router.push('/campanas/nueva')}
            className="mt-5 bg-foreground text-background hover:bg-foreground/90"
          >
            <Plus className="size-4" />
            {t('broadcasts.createFirstCampaign')}
          </Button>
        </div>
      ) : (
      /* ── Table ── */
      <div className="overflow-x-auto rounded-lg border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow className="border-border hover:bg-transparent">
              <TableHead className="text-xs font-medium text-muted-foreground">
                {t('broadcasts.colName')}
              </TableHead>
              <TableHead className="hidden text-xs font-medium text-muted-foreground md:table-cell">
                {t('broadcasts.colTemplate')}
              </TableHead>
              <TableHead className="hidden text-right text-xs font-medium text-muted-foreground sm:table-cell">
                {t('broadcasts.colRecipients')}
              </TableHead>
              <TableHead className="hidden text-xs font-medium text-muted-foreground lg:table-cell">
                {t('broadcasts.colDelivery')}
              </TableHead>
              <TableHead className="hidden text-xs font-medium text-muted-foreground lg:table-cell">
                {t('broadcasts.colRead')}
              </TableHead>
              <TableHead className="text-xs font-medium text-muted-foreground">
                {t('broadcasts.colStatus')}
              </TableHead>
              <TableHead className="hidden text-xs font-medium text-muted-foreground sm:table-cell">
                {t('broadcasts.colDate')}
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
                  {t('broadcasts.noMatchingCampaigns', { query })}
                </TableCell>
              </TableRow>
            ) : (
              filteredRows.map((broadcast) => {
                const status = getBroadcastStatus(broadcast.status);
                return (
                  <TableRow
                    key={broadcast.id}
                    className={cn(
                      'border-border',
                      'cursor-pointer hover:bg-muted/40',
                    )}
                    onClick={() => router.push(`/campanas/${broadcast.id}`)}
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
      )}
    </div>
  );
}

