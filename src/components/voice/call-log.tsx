'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Download,
  Loader2,
  Mic,
  PhoneCall,
  PhoneIncoming,
  Search,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { FilterMultiSelect } from '@/components/contacts/filter-chip';
import {
  DateRangeChip,
  dateChipBounds,
  type DateChipPreset,
} from '@/components/common/date-range-chip';
import type { CustomRange } from '@/components/dashboard/date-range-filter';
import { CallDetail } from '@/components/voice/call-detail';
import {
  VOICE_DIRECTION_KEY,
  VOICE_OUTCOME_KEY,
  VOICE_STATUS_KEY,
  VOICE_TYPE_KEY,
  fmtCallDuration,
  voiceStatusLabel,
} from '@/lib/voice/labels';
import { ALL_CALL_TYPES } from '@/lib/voice/constants';
import { downloadCsv } from '@/lib/export/csv';
import { useT } from '@/hooks/use-locale';
import { useFormat } from '@/hooks/use-format';
import { useTimezone } from '@/hooks/use-timezone';
import { cn } from '@/lib/utils';
import type { VoiceCall, VoiceCallOutcome, VoiceCallStatus } from '@/types';

type CallRow = VoiceCall & {
  contact?: { id: string; name: string | null; phone: string | null } | null;
  agent?: { id: string; name: string } | null;
};

const PAGE_SIZES = [25, 50, 100] as const;
type PageSize = (typeof PAGE_SIZES)[number];

const DATE_PRESETS = [
  { value: 'all', key: 'voice.dateAnytime' },
  { value: '7d', key: 'voice.dateLast7' },
  { value: '30d', key: 'voice.dateLast30' },
  { value: '90d', key: 'voice.dateLast90' },
] as const;

const STATUSES = Object.keys(VOICE_STATUS_KEY) as VoiceCallStatus[];
const OUTCOMES = Object.keys(VOICE_OUTCOME_KEY) as VoiceCallOutcome[];

interface Filters {
  q: string;
  datePreset: DateChipPreset;
  dateCustom: CustomRange | null;
  /** Listas vacías = ese filtro no filtra; con varias, basta con cualquiera. */
  status: string[];
  outcome: string[];
  callType: string[];
  direction: string[];
  agentId: string[];
}

const EMPTY: Filters = {
  q: '',
  datePreset: 'all',
  dateCustom: null,
  status: [],
  outcome: [],
  callType: [],
  direction: [],
  agentId: [],
};

/**
 * Registro de llamadas: filtros (fecha con calendario, estado, resultado, tipo,
 * dirección, agente y búsqueda), paginado y exportación a CSV.
 *
 * Todo se resuelve en el servidor con la MISMA query que pinta la tabla: el
 * contador, las páginas y el CSV hablan siempre del mismo conjunto de llamadas,
 * así que exportar nunca trae algo distinto de lo que se está viendo.
 */
