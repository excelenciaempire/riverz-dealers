'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, CheckCircle2, Trash2, Target } from 'lucide-react';
import { useFetchWithCsrf } from '@/lib/api/fetch-with-csrf';
import { useT } from '@/hooks/use-locale';
import { cn } from '@/lib/utils';

/**
 * El píxel de Meta, para que las ventas del chat existan para el algoritmo.
 *
 * Cuando el agente cierra la venta en la conversación —contra-entrega, sobre
 * todo— no hay página de gracias, así que el píxel del navegador nunca dispara
 * un `Purchase`. Para Meta esa venta no ocurrió: optimiza a ciegas, el ROAS se
 * ve más bajo de lo que es, y el comercio termina apagando una campaña que
 * estaba funcionando.
 *
 * Con esto conectado, cada pedido que crea el agente se le cuenta a Meta desde
 * el servidor, con las señales que el chat capturó en la tienda para que se
 * pueda atribuir al anuncio correcto.
 *
 * El token se guarda cifrado y nunca vuelve al navegador. El ID sí: es público
 * —va en el HTML de cualquier tienda— y verlo es cómo el comercio sabe que
 * conectó el píxel correcto.
 */
export function MetaPixelCard() {
  const fetchWithCsrf = useFetchWithCsrf();
  const t = useT();
  const [connected, setConnected] = useState(false);
  const [pixelId, setPixelId] = useState('');
  const [token, setToken] = useState('');
  const [guardado, setGuardado] = useState<string | null>(null);
  const [contadas, setContadas] = useState(0);
  const [sinEnviar, setSinEnviar] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/integrations/meta-pixel', { cache: 'no-store' });
      const json = await res.json();
      if (res.ok) {
        setConnected(!!json.connected);
        setGuardado(json.pixel_id ?? null);
        setContadas(Number(json.contadas ?? 0));
        setSinEnviar(Number(json.sin_enviar ?? 0));
      }
    } catch {
      /* no-op */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function save() {
    setSaving(true);
    try {
      const res = await fetchWithCsrf('/api/integrations/meta-pixel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pixel_id: pixelId.trim(), access_token: token.trim() }),
      });
      const json = await res.json();
      if (!res.ok) {
        toast.error(json?.error ?? t('settings.networkError'));
        return;
      }
      setConnected(true);
      setGuardado(json.pixel_id ?? pixelId.trim());
      setToken('');
      const recuperadas = Number(json.recuperadas ?? 0);
      toast.success(t('settings.metaPixelConnected'), {
        description:
          recuperadas > 0
            ? t('settings.metaPixelRecovered', { n: String(recuperadas) })
            : undefined,
      });
      // Para que los contadores muestren lo que se acaba de encolar.
      load();
    } catch {
      toast.error(t('settings.networkError'));
    } finally {
      setSaving(false);
    }
  }

  async function disconnect() {
    setSaving(true);
    try {
      const res = await fetchWithCsrf('/api/integrations/meta-pixel', { method: 'DELETE' });
      if (!res.ok) {
        toast.error(t('settings.disconnectError'));
        return;
      }
      setConnected(false);
      setGuardado(null);
      toast.success(t('settings.metaPixelDisconnected'));
    } catch {
      toast.error(t('settings.networkError'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <li
      className={cn(
        'group flex flex-col gap-3 overflow-hidden rounded-xl border bg-card p-4 transition-all',
        connected
          ? 'border-emerald-500/40 shadow-[inset_0_0_0_1px_rgba(16,185,129,0.1)]'
          : 'border-border hover:border-foreground/30',
      )}
    >
      <div className="flex items-start gap-3">
        <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-white p-2 shadow-sm ring-1 ring-border">
          <Target className="size-6 text-[#0866FF]" />
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-foreground">
            {t('settings.metaPixelTitle')}
          </p>
          <p className="mt-0.5 line-clamp-3 text-[11px] leading-snug text-muted-foreground">
            {t('settings.metaPixelDescription')}
          </p>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-3">
          <Loader2 className="size-4 animate-spin text-muted-foreground" />
        </div>
      ) : connected ? (
        <div className="space-y-1.5">
          <li className="flex list-none items-center gap-2 rounded-md bg-muted/60 px-2 py-1.5 ring-1 ring-border/50">
            <CheckCircle2 className="size-3.5 text-emerald-700 dark:text-emerald-400" />
            <span className="flex-1 truncate text-xs text-foreground">
              {guardado ? `${t('settings.connected')} · ${guardado}` : t('settings.connected')}
            </span>
            <button
              onClick={disconnect}
              disabled={saving}
              title={t('settings.metaPixelDisconnect')}
              className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-amber-700 dark:hover:text-amber-400"
            >
              {saving ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Trash2 className="size-3.5" />
              )}
            </button>
          </li>
          {/* Un píxel con el token vencido también dice "conectado". */}
          <p className="px-2 text-[11px] text-muted-foreground">
            {contadas > 0
              ? t('settings.metaPixelCounted', { n: String(contadas) })
              : t('settings.metaPixelNoneYet')}
            {sinEnviar > 0 && (
              <span className="text-amber-600 dark:text-amber-400">
                {' · '}
                {t('settings.metaPixelPending', { n: String(sinEnviar) })}
              </span>
            )}
          </p>
        </div>
      ) : null}

      {!loading && !connected && (
        <div className="mt-auto space-y-2">
          <input
            value={pixelId}
            onChange={(e) => setPixelId(e.target.value)}
            inputMode="numeric"
            placeholder={t('settings.metaPixelIdPlaceholder')}
            className="w-full rounded-lg border border-border bg-muted px-2.5 py-1.5 text-xs text-foreground focus:border-primary focus:outline-none"
          />
          <input
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder={t('settings.metaPixelTokenPlaceholder')}
            className="w-full rounded-lg border border-border bg-muted px-2.5 py-1.5 text-xs text-foreground focus:border-primary focus:outline-none"
          />
          <button
            onClick={save}
            disabled={saving}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
          >
            {saving ? <Loader2 className="size-4 animate-spin" /> : <Target className="size-4" />}
            {t('common.connect')}
          </button>
        </div>
      )}
    </li>
  );
}
