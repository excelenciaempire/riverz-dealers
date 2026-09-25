'use client';

import { useCallback, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { KeyRound, Check } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { useFetchWithCsrf } from '@/lib/api/fetch-with-csrf';
import Link from '@/components/i18n/locale-link';
import { useT } from '@/hooks/use-locale';
import { cn } from '@/lib/utils';
import {
  useAdminData,
  Loading,
  LoadError,
} from '../_components/admin-ui';

type Mode = 'all' | 'selected' | 'off';

interface WorkspaceRow {
  id: string;
  name: string;
  covered: boolean;
  explicit: boolean;
  /** Paga su IA con su clave: la de Riverz no la cubre en ningún modo. */
  byok: boolean;
  calls: number;
  spend_platform_usd: number;
  spend_own_usd: number;
}

interface Payload {
  mode: Mode;
  has_key: boolean;
  key_hint: string | null;
  days: number;
  /** La otra vía por la que la IA toca las cuentas: un agente vía /api/mcp. */
  mcp?: {
    enabled: boolean;
    calls_7d: number;
    failed_7d: number;
    top_tools: { tool: string; n: number }[];
  };
  workspaces: WorkspaceRow[];
  totals: { platform_usd: number; own_usd: number; covered: number };
}

const usd = (n: number) =>
  n >= 0.01 ? `$${n.toFixed(2)}` : n > 0 ? `<$0.01` : '—';

/**
 * Quién paga la IA.
 *
 * Riverz pone una clave y decide a qué cuentas cubre. Las que no cubre traen
 * la suya (BYOK). La pantalla existe para poder responder dos preguntas antes
 * de ponerle precio a nada: a quién le estamos pagando la IA, y cuánto.
 */
export function Texto() {
  const t = useT();
  const fetchWithCsrf = useFetchWithCsrf();
  // Sin refresco automático a propósito: hay un campo de clave en pantalla y
  // una recarga de fondo mientras alguien escribe le borraría lo tipeado.
  const { data, loading, error, reload, setData } = useAdminData<Payload>(
    '/api/admin/ai-key',
    0,
  );
  const [savingWs, setSavingWs] = useState<string | null>(null);

  const setMode = useCallback(
    async (mode: Mode) => {
      const prev = data;
      setData((d) => (d ? { ...d, mode } : d));
      const res = await fetchWithCsrf('/api/admin/ai-key', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mode }),
      });
      if (!res.ok) {
        setData(prev);
        toast.error(t('admin.aiKeySaveError'));
        return;
      }
      toast.success(t('admin.aiKeySaved'));
      reload();
    },
    [data, fetchWithCsrf, reload, setData, t],
  );

  const toggleWorkspace = useCallback(
    async (row: WorkspaceRow, enabled: boolean) => {
      setSavingWs(row.id);
      setData((d) =>
        d
          ? {
              ...d,
              workspaces: d.workspaces.map((w) =>
                w.id === row.id ? { ...w, explicit: enabled, covered: enabled } : w,
              ),
            }
          : d,
      );
      try {
        const res = await fetchWithCsrf('/api/admin/ai-key/workspaces', {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ workspace_id: row.id, enabled }),
        });
        if (!res.ok) throw new Error('failed');
        const j = (await res.json()) as { has_own_key?: boolean };
        // Sacarlo de la clave de Riverz sin que tenga la suya lo deja mudo.
        // Vale más avisarlo acá que descubrirlo por un cliente sin atender.
        if (!enabled && !j.has_own_key) {
          toast.warning(t('admin.aiKeyNoFallback', { name: row.name }));
        } else {
          toast.success(t('admin.aiKeySaved'));
        }
      } catch {
        reload();
        toast.error(t('admin.aiKeySaveError'));
      } finally {
        setSavingWs(null);
      }
    },
    [fetchWithCsrf, reload, setData, t],
  );

  const sorted = useMemo(
    () =>
      [...(data?.workspaces ?? [])].sort(
        (a, b) =>
          b.spend_platform_usd - a.spend_platform_usd ||
          b.calls - a.calls ||
          a.name.localeCompare(b.name),
      ),
    [data],
  );

  if (loading) return <Loading forma="panel" />;
  if (error || !data) return <LoadError onRetry={reload} />;

  const MODES: { value: Mode; label: string; hint: string }[] = [
    { value: 'all', label: t('admin.aiKeyModeAll'), hint: t('admin.aiKeyModeAllHint') },
    {
      value: 'selected',
      label: t('admin.aiKeyModeSelected'),
      hint: t('admin.aiKeyModeSelectedHint'),
    },
    { value: 'off', label: t('admin.aiKeyModeOff'), hint: t('admin.aiKeyModeOffHint') },
  ];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-lg font-medium">{t('admin.aiKeyTitle')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('admin.aiKeySubtitle')}</p>
      </div>

      {/* La clave */}
      <section className="space-y-3">
        <div className="flex items-center gap-2 text-sm font-medium">
          <KeyRound className="size-4 text-muted-foreground" />
          {t('admin.aiKeyTheKey')}
          {data.has_key && (
            <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs text-emerald-500 ring-1 ring-emerald-500/30">
              {data.key_hint ?? t('admin.aiKeyLoaded')}
            </span>
          )}
        </div>
        {/* La llave se carga en UN solo lado.
            Se cargaba acá y en Llaves, las dos escribiendo la misma columna de
            `platform_ai_settings` y mostrando pistas distintas de la misma
            clave: una decía «…7f2a» y la otra «sk-ant-…7f2a», así que parecían
            dos llaves. Acá queda el estado, que es lo que esta pantalla
            necesita saber, y el enlace al único lugar donde se escribe. */}
        <p className="text-sm text-muted-foreground">
          <Link
            href="/admin/proveedores?tab=llaves"
            className="underline underline-offset-4 hover:text-foreground"
          >
            {t('admin.aiKeyManageThere')}
          </Link>
        </p>
      </section>

      {/* La otra puerta: un agente operando por MCP. Va acá y no en una sección
          nueva porque la pregunta es la misma — qué hace la IA sobre las
          cuentas — y hasta ahora no se veía por ningún lado. */}
      {data.mcp && (
        <section className="space-y-2">
          <div className="text-sm font-medium">{t('admin.mcpTitle')}</div>
          <div className="rounded-lg border border-border bg-card p-4">
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
              <span
                className={cn(
                  'inline-flex items-center gap-1.5',
                  data.mcp.enabled
                    ? 'text-emerald-600 dark:text-emerald-400'
                    : 'text-muted-foreground',
                )}
              >
                <span
                  className={cn(
                    'size-1.5 rounded-full',
                    data.mcp.enabled ? 'bg-emerald-500' : 'bg-muted-foreground/40',
                  )}
                />
                {t(data.mcp.enabled ? 'admin.mcpOn' : 'admin.mcpOff')}
              </span>
              <span className="text-muted-foreground">
                {t('admin.mcpCalls', { n: data.mcp.calls_7d })}
              </span>
              {data.mcp.failed_7d > 0 && (
                <span className="text-red-600 dark:text-red-400">
                  {t('admin.mcpFailed', { n: data.mcp.failed_7d })}
                </span>
              )}
            </div>
            {data.mcp.top_tools.length > 0 && (
              <p className="mt-2 text-xs text-muted-foreground">
                {data.mcp.top_tools.map((x) => `${x.tool} (${x.n})`).join(' · ')}
              </p>
            )}
            <p className="mt-2 text-xs text-muted-foreground">{t('admin.mcpHint')}</p>
          </div>
        </section>
      )}

      {/* A quién cubre */}
      <section className="space-y-3">
        <div className="text-sm font-medium">{t('admin.aiKeyWhoTitle')}</div>
        <div className="grid gap-2 sm:grid-cols-3">
          {MODES.map((m) => (
            <button
              key={m.value}
              onClick={() => setMode(m.value)}
              className={cn(
                'rounded-lg border p-3 text-left transition',
                data.mode === m.value
                  ? 'border-primary bg-primary/5'
                  : 'border-border hover:border-muted-foreground/40',
              )}
            >
              <div className="flex items-center gap-1.5 text-sm font-medium">
                {data.mode === m.value && <Check className="size-3.5 text-accent-ink" />}
                {m.label}
              </div>
              <div className="mt-0.5 text-xs text-muted-foreground">{m.hint}</div>
            </button>
          ))}
        </div>
      </section>

      {/* Gasto */}
      <section className="grid gap-3 sm:grid-cols-3">
        <Card
          label={t('admin.aiKeySpendPlatform', { days: data.days })}
          value={usd(data.totals.platform_usd)}
        />
        <Card
          label={t('admin.aiKeySpendOwn', { days: data.days })}
          value={usd(data.totals.own_usd)}
        />
        <Card label={t('admin.aiKeyCovered')} value={String(data.totals.covered)} />
      </section>

      {/* Por cuenta */}
      <section className="space-y-2">
        <div className="text-sm font-medium">{t('admin.aiKeyByAccount')}</div>
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-muted/30 text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left font-medium">
                  {t('admin.aiKeyColAccount')}
                </th>
                <th className="px-3 py-2 text-right font-medium">
                  {t('admin.aiKeyColCalls')}
                </th>
                <th className="px-3 py-2 text-right font-medium">
                  {t('admin.aiKeyColRiverz')}
                </th>
                <th className="px-3 py-2 text-right font-medium">
                  {t('admin.aiKeyColOwn')}
                </th>
                <th className="px-3 py-2 text-right font-medium">
                  {t('admin.aiKeyColCovered')}
                </th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((w) => (
                <tr key={w.id} className="border-b border-border/50 last:border-0">
                  <td className="px-3 py-2">{w.name}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                    {w.calls || '—'}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {usd(w.spend_platform_usd)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                    {usd(w.spend_own_usd)}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {w.byok ? (
                      <span className="text-xs text-muted-foreground">
                        {t('admin.billingModel_byok')}
                      </span>
                    ) : data.mode === 'all' ? (
                      <span className="text-xs text-muted-foreground">
                        {t('admin.aiKeyAllOn')}
                      </span>
                    ) : (
                      <Switch
                        checked={w.explicit}
                        disabled={data.mode === 'off' || savingWs === w.id}
                        onCheckedChange={(v) => toggleWorkspace(w, v)}
                      />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function Card({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-xl font-medium tabular-nums">{value}</div>
    </div>
  );
}
