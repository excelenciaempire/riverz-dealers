'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { useLocalizedRouter } from '@/hooks/use-localized-router';
import { createClient } from '@/lib/supabase/client';
import { idColumn } from '@/lib/short-id';
import { Broadcast, BroadcastRecipient, RecipientStatus } from '@/types';
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  ArrowLeft,
  Loader2,
  Filter,
  Download,
  ChevronDown,
  Trash2,
  Search,
  Info,
  ExternalLink,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  getBroadcastStatus,
  getRecipientStatus,
} from '@/lib/broadcast-status';
import { ActiveHoursChart } from '@/components/broadcasts/active-hours-chart';
import { cn } from '@/lib/utils';
import { useT } from '@/hooks/use-locale';
import { useFormat } from '@/hooks/use-format';
import type { TFn } from '@/lib/i18n/translate';

/** Human label for a broadcast's audience filter (the "Segmentación"). */
function segmentationLabel(filter: unknown, t: TFn): string {
  if (!filter || typeof filter !== 'object') return t('broadcasts.segCustom');
  const f = filter as { type?: string; tagIds?: unknown[] };
  switch (f.type) {
    case 'all':
      return t('broadcasts.audienceAllLabel');
    case 'tags':
      return t('broadcasts.segTagsCount', { n: f.tagIds?.length ?? 0 });
    case 'custom_field':
      return t('broadcasts.segCustomField');
    case 'csv':
      return t('broadcasts.segCsvList');
    default:
      return t('broadcasts.segCustom');
  }
}

const RECIPIENT_STATUSES: readonly RecipientStatus[] = [
  'pending',
  'sent',
  'delivered',
  'read',
  'replied',
  'failed',
];

/**
 * Tarjeta de métrica del topo: número grande, etiqueta, %. Sin caja
 * de color ni ícono — el screenshot de referencia (bitbybit) usa
 * solo tipografía para diferenciar jerarquía.
 */
function MetricCard({
  label,
  value,
  pct,
  emphasis = false,
}: {
  label: string;
  value: number;
  pct: number | null;
  /** El primer card (Total) lleva borde más marcado para anclar la lectura. */
  emphasis?: boolean;
}) {
  const t = useT();
  const fmt = useFormat();
  return (
    <div
      className={cn(
        'flex-1 rounded-lg border bg-card p-4',
        emphasis ? 'border-border' : 'border-border/60',
      )}
    >
      <p className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="mt-2 text-2xl font-semibold tabular-nums text-foreground">
        {fmt.number(value)}
      </p>
      {pct !== null && (
        <p className="mt-0.5 text-xs text-muted-foreground">
          <span className="tabular-nums">{pct}%</span> {t('broadcasts.ofTotal')}
        </p>
      )}
    </div>
  );
}

interface FunnelStep {
  label: string;
  value: number;
}

/**
 * Embudo monocromo: barras horizontales que decrecen, con el % vs el
 * paso superior. Sin colores por estado — un único tono neutro hace la
 * lectura de la "caída" más clara que 4 colores compitiendo.
 */
