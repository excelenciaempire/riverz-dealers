'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, ShieldAlert, KeyRound, Check } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useFetchWithCsrf } from '@/lib/api/fetch-with-csrf';
import { useT } from '@/hooks/use-locale';
import { cn } from '@/lib/utils';

type Mode = 'all' | 'selected' | 'off';

interface WorkspaceRow {
  id: string;
  name: string;
  covered: boolean;
  explicit: boolean;
  calls: number;
  spend_platform_usd: number;
  spend_own_usd: number;
}

interface Payload {
  mode: Mode;
  has_key: boolean;
  key_hint: string | null;
  days: number;
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
export default function AdminAiKeyPage() {
  const t = useT();
  const fetchWithCsrf = useFetchWithCsrf();
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [keyDraft, setKeyDraft] = useState('');
  const [savingKey, setSavingKey] = useState(false);
  const [savingWs, setSavingWs] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/ai-key', { cache: 'no-store' });
      if (res.status === 403) {
        setForbidden(true);
        return;
      }
      if (res.ok) setData((await res.json()) as Payload);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

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
      void load();
    },
    [data, fetchWithCsrf, load, t],
  );

  const saveKey = useCallback(async () => {
    setSavingKey(true);
    try {
      const res = await fetchWithCsrf('/api/admin/ai-key', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ key: keyDraft.trim() }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => null)) as { error?: string } | null;
        toast.error(j?.error ?? t('admin.aiKeySaveError'));
        return;
      }
      setKeyDraft('');
      toast.success(t('admin.aiKeySaved'));
      void load();
    } finally {
      setSavingKey(false);
    }
  }, [fetchWithCsrf, keyDraft, load, t]);

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
        void load();
        toast.error(t('admin.aiKeySaveError'));
      } finally {
        setSavingWs(null);
      }
    },
    [fetchWithCsrf, load, t],
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

  if (loading) {
    return (
      <div className="flex h-48 items-center justify-center">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (forbidden) {
    return (
      <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-4 text-sm">
        <ShieldAlert className="mt-0.5 size-4 text-amber-600 dark:text-amber-400" />
        <p className="text-amber-700 dark:text-amber-300">{t('admin.forbidden')}</p>
      </div>
    );
  }

  if (!data) return null;

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
        <div className="flex gap-2">
          <Input
            type="password"
            autoComplete="off"
            placeholder={data.has_key ? t('admin.aiKeyReplace') : 'sk-ant-…'}
            value={keyDraft}
            onChange={(e) => setKeyDraft(e.target.value)}
            className="max-w-md font-mono text-xs"
          />
          <Button onClick={saveKey} disabled={savingKey || !keyDraft.trim()}>
            {savingKey ? <Loader2 className="size-4 animate-spin" /> : t('common.save')}
          </Button>
        </div>
      </section>

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
                {data.mode === m.value && <Check className="size-3.5 text-primary" />}
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
                    {data.mode === 'all' ? (
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