export function CallLog({
  workspaceId,
  agents,
}: {
  workspaceId?: string;
  agents: { id: string; name: string }[];
}) {
  const t = useT();
  const format = useFormat();
  const tz = useTimezone();

  const [filters, setFilters] = useState<Filters>(EMPTY);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState<PageSize>(25);
  const [calls, setCalls] = useState<CallRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [selectedCall, setSelectedCall] = useState<string | null>(null);

  const set = <K extends keyof Filters>(key: K, value: Filters[K]) => {
    setFilters((f) => ({ ...f, [key]: value }));
    setPage(0);
  };

  // El texto se aplica con un respiro: sin esto cada tecla dispara una consulta.
  // Si el término no cambió se devuelve el mismo objeto, así el montaje inicial
  // no gatilla una segunda consulta idéntica.
  useEffect(() => {
    const id = setTimeout(() => {
      const q = search.trim();
      setFilters((f) => (f.q === q ? f : { ...f, q }));
      setPage(0);
    }, 300);
    return () => clearTimeout(id);
  }, [search]);

  const buildParams = useCallback(
    (f: Filters): URLSearchParams => {
      const p = new URLSearchParams({ workspace_id: workspaceId ?? '' });
      const bounds = dateChipBounds(f.datePreset, f.dateCustom, tz);
      if (bounds.from) p.set('from', bounds.from);
      if (bounds.to) p.set('to', bounds.to);
      if (f.q) p.set('q', f.q);
      if (f.status.length) p.set('status', f.status.join(','));
      if (f.outcome.length) p.set('outcome', f.outcome.join(','));
      if (f.callType.length) p.set('call_type', f.callType.join(','));
      if (f.direction.length) p.set('direction', f.direction.join(','));
      if (f.agentId.length) p.set('agent_id', f.agentId.join(','));
      return p;
    },
    [workspaceId, tz],
  );

  const load = useCallback(async () => {
    if (!workspaceId) return;
    setLoading(true);
    try {
      const params = buildParams(filters);
      params.set('limit', String(pageSize));
      params.set('offset', String(page * pageSize));
      const res = await fetch(`/api/voice/calls?${params}`, { cache: 'no-store' });
      if (!res.ok) return;
      const json = (await res.json()) as { calls: CallRow[]; total: number };
      setCalls(json.calls ?? []);
      setTotal(json.total ?? 0);
    } finally {
      setLoading(false);
    }
  }, [workspaceId, buildParams, filters, page, pageSize]);

  useEffect(() => {
    // El registro se carga al entrar y al cambiar filtros (sin auto-refresco).
    load();
  }, [load]);

  async function exportCsv() {
    if (!workspaceId) return;
    setExporting(true);
    try {
      const params = buildParams(filters);
      params.set('export', '1');
      const res = await fetch(`/api/voice/calls?${params}`, { cache: 'no-store' });
      if (!res.ok) throw new Error('export failed');
      const { calls: rows, truncated } = (await res.json()) as {
        calls: CallRow[];
        truncated?: boolean;
      };
      downloadCsv(
        t('voice.exportFilename'),
        [
          t('voice.colWhen'),
          t('voice.colContact'),
          t('voice.phoneNumber'),
          t('voice.direction'),
          t('voice.callType'),
          t('voice.colStatus'),
          t('voice.outcome'),
          t('voice.exportDurationSeconds'),
          t('voice.agent'),
          t('voice.city'),
          t('voice.upsellAmount'),
          t('voice.metricCost'),
          t('voice.summary'),
        ],
        rows.map((c) => [
          format.dateTime(new Date(c.created_at)),
          c.contact?.name ?? '',
          c.phone ?? '',
          t(VOICE_DIRECTION_KEY[c.direction]),
          t(VOICE_TYPE_KEY[c.call_type]),
          t(voiceStatusLabel(c).statusKey),
          c.outcome ? t(VOICE_OUTCOME_KEY[c.outcome]) : '',
          c.duration_seconds ?? 0,
          c.agent?.name ?? '',
          c.city ?? '',
          c.upsell_amount ?? '',
          c.cost?.total_usd ?? '',
          c.summary ?? '',
        ]),
      );
      toast.success(t('voice.exported', { count: rows.length }));
      if (truncated) toast.warning(t('voice.exportTruncated'));
    } catch {
      toast.error(t('voice.exportError'));
    } finally {
      setExporting(false);
    }
  }

  const dirty =
    filters.q !== '' ||
    filters.datePreset !== 'all' ||
    filters.status.length > 0 ||
    filters.outcome.length > 0 ||
    filters.callType.length > 0 ||
    filters.direction.length > 0 ||
    filters.agentId.length > 0;

  const totalPages = Math.ceil(total / pageSize);
  const allLabel = t('voice.filterAll');

  return (
    <section className="rounded-xl border border-border bg-card p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-foreground">{t('voice.callLogTitle')}</h2>
        <Button
          variant="outline"
          size="sm"
          onClick={exportCsv}
          disabled={exporting || total === 0}
          className="border-border text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          {exporting ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Download className="size-4" />
          )}
          {t('voice.exportCsv')}
        </Button>
      </div>

      {/* Filtros */}
      <div className="mb-3 space-y-2">
        <div className="relative max-w-xs">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('voice.searchPlaceholder')}
            className="h-8 pl-9 text-xs"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <DateRangeChip
            label={t('voice.colWhen')}
            options={[...DATE_PRESETS]}
            preset={filters.datePreset}
            custom={filters.dateCustom}
            onChange={(preset, custom) => {
              setFilters((f) => ({ ...f, datePreset: preset, dateCustom: custom }));
              setPage(0);
            }}
          />
          <FilterMultiSelect
            label={t('voice.colStatus')}
            allLabel={allLabel}
            values={filters.status}
            onChange={(v) => set('status', v)}
            options={STATUSES.map((s) => ({ value: s, label: t(VOICE_STATUS_KEY[s]) }))}
          />
          <FilterMultiSelect
            label={t('voice.outcome')}
            allLabel={allLabel}
            values={filters.outcome}
            onChange={(v) => set('outcome', v)}
            options={OUTCOMES.map((o) => ({ value: o, label: t(VOICE_OUTCOME_KEY[o]) }))}
          />
          <FilterMultiSelect
            label={t('voice.callType')}
            allLabel={allLabel}
            values={filters.callType}
            onChange={(v) => set('callType', v)}
            options={ALL_CALL_TYPES.map((c) => ({ value: c, label: t(VOICE_TYPE_KEY[c]) }))}
          />
          <FilterMultiSelect
            label={t('voice.direction')}
            allLabel={allLabel}
            values={filters.direction}
            onChange={(v) => set('direction', v)}
            options={[
              { value: 'outbound', label: t('voice.directionOutbound') },
              { value: 'inbound', label: t('voice.directionInbound') },
            ]}
          />
          {agents.length > 0 && (
            <FilterMultiSelect
              label={t('voice.agent')}
              allLabel={allLabel}
              values={filters.agentId}
              onChange={(v) => set('agentId', v)}
              options={agents.map((a) => ({ value: a.id, label: a.name }))}
            />
          )}
          {dirty && (
            <button
              type="button"
              onClick={() => {
                setFilters(EMPTY);
                setSearch('');
                setPage(0);
              }}
              className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
            >
              {t('voice.clearFilters')}
            </button>
          )}
        </div>
      </div>

      {loading ? (
        <div className="flex items-center text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
        </div>
      ) : calls.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {dirty ? t('voice.noCallsMatch') : t('voice.noCalls')}
        </p>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground">
                  <th className="pb-2 pr-4 font-medium">{t('voice.colContact')}</th>
                  <th className="pb-2 pr-4 font-medium">{t('voice.callType')}</th>
                  <th className="pb-2 pr-4 font-medium">{t('voice.colStatus')}</th>
                  <th className="pb-2 pr-4 font-medium">{t('voice.outcome')}</th>
                  <th className="pb-2 pr-4 font-medium">{t('voice.duration')}</th>
                  <th className="pb-2 font-medium">{t('voice.colWhen')}</th>
                </tr>
              </thead>
              <tbody>
                {calls.map((c) => (
                  <tr
                    key={c.id}
                    onClick={() => setSelectedCall(c.id)}
                    className="cursor-pointer border-t border-border/60 hover:bg-muted/40"
                  >
                    <td className="py-2 pr-4">
                      <span className="inline-flex items-center gap-1.5 text-foreground">
                        {c.direction === 'inbound' ? (
                          <PhoneIncoming className="h-3.5 w-3.5 text-yellow-500" />
                        ) : (
                          <PhoneCall className="h-3.5 w-3.5 text-yellow-500" />
                        )}
                        {c.contact?.name || c.phone}
                        {c.recording_url && <Mic className="h-3 w-3 text-muted-foreground" />}
                      </span>
                    </td>
                    <td className="py-2 pr-4 text-muted-foreground">
                      {t(VOICE_TYPE_KEY[c.call_type])}
                    </td>
                    <td className="py-2 pr-4 text-muted-foreground">
                      {(() => {
                        // Una llamada que una barrera frenó se lee «No se
                        // llamó» con el motivo debajo: antes decía «Cancelada»
                        // a secas —o directamente no existía— y el comercio no
                        // tenía cómo saber que su freno estaba prendido.
                        const { statusKey, reasonKey } = voiceStatusLabel(c);
                        return (
                          <>
                            <span className="inline-flex items-center gap-1.5">
                              {(c.status === 'dialing' || c.status === 'in_progress') && (
                                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
                              )}
                              {t(statusKey)}
                            </span>
                            {reasonKey && (
                              <span className="mt-0.5 block text-[11px] text-amber-600 dark:text-amber-400">
                                {t(reasonKey)}
                              </span>
                            )}
                          </>
                        );
                      })()}
                    </td>
                    <td className="py-2 pr-4 text-muted-foreground">
                      {c.outcome ? t(VOICE_OUTCOME_KEY[c.outcome]) : '—'}
                    </td>
                    <td className="py-2 pr-4 text-muted-foreground">
                      {fmtCallDuration(c.duration_seconds)}
                    </td>
                    <td className="py-2 text-muted-foreground">
                      {format.dateTime(new Date(c.created_at))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Paginado + tamaño de página */}
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <p className="text-xs text-muted-foreground">
                {t('voice.paginationRange', {
                  from: page * pageSize + 1,
                  to: Math.min((page + 1) * pageSize, total),
                  total,
                })}
              </p>
              <div className="inline-flex items-center gap-1">
                <span className="text-xs text-muted-foreground">{t('voice.perPage')}</span>
                {PAGE_SIZES.map((size) => (
                  <button
                    key={size}
                    type="button"
                    onClick={() => {
                      setPageSize(size);
                      setPage(0);
                    }}
                    className={cn(
                      'rounded-md px-2 py-1 text-xs font-medium tabular-nums transition-colors',
                      pageSize === size
                        ? 'bg-muted text-foreground'
                        : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                    )}
                  >
                    {size}
                  </button>
                ))}
              </div>
            </div>
            {totalPages > 1 && (
              <div className="flex items-center gap-1">
                <Button
                  variant="outline"
                  size="icon-sm"
                  disabled={page === 0}
                  onClick={() => setPage((p) => p - 1)}
                  className="border-border text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-30"
                >
                  <ChevronLeft className="size-4" />
                </Button>
                <span className="px-2 text-xs text-muted-foreground">
                  {t('voice.pageOf', { page: page + 1, total: totalPages })}
                </span>
                <Button
                  variant="outline"
                  size="icon-sm"
                  disabled={page >= totalPages - 1}
                  onClick={() => setPage((p) => p + 1)}
                  className="border-border text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-30"
                >
                  <ChevronRight className="size-4" />
                </Button>
              </div>
            )}
          </div>
        </>
      )}

      <CallDetail callId={selectedCall} onClose={() => setSelectedCall(null)} />
    </section>
  );
}