function FunnelChart({ steps }: { steps: FunnelStep[] }) {
  const t = useT();
  const fmt = useFormat();
  const max = Math.max(...steps.map((s) => s.value), 1);
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <h3 className="mb-4 text-sm font-medium text-foreground">
        {t('broadcasts.deliveryFunnel')}
      </h3>
      <div className="space-y-2.5">
        {steps.map((step, idx) => {
          const pctOfMax = Math.max(6, Math.round((step.value / max) * 100));
          const pctOfPrev =
            idx === 0
              ? 100
              : steps[idx - 1].value > 0
                ? Math.round((step.value / steps[idx - 1].value) * 100)
                : 0;
          return (
            <div key={step.label} className="flex items-center gap-3">
              <span className="w-16 shrink-0 sm:w-24 text-xs text-muted-foreground">
                {step.label}
              </span>
              <div className="relative h-6 flex-1 rounded-md bg-muted/60">
                <div
                  className="h-6 rounded-md bg-foreground/80 transition-[width] duration-500"
                  style={{ width: `${pctOfMax}%` }}
                />
                <span className="absolute inset-0 flex items-center px-2.5 text-xs font-medium text-background mix-blend-screen">
                  {fmt.number(step.value)}
                </span>
              </div>
              <span className="w-10 shrink-0 sm:w-14 text-right text-xs tabular-nums text-muted-foreground">
                {idx === 0 ? '—' : `${pctOfPrev}%`}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * CSV export helper — RFC 4180 quoting. Quote every field so
 * commas/newlines/quotes round-trip cleanly.
 */
function toCsv(rows: string[][]): string {
  const escape = (v: string) => `"${v.replace(/"/g, '""')}"`;
  return rows.map((r) => r.map(escape).join(',')).join('\n');
}

function downloadBlob(filename: string, content: string) {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export default function BroadcastDetailPage() {
  const params = useParams();
  const router = useLocalizedRouter();
  const t = useT();
  const fmt = useFormat();
  const broadcastId = params.id as string;

  const [broadcast, setBroadcast] = useState<Broadcast | null>(null);
  const [recipients, setRecipients] = useState<BroadcastRecipient[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<RecipientStatus | 'all'>(
    'all',
  );
  const [query, setQuery] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  // True when a very large send exceeded the browser page cap — metrics then
  // fall back to the DB aggregate columns and the table shows a subset.
  const [recipientsCapped, setRecipientsCapped] = useState(false);

  useEffect(() => {
    async function fetchData() {
      try {
        const supabase = createClient();

        const { data: bc, error: bcError } = await supabase
          .from('broadcasts')
          .select('*')
          .eq(idColumn(broadcastId), broadcastId)
          .single();

        if (bcError) throw bcError;
        setBroadcast(bc);

        // Page through ALL recipients. A single Supabase select caps at 1000
        // rows, which silently truncated the table, the hourly chart AND the
        // CSV export for any campaign > 1000 — so the stats didn't reflect the
        // real send. Batches of 1000 up to a browser-safe ceiling.
        const PAGE = 1000;
        const MAX = 50000;
        const all: BroadcastRecipient[] = [];
        let from = 0;
        let capped = false;
        for (;;) {
          const { data: recs, error: recsError } = await supabase
            .from('broadcast_recipients')
            .select('*, contact:contacts(*)')
            .eq('broadcast_id', broadcastId)
            .order('created_at', { ascending: false })
            .range(from, from + PAGE - 1);
          if (recsError) throw recsError;
          const batch = recs ?? [];
          all.push(...batch);
          if (batch.length < PAGE) break;
          from += PAGE;
          if (all.length >= MAX) {
            capped = true;
            break;
          }
        }
        setRecipients(all);
        setRecipientsCapped(capped);
      } catch (err) {
        setError(t('broadcasts.detailLoadError'));
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, [broadcastId]);

  const filteredRecipients = useMemo(() => {
    let rows = recipients;
    if (statusFilter !== 'all') {
      rows = rows.filter((r) => r.status === statusFilter);
    }
    const q = query.trim().toLowerCase();
    if (q) {
      rows = rows.filter(
        (r) =>
          (r.contact?.name ?? '').toLowerCase().includes(q) ||
          (r.contact?.phone ?? '').toLowerCase().includes(q),
      );
    }
    return rows;
  }, [recipients, statusFilter, query]);

  // Metrics DERIVED from the actual recipient rows — cumulative funnel, exactly
  // matching the DB trigger's model (delivered ⊇ read ⊇ replied). Deriving here
  // guarantees the cards, funnel, table and export all agree and reflect the
  // real send, rather than trusting aggregate columns that could drift.
  const derived = useMemo(() => {
    const c = { total: recipients.length, sent: 0, delivered: 0, read: 0, replied: 0, failed: 0 };
    for (const r of recipients) {
      const s = r.status;
      if (s === 'failed') {
        c.failed++;
        continue;
      }
      if (s === 'sent' || s === 'delivered' || s === 'read' || s === 'replied') c.sent++;
      if (s === 'delivered' || s === 'read' || s === 'replied') c.delivered++;
      if (s === 'read' || s === 'replied') c.read++;
      if (s === 'replied') c.replied++;
    }
    return c;
  }, [recipients]);

  function handleExport() {
    if (!broadcast) return;
    const header = [
      t('broadcasts.csvContact'),
      t('broadcasts.csvPhone'),
      t('broadcasts.csvStatus'),
      t('broadcasts.csvSentAt'),
      t('broadcasts.csvDeliveredAt'),
      t('broadcasts.csvReadAt'),
      t('broadcasts.csvRepliedAt'),
      t('broadcasts.csvError'),
    ];
    // Export the CURRENTLY VISIBLE rows — respects the status filter + search
    // so "filter to Fallidas → Exportar" gives just the failed recipients.
    const rows = filteredRecipients.map((r) => [
      r.contact?.name ?? '',
      r.contact?.phone ?? '',
      r.status,
      r.sent_at ?? '',
      r.delivered_at ?? '',
      r.read_at ?? '',
      r.replied_at ?? '',
      r.error_message ?? '',
    ]);
    const csv = toCsv([header, ...rows]);
    const safeName = broadcast.name.replace(/[^a-z0-9-_]+/gi, '-').toLowerCase();
    downloadBlob(`campana-${safeName}-${broadcastId.slice(0, 8)}.csv`, csv);
  }

  async function handleDelete() {
    setDeleting(true);
    const supabase = createClient();
    const { error: delErr } = await supabase
      .from('broadcasts')
      .delete()
      .eq('id', broadcastId);
    setDeleting(false);
    if (delErr) {
      toast.error(t('broadcasts.deleteError', { error: delErr.message }));
      return;
    }
    toast.success(t('broadcasts.deleteSuccess'));
    router.push('/campanas');
  }

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || !broadcast) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-2">
        <p className="text-sm text-red-500">{error ?? t('broadcasts.campaignNotFound')}</p>
        <Button variant="outline" onClick={() => router.push('/campanas')}>
          {t('broadcasts.goBack')}
        </Button>
      </div>
    );
  }

  const status = getBroadcastStatus(broadcast.status);
  // Prefer the real, row-derived metrics; only when the row set was capped for
  // a very large send do we fall back to the trigger-maintained aggregates.
  const metrics = recipientsCapped
    ? {
        total: broadcast.total_recipients,
        sent: broadcast.sent_count,
        delivered: broadcast.delivered_count,
        read: broadcast.read_count,
        replied: broadcast.replied_count,
        failed: broadcast.failed_count,
      }
    : derived;
  const total = metrics.total;
  const pct = (n: number) => (total > 0 ? Math.round((n / total) * 100) : 0);

  const funnelSteps: FunnelStep[] = [
    { label: t('broadcasts.funnelSent'), value: metrics.sent },
    { label: t('broadcasts.funnelDelivered'), value: metrics.delivered },
    { label: t('broadcasts.funnelRead'), value: metrics.read },
    { label: t('broadcasts.funnelReplied'), value: metrics.replied },
  ];

  const showFailedBanner = statusFilter === 'failed' && metrics.failed > 0;

  return (
    <div className="space-y-5">
      {/* ── Header ── */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <Button
            variant="outline"
            size="icon"
            onClick={() => router.push('/campanas')}
            className="h-9 w-9 border-border md:h-8 md:w-8"
            aria-label={t('broadcasts.backToCampaigns')}
          >
            <ArrowLeft className="size-4" />
          </Button>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="truncate text-xl font-semibold tracking-tight text-foreground">
                {broadcast.name}
              </h1>
              <span
                className={cn(
                  'inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium',
                  status.classes,
                )}
              >
                {t(status.labelKey)}
              </span>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              {t('broadcasts.templateLabel')}{' '}
              <span className="text-foreground">{broadcast.template_name}</span>
              {' · '}
              <span>{segmentationLabel(broadcast.audience_filter, t)}</span>
              {' · '}
              <span>
                {broadcast.scheduled_at && broadcast.status === 'scheduled'
                  ? t('broadcasts.scheduledFor', {
                      date: fmt.dateTime(broadcast.scheduled_at, {
                        dateStyle: 'short',
                        timeStyle: 'medium',
                      }),
                    })
                  : t('broadcasts.createdOn', {
                      date: fmt.date(broadcast.created_at, { dateStyle: 'short' }),
                    })}
              </span>
            </p>
          </div>
        </div>

        {/* Eliminar — confirm inline */}
        {confirmDelete ? (
          <div className="flex items-center gap-2 rounded-md border border-red-500/30 bg-red-500/5 px-3 py-1.5 text-sm">
            <span className="text-red-600 dark:text-red-400">{t('broadcasts.deletePrompt')}</span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setConfirmDelete(false)}
              disabled={deleting}
              className="h-7 border-border bg-transparent text-foreground hover:bg-muted"
            >
              {t('broadcasts.cancel')}
            </Button>
            <Button
              size="sm"
              onClick={handleDelete}
              disabled={deleting}
              className="h-7 bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
            >
              {deleting ? t('broadcasts.deleting') : t('broadcasts.delete')}
            </Button>
          </div>
        ) : (
          <Button
            variant="outline"
            size="sm"
            disabled={broadcast.status === 'sending'}
            onClick={() => setConfirmDelete(true)}
            title={
              broadcast.status === 'sending'
                ? t('broadcasts.cannotDeleteWhileSending')
                : undefined
            }
            className="h-8 border-border bg-transparent text-foreground hover:bg-muted disabled:opacity-40"
          >
            <Trash2 className="size-3.5" />
            {t('broadcasts.delete')}
          </Button>
        )}
      </div>

      {/* ── Top metrics: 5 números tabulares, sin íconos ni cajas
            coloreadas, solo jerarquía tipográfica ── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <MetricCard
          label={t('broadcasts.metricRecipients')}
          value={total}
          pct={null}
          emphasis
        />
        <MetricCard
          label={t('broadcasts.metricDelivered')}
          value={metrics.delivered}
          pct={pct(metrics.delivered)}
        />
        <MetricCard
          label={t('broadcasts.metricRead')}
          value={metrics.read}
          pct={pct(metrics.read)}
        />
        <MetricCard
          label={t('broadcasts.metricReplied')}
          value={metrics.replied}
          pct={pct(metrics.replied)}
        />
        <MetricCard
          label={t('broadcasts.metricFailed')}
          value={metrics.failed}
          pct={pct(metrics.failed)}
        />
      </div>

      {/* "Leído" depende de que el destinatario tenga activadas las
          confirmaciones de lectura en WhatsApp; si las tiene apagadas,
          el mensaje puede haberse leído sin que el visto llegue. La
          entrega y las respuestas no dependen de ese ajuste. */}
      <p className="text-[11px] text-muted-foreground">
        {t('broadcasts.readReceiptsNote')}
      </p>
      {recipientsCapped && (
        <p className="text-[11px] text-amber-600 dark:text-amber-400">
          {t('broadcasts.statsCappedNote', { n: fmt.number(recipients.length) })}
        </p>
      )}

      {/* ── Embudo + actividad por hora ── */}
      <div className="grid gap-3 lg:grid-cols-2">
        <FunnelChart steps={funnelSteps} />
        <ActiveHoursChart timestamps={recipients.map((r) => r.sent_at)} />
      </div>

      {/* ── Banner "Mensajes fallidos" (al estilo bitbybit) ── */}
      {showFailedBanner && (
        <div className="flex items-start gap-3 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 dark:border-blue-900/40 dark:bg-blue-950/30">
          <Info className="mt-0.5 size-4 shrink-0 text-blue-600 dark:text-blue-400" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-blue-900 dark:text-blue-200">
              {t('broadcasts.whyMessagesFail')}
            </p>
            <p className="mt-0.5 text-xs text-blue-700 dark:text-blue-300">
              {t('broadcasts.whyMessagesFailDesc')}
            </p>
          </div>
          <a
            href="https://developers.facebook.com/docs/whatsapp/cloud-api/support/error-codes/"
            target="_blank"
            rel="noreferrer"
            className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-blue-700 hover:text-blue-900 dark:text-blue-300 dark:hover:text-blue-100"
          >
            {t('broadcasts.learnMore')}
            <ExternalLink className="size-3" />
          </a>
        </div>
      )}

      {/* ── Destinatarios ── */}
      <div className="rounded-lg border border-border bg-card">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
          <h2 className="text-sm font-medium text-foreground">
            {t('broadcasts.recipients')}{' '}
            <span className="tabular-nums text-muted-foreground">
              ({filteredRecipients.length}
              {statusFilter !== 'all' || query
                ? t('broadcasts.ofCount', { total: recipients.length })
                : ''}
              )
            </span>
          </h2>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t('broadcasts.searchContact')}
                className="h-8 w-full sm:w-56 pl-8"
              />
            </div>

            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 border-border bg-transparent text-foreground hover:bg-muted"
                  />
                }
              >
                <Filter className="size-3.5" />
                {statusFilter === 'all'
                  ? t('broadcasts.all')
                  : t(getRecipientStatus(statusFilter).labelKey)}
                <ChevronDown className="size-3" />
              </DropdownMenuTrigger>
              <DropdownMenuContent className="border-border bg-card">
                <DropdownMenuItem
                  onClick={() => setStatusFilter('all')}
                  className={
                    statusFilter === 'all' ? 'text-foreground' : 'text-foreground'
                  }
                >
                  {t('broadcasts.allStatuses')}
                </DropdownMenuItem>
                {RECIPIENT_STATUSES.map((s) => (
                  <DropdownMenuItem
                    key={s}
                    onClick={() => setStatusFilter(s)}
                    className="text-foreground"
                  >
                    {t(getRecipientStatus(s).labelKey)}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            <Button
              variant="outline"
              size="sm"
              onClick={handleExport}
              disabled={recipients.length === 0}
              className="h-8 border-border bg-transparent text-foreground hover:bg-muted"
            >
              <Download className="size-3.5" />
              {t('broadcasts.export')}
            </Button>
          </div>
        </div>

        {filteredRecipients.length === 0 ? (
          <div className="flex h-32 items-center justify-center">
            <p className="text-sm text-muted-foreground">
              {recipients.length === 0
                ? t('broadcasts.noRecipients')
                : t('broadcasts.noRecipientsMatch')}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="border-border hover:bg-transparent">
                  <TableHead className="text-xs font-medium text-muted-foreground">
                    {t('broadcasts.colContact')}
                  </TableHead>
                  <TableHead className="text-xs font-medium text-muted-foreground">
                    {t('broadcasts.colPhone')}
                  </TableHead>
                  <TableHead className="text-xs font-medium text-muted-foreground">
                    {t('broadcasts.colStatus')}
                  </TableHead>
                  <TableHead className="hidden text-xs font-medium text-muted-foreground md:table-cell">
                    {t('broadcasts.colSent')}
                  </TableHead>
                  <TableHead className="hidden text-xs font-medium text-muted-foreground lg:table-cell">
                    {t('broadcasts.colDelivered')}
                  </TableHead>
                  <TableHead className="hidden text-xs font-medium text-muted-foreground lg:table-cell">
                    {t('broadcasts.colReadHeader')}
                  </TableHead>
                  {statusFilter === 'failed' && (
                    <TableHead className="text-xs font-medium text-muted-foreground">
                      {t('broadcasts.colReason')}
                    </TableHead>
                  )}
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredRecipients.map((recipient) => {
                  const rStatus = getRecipientStatus(recipient.status);
                  return (
                    <TableRow
                      key={recipient.id}
                      className="border-border hover:bg-muted/40"
                    >
                      <TableCell className="font-medium text-foreground">
                        {recipient.contact?.name ?? t('broadcasts.unknown')}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {recipient.contact?.phone ?? '—'}
                      </TableCell>
                      <TableCell>
                        <span
                          className={cn(
                            'inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium',
                            rStatus.classes,
                          )}
                        >
                          {t(rStatus.labelKey)}
                        </span>
                      </TableCell>
                      <TableCell className="hidden text-sm text-muted-foreground md:table-cell">
                        {recipient.sent_at
                          ? fmt.dateTime(recipient.sent_at, {
                              day: '2-digit',
                              month: 'short',
                              hour: '2-digit',
                              minute: '2-digit',
                            })
                          : '—'}
                      </TableCell>
                      <TableCell className="hidden text-sm text-muted-foreground lg:table-cell">
                        {recipient.delivered_at
                          ? fmt.dateTime(recipient.delivered_at, {
                              day: '2-digit',
                              month: 'short',
                              hour: '2-digit',
                              minute: '2-digit',
                            })
                          : '—'}
                      </TableCell>
                      <TableCell className="hidden text-sm text-muted-foreground lg:table-cell">
                        {recipient.read_at
                          ? fmt.dateTime(recipient.read_at, {
                              day: '2-digit',
                              month: 'short',
                              hour: '2-digit',
                              minute: '2-digit',
                            })
                          : '—'}
                      </TableCell>
                      {statusFilter === 'failed' && (
                        <TableCell className="max-w-xs truncate text-xs italic text-muted-foreground">
                          {recipient.error_message ?? t('broadcasts.noMetaDetail')}
                        </TableCell>
                      )}
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </div>
  );
}
