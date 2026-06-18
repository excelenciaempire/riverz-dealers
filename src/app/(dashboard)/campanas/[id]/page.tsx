'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
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

/** Human label for a broadcast's audience filter (the "Segmentación"). */
function segmentationLabel(filter: unknown): string {
  if (!filter || typeof filter !== 'object') return 'Personalizada';
  const f = filter as { type?: string; tagIds?: unknown[] };
  switch (f.type) {
    case 'all':
      return 'Todos los contactos';
    case 'tags':
      return `Etiquetas (${f.tagIds?.length ?? 0})`;
    case 'custom_field':
      return 'Campo personalizado';
    case 'csv':
      return 'Lista CSV';
    default:
      return 'Personalizada';
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
        {value.toLocaleString('es-ES')}
      </p>
      {pct !== null && (
        <p className="mt-0.5 text-xs text-muted-foreground">
          <span className="tabular-nums">{pct}%</span> del total
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
  const max = Math.max(...steps.map((s) => s.value), 1);
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <h3 className="mb-4 text-sm font-medium text-foreground">
        Embudo de entrega
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
              <span className="w-24 shrink-0 text-xs text-muted-foreground">
                {step.label}
              </span>
              <div className="relative h-6 flex-1 rounded-md bg-muted/60">
                <div
                  className="h-6 rounded-md bg-foreground/80 transition-[width] duration-500"
                  style={{ width: `${pctOfMax}%` }}
                />
                <span className="absolute inset-0 flex items-center px-2.5 text-xs font-medium text-background mix-blend-screen">
                  {step.value.toLocaleString('es-ES')}
                </span>
              </div>
              <span className="w-14 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
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
  const router = useRouter();
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

  useEffect(() => {
    async function fetchData() {
      try {
        const supabase = createClient();

        const { data: bc, error: bcError } = await supabase
          .from('broadcasts')
          .select('*')
          .eq('id', broadcastId)
          .single();

        if (bcError) throw bcError;
        setBroadcast(bc);

        const { data: recs, error: recsError } = await supabase
          .from('broadcast_recipients')
          .select('*, contact:contacts(*)')
          .eq('broadcast_id', broadcastId)
          .order('created_at', { ascending: false });

        if (recsError) throw recsError;
        setRecipients(recs ?? []);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'No se cargó la campaña');
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

  function handleExport() {
    if (!broadcast) return;
    const header = [
      'Contacto',
      'Teléfono',
      'Estado',
      'Enviado en',
      'Entregado en',
      'Leído en',
      'Respondido en',
      'Error',
    ];
    const rows = recipients.map((r) => [
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
      toast.error(`No se pudo eliminar: ${delErr.message}`);
      return;
    }
    toast.success('Campaña eliminada');
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
        <p className="text-sm text-red-500">{error ?? 'Campaña no encontrada'}</p>
        <Button variant="outline" onClick={() => router.push('/campanas')}>
          Volver
        </Button>
      </div>
    );
  }

  const status = getBroadcastStatus(broadcast.status);
  const total = broadcast.total_recipients;
  const pct = (n: number) => (total > 0 ? Math.round((n / total) * 100) : 0);

  const funnelSteps: FunnelStep[] = [
    { label: 'Enviado', value: broadcast.sent_count },
    { label: 'Entregado', value: broadcast.delivered_count },
    { label: 'Leído', value: broadcast.read_count },
    { label: 'Respondido', value: broadcast.replied_count },
  ];

  const showFailedBanner =
    statusFilter === 'failed' && broadcast.failed_count > 0;

  return (
    <div className="space-y-5">
      {/* ── Header ── */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <Button
            variant="outline"
            size="icon"
            onClick={() => router.push('/campanas')}
            className="h-8 w-8 border-border"
            aria-label="Volver a campañas"
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
                {status.label}
              </span>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              Plantilla{' '}
              <span className="text-foreground">{broadcast.template_name}</span>
              {' · '}
              <span>{segmentationLabel(broadcast.audience_filter)}</span>
              {' · '}
              <span>
                {broadcast.scheduled_at && broadcast.status === 'scheduled'
                  ? `Programada para ${new Date(broadcast.scheduled_at).toLocaleString('es-ES')}`
                  : `Creada el ${new Date(broadcast.created_at).toLocaleDateString('es-ES')}`}
              </span>
            </p>
          </div>
        </div>

        {/* Eliminar — confirm inline */}
        {confirmDelete ? (
          <div className="flex items-center gap-2 rounded-md border border-red-500/30 bg-red-500/5 px-3 py-1.5 text-sm">
            <span className="text-red-600 dark:text-red-400">¿Eliminar?</span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setConfirmDelete(false)}
              disabled={deleting}
              className="h-7 border-border bg-transparent text-foreground hover:bg-muted"
            >
              Cancelar
            </Button>
            <Button
              size="sm"
              onClick={handleDelete}
              disabled={deleting}
              className="h-7 bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
            >
              {deleting ? 'Eliminando…' : 'Eliminar'}
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
                ? 'No se puede eliminar mientras se envía'
                : undefined
            }
            className="h-8 border-border bg-transparent text-foreground hover:bg-muted disabled:opacity-40"
          >
            <Trash2 className="size-3.5" />
            Eliminar
          </Button>
        )}
      </div>

      {/* ── Top metrics: 5 números tabulares, sin íconos ni cajas
            coloreadas, solo jerarquía tipográfica ── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <MetricCard
          label="Destinatarios"
          value={total}
          pct={null}
          emphasis
        />
        <MetricCard
          label="Entregados"
          value={broadcast.delivered_count}
          pct={pct(broadcast.delivered_count)}
        />
        <MetricCard
          label="Leídos"
          value={broadcast.read_count}
          pct={pct(broadcast.read_count)}
        />
        <MetricCard
          label="Respondidos"
          value={broadcast.replied_count}
          pct={pct(broadcast.replied_count)}
        />
        <MetricCard
          label="Fallidos"
          value={broadcast.failed_count}
          pct={pct(broadcast.failed_count)}
        />
      </div>

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
              Por qué pueden fallar los mensajes
            </p>
            <p className="mt-0.5 text-xs text-blue-700 dark:text-blue-300">
              Meta puede rechazar un mensaje si la cuenta del cliente no acepta WhatsApp Business, si su número está bloqueado o si pasó la ventana de 24 horas sin una plantilla aprobada.
            </p>
          </div>
          <a
            href="https://developers.facebook.com/docs/whatsapp/cloud-api/support/error-codes/"
            target="_blank"
            rel="noreferrer"
            className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-blue-700 hover:text-blue-900 dark:text-blue-300 dark:hover:text-blue-100"
          >
            Saber más
            <ExternalLink className="size-3" />
          </a>
        </div>
      )}

      {/* ── Destinatarios ── */}
      <div className="rounded-lg border border-border bg-card">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
          <h2 className="text-sm font-medium text-foreground">
            Destinatarios{' '}
            <span className="tabular-nums text-muted-foreground">
              ({filteredRecipients.length}
              {statusFilter !== 'all' || query
                ? ` de ${recipients.length}`
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
                placeholder="Buscar contacto…"
                className="h-8 w-56 pl-8"
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
                  ? 'Todos'
                  : getRecipientStatus(statusFilter).label}
                <ChevronDown className="size-3" />
              </DropdownMenuTrigger>
              <DropdownMenuContent className="border-border bg-card">
                <DropdownMenuItem
                  onClick={() => setStatusFilter('all')}
                  className={
                    statusFilter === 'all' ? 'text-foreground' : 'text-foreground'
                  }
                >
                  Todos los estados
                </DropdownMenuItem>
                {RECIPIENT_STATUSES.map((s) => (
                  <DropdownMenuItem
                    key={s}
                    onClick={() => setStatusFilter(s)}
                    className="text-foreground"
                  >
                    {getRecipientStatus(s).label}
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
              Exportar
            </Button>
          </div>
        </div>

        {filteredRecipients.length === 0 ? (
          <div className="flex h-32 items-center justify-center">
            <p className="text-sm text-muted-foreground">
              {recipients.length === 0
                ? 'Sin destinatarios.'
                : 'Ningún destinatario coincide con el filtro.'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="border-border hover:bg-transparent">
                  <TableHead className="text-xs font-medium text-muted-foreground">
                    Contacto
                  </TableHead>
                  <TableHead className="text-xs font-medium text-muted-foreground">
                    Teléfono
                  </TableHead>
                  <TableHead className="text-xs font-medium text-muted-foreground">
                    Estado
                  </TableHead>
                  <TableHead className="hidden text-xs font-medium text-muted-foreground md:table-cell">
                    Enviado
                  </TableHead>
                  <TableHead className="hidden text-xs font-medium text-muted-foreground lg:table-cell">
                    Entregado
                  </TableHead>
                  <TableHead className="hidden text-xs font-medium text-muted-foreground lg:table-cell">
                    Leído
                  </TableHead>
                  {statusFilter === 'failed' && (
                    <TableHead className="text-xs font-medium text-muted-foreground">
                      Motivo
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
                        {recipient.contact?.name ?? 'Desconocido'}
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
                          {rStatus.label}
                        </span>
                      </TableCell>
                      <TableCell className="hidden text-sm text-muted-foreground md:table-cell">
                        {recipient.sent_at
                          ? new Date(recipient.sent_at).toLocaleString('es-ES', {
                              day: '2-digit',
                              month: 'short',
                              hour: '2-digit',
                              minute: '2-digit',
                            })
                          : '—'}
                      </TableCell>
                      <TableCell className="hidden text-sm text-muted-foreground lg:table-cell">
                        {recipient.delivered_at
                          ? new Date(recipient.delivered_at).toLocaleString(
                              'es-ES',
                              {
                                day: '2-digit',
                                month: 'short',
                                hour: '2-digit',
                                minute: '2-digit',
                              },
                            )
                          : '—'}
                      </TableCell>
                      <TableCell className="hidden text-sm text-muted-foreground lg:table-cell">
                        {recipient.read_at
                          ? new Date(recipient.read_at).toLocaleString('es-ES', {
                              day: '2-digit',
                              month: 'short',
                              hour: '2-digit',
                              minute: '2-digit',
                            })
                          : '—'}
                      </TableCell>
                      {statusFilter === 'failed' && (
                        <TableCell className="max-w-xs truncate text-xs italic text-muted-foreground">
                          {recipient.error_message ?? 'Sin detalle de Meta'}
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
