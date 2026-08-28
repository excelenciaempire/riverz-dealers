'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { AlertTriangle, Check, ChevronDown, Copy, Loader2, Target } from 'lucide-react';
import Link from '@/components/i18n/locale-link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { useFetchWithCsrf } from '@/lib/api/fetch-with-csrf';
import { useT } from '@/hooks/use-locale';
import { useFormat } from '@/hooks/use-format';
import { cn } from '@/lib/utils';
import { ImagenDelChat } from '@/components/settings/webchat/imagen';
import { ListaDeChips } from '@/components/settings/webchat/lista-de-chips';
import { VistaPrevia } from '@/components/settings/webchat/vista-previa';
import type { WebchatConfig } from '@/types';

/**
 * Instalar y configurar el chat de la tienda.
 *
 * La pantalla contesta cuatro preguntas y en este orden: ¿está puesto?, ¿cómo
 * se ve?, ¿cómo se comporta?, ¿cuándo sale a buscar? Antes eran cinco tarjetas
 * apiladas y abiertas a la vez: todo visible es todo igual de importante, y una
 * pantalla donde nada resalta se lee como complicada aunque cada opción por
 * separado sea simple. Ahora una pregunta a la vez, en pestañas.
 *
 * Arriba, lo único que se mira sin venir a cambiar nada: si está vivo y qué
 * produjo. Y a la derecha, fijo, cómo va quedando — porque el color, el nombre
 * y el saludo se elegían a ciegas.
 *
 * **Sin texto que repita la etiqueta.** Sólo quedan las ayudas que dicen algo
 * que no se deduce del nombre, y las que avisan de una consecuencia.
 */

interface Agente {
  id: string;
  name: string;
  is_active: boolean;
}

interface Stats {
  period_days: number;
  conversations: number;
  resolved: number;
  escalated: number;
  orders: number;
  revenue: number;
  currency: string | null;
  /** El total de CADA moneda, de mayor a menor volumen. Una tienda que vende
   *  en pesos y en dólares no tiene un solo número. */
  revenue_by_currency?: { currency: string | null; revenue: number; orders: number }[];
  /** Qué tan seguido cerró el caso solo, y contra el período anterior. */
  resolution_rate: number | null;
  resolution_rate_previous: number | null;
  /** Cuánta gente calificó y a cuánta le sirvió. */
  rated: number;
  satisfaction_rate: number | null;
  /** Mediana de segundos hasta la primera respuesta. */
  first_response_seconds: number | null;
}

/** Con qué contesta: cuántos productos tienen ficha cargada. */
interface Conocimiento {
  total: number;
  con_ficha: number;
  sin_ficha: number;
  ejemplos: string[];
}

/** Lo que el chat le está contando a Meta. */
interface Pixel {
  connected: boolean;
  contadas: number;
  contactos: number;
}

/** "18 s", "4 min", "2 h". Un número en segundos no se lee. */
function espera(segundos: number | null): string {
  if (segundos == null) return '—';
  if (segundos < 90) return `${segundos} s`;
  if (segundos < 5400) return `${Math.round(segundos / 60)} min`;
  return `${Math.round(segundos / 3600)} h`;
}

/** Cuándo se abre solo. Se ofrecen tiempos, no un campo de número: "¿cuántos
 *  segundos?" es una pregunta que nadie sabe contestar. */
const AUTO_OPEN = [0, 5, 15, 30] as const;

/** Cuánto tiene que haber leído de la página para que valga la pena hablarle. */
const SCROLL = [0, 25, 50, 75] as const;

/**
 * Las cuatro preguntas, en el orden en que se las hace el comercio.
 *
 * El cambio de sección se hace a mano y no con el componente `Tabs` de la
 * librería: ese deja el panel anterior montado y VISIBLE al cambiar de
 * pestaña —verificado en producción, dos paneles pintados uno debajo del
 * otro—, que es exactamente el amontonamiento que las pestañas venían a
 * resolver. Cuatro botones y un `if` no pueden fallar así.
 */
const SECCIONES = [
  { id: 'instalacion', key: 'webchat.install' },
  { id: 'apariencia', key: 'webchat.appearance' },
  { id: 'comportamiento', key: 'webchat.behavior' },
  { id: 'invitacion', key: 'webchat.proactive' },
] as const;

type Seccion = (typeof SECCIONES)[number]['id'];

export function WebchatPanel() {
  const t = useT();
  const format = useFormat();
  const fetchWithCsrf = useFetchWithCsrf();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const [cfg, setCfg] = useState<WebchatConfig>({});
  const [snippet, setSnippet] = useState('');
  const [agents, setAgents] = useState<Agente[]>([]);
  const [instalado, setInstalado] = useState<boolean | null>(null);
  const [motivoInstalar, setMotivoInstalar] = useState<string | null>(null);
  const [instalando, setInstalando] = useState(false);
  const [stats, setStats] = useState<Stats | null>(null);
  const [pixel, setPixel] = useState<Pixel | null>(null);
  const [suggested, setSuggested] = useState<string[]>([]);
  const [seccion, setSeccion] = useState<Seccion>('instalacion');
  const [saber, setSaber] = useState<Conocimiento | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const [cfgRes, statsRes, pixelRes, saberRes] = await Promise.all([
          fetch('/api/webchat/config', { cache: 'no-store' }),
          fetch('/api/webchat/stats', { cache: 'no-store' }),
          fetch('/api/integrations/meta-pixel', { cache: 'no-store' }),
          fetch('/api/webchat/knowledge', { cache: 'no-store' }),
        ]);
        if (cfgRes.ok) {
          const json = await cfgRes.json();
          setCfg(json.config ?? {});
          setSnippet(json.snippet ?? '');
          setSuggested(json.suggested_domains ?? []);
          setAgents(json.agents ?? []);
        }
        if (statsRes.ok) setStats(await statsRes.json());
        if (saberRes.ok) setSaber(await saberRes.json());
        if (pixelRes.ok) {
          const j = await pixelRes.json();
          setPixel({
            connected: !!j.connected,
            contadas: Number(j.contadas ?? 0),
            contactos: Number(j.contactos ?? 0),
          });
        }
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    let cancelado = false;
    fetch('/api/webchat/install')
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (cancelado || !j) return;
        setInstalado(j.installed);
        setMotivoInstalar(j.reason ?? null);
      })
      .catch(() => {});
    return () => {
      cancelado = true;
    };
  }, []);

  const save = useCallback(
    async (patch: WebchatConfig) => {
      setSaving(true);
      try {
        const res = await fetchWithCsrf('/api/webchat/config', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(patch),
        });
        if (!res.ok) throw new Error(String(res.status));
        const json = await res.json();
        setCfg(json.config ?? {});
        setSnippet(json.snippet ?? '');
        setSuggested(json.suggested_domains ?? []);
      } catch {
        toast.error(t('webchat.saveFailed'));
      } finally {
        setSaving(false);
      }
    },
    [fetchWithCsrf, t],
  );

  const instalar = async (poner: boolean) => {
    setInstalando(true);
    try {
      const res = await fetchWithCsrf('/api/webchat/install', {
        method: poner ? 'POST' : 'DELETE',
      });
      const json = await res.json().catch(() => null);
      if (res.ok) {
        setInstalado(poner);
        setMotivoInstalar(null);
        toast.success(t(poner ? 'webchat.installedOk' : 'webchat.uninstalledOk'));
      } else {
        toast.error(json?.message ?? t('webchat.installFailed'));
      }
    } finally {
      setInstalando(false);
    }
  };

  // ¿Se puede instalar con un botón? Sólo con una tienda Shopify conectada.
  const hayBoton = instalado !== null || motivoInstalar === 'sin_permiso';
  const domains = cfg.allowed_domains ?? [];
  const enabled = Boolean(cfg.enabled);

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
      </div>
    );
  }

  // Por qué el chat no se ve. Son las dos únicas razones, y hasta ahora el
  // comercio tenía que deducirlas: pegaba el código, no pasaba nada, y el
  // widget —que falla callado para no ensuciar su tienda— no decía por qué.
  //
  // La tercera es la que no se veia: el chat es la BOCA, el agente es quien
  // piensa. Un chat "Activo", con su dominio y su codigo puesto, igual no
  // contesta si no hay un agente encendido -- el mensaje entra a la bandeja y
  // ahi se queda. Paso en Pilar: el unico agente quedo en pausa y la pantalla
  // seguia diciendo "Activo".
  const elegido = cfg.agent_id ? agents.find((a) => a.id === cfg.agent_id) : null;
  const hayQuienConteste = cfg.agent_id
    ? Boolean(elegido?.is_active)
    : agents.some((a) => a.is_active);
  const motivoInvisible = !enabled
    ? t('webchat.whyOff')
    : domains.length === 0
      ? t('webchat.whyNoDomains')
      : !hayQuienConteste
        ? t(cfg.agent_id ? 'webchat.whyAgentPaused' : 'webchat.whyNoAgent')
        : null;

  return (
    <div className="space-y-4">
      {/* ── Estado: lo único que se mira sin venir a cambiar nada ── */}
      <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
        <div className="flex items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-2">
            <span
              className={cn(
                'size-2 shrink-0 rounded-full',
                enabled && !motivoInvisible ? 'bg-emerald-500' : 'bg-muted-foreground/40',
              )}
            />
            <p className="text-sm font-medium text-foreground">
              {t(enabled ? 'webchat.live' : 'webchat.off')}
            </p>
            {domains.length > 0 ? (
              <span className="truncate text-xs text-muted-foreground">· {domains[0]}</span>
            ) : null}
          </div>
          <Switch checked={enabled} onCheckedChange={(c) => save({ enabled: c })} />
        </div>

        {motivoInvisible ? (
          <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-2.5">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
            <p className="min-w-0 flex-1 text-xs text-amber-700 dark:text-amber-300">
              {motivoInvisible}
            </p>
            {enabled && domains.length > 0 && !hayQuienConteste ? (
              <Button render={<Link href="/asistente" />} size="sm" variant="outline">
                {t('webchat.whyNoAgentCta')}
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>

      {/* ── Qué produjo ── */}
      {stats && stats.conversations > 0 ? (
        <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
          <div className="mb-3 flex items-baseline justify-between gap-2">
            <p className="text-sm font-medium text-foreground">{t('webchat.results')}</p>
            <span className="text-xs text-muted-foreground">{t('webchat.period')}</span>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <Stat label={t('webchat.conversations')} value={String(stats.conversations)} />
            <Stat
              label={t('webchat.resolutionRate')}
              value={stats.resolution_rate == null ? '—' : `${stats.resolution_rate}%`}
              // Contra el período anterior: un porcentaje solo no dice si el
              // canal está mejorando, que es lo único que se hace con esto.
              extra={
                stats.resolution_rate != null && stats.resolution_rate_previous != null
                  ? [
                      `${stats.resolution_rate >= stats.resolution_rate_previous ? '+' : ''}${
                        stats.resolution_rate - stats.resolution_rate_previous
                      } pts`,
                    ]
                  : undefined
              }
            />
            <Stat
              label={t('webchat.satisfaction')}
              value={stats.satisfaction_rate == null ? '—' : `${stats.satisfaction_rate}%`}
              extra={
                stats.rated > 0 ? [t('webchat.ratedCount', { n: String(stats.rated) })] : undefined
              }
            />
            <Stat label={t('webchat.firstResponse')} value={espera(stats.first_response_seconds)} />
            <Stat label={t('webchat.ordersAttributed')} value={String(stats.orders)} />
            <Stat
              label={t('webchat.revenue')}
              value={
                stats.currency
                  ? format.currency(stats.revenue, stats.currency)
                  : String(Math.round(stats.revenue))
              }
              // Las otras monedas debajo, sin inventar un total: sumarlas y
              // etiquetarlas con la del primer pedido daba un número que no
              // existe, y es el número con el que se decide si el canal sirve.
              extra={(stats.revenue_by_currency ?? [])
                .slice(1)
                .map((r) =>
                  r.currency ? format.currency(r.revenue, r.currency) : String(Math.round(r.revenue)),
                )}
            />
          </div>

        </div>
      ) : null}

      {/* Lo que de todo esto ve Meta.
          Fila propia y siempre visible: estaba dentro de la tarjeta de
          resultados, que no se pinta sin conversaciones — así que justo quien
          todavía no arrancó, el que más necesita conectarlo ANTES de gastar en
          anuncios, nunca se enteraba de que existía. */}
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card px-4 py-3 shadow-sm">
        <Target className="size-3.5 shrink-0 text-[#0866FF]" aria-hidden />
        <span className="text-xs font-medium text-foreground">{t('webchat.pixel')}</span>
        {pixel?.connected ? (
          <span className="text-xs text-muted-foreground">
            {t('webchat.pixelReported', {
              contacts: String(pixel.contactos),
              sales: String(pixel.contadas),
            })}
          </span>
        ) : (
          <>
            <span className="min-w-0 flex-1 text-xs text-muted-foreground">
              {t('webchat.pixelOff')}
            </span>
            <Button render={<Link href="/integraciones" />} size="sm" variant="outline">
              {t('webchat.pixelConnect')}
            </Button>
          </>
        )}
      </div>

      {/* ── Configuración, una pregunta a la vez, con la vista previa al lado ── */}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div>
          <div
            role="tablist"
            className="mb-3 flex flex-wrap items-center gap-1 border-b border-border"
          >
            {SECCIONES.map(({ id, key }) => (
              <button
                key={id}
                id={`webchat-tab-${id}`}
                type="button"
                role="tab"
                aria-selected={seccion === id}
                onClick={() => setSeccion(id)}
                className={cn(
                  '-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors',
                  seccion === id
                    ? 'border-foreground text-foreground'
                    : 'border-transparent text-muted-foreground hover:text-foreground',
                )}
              >
                {t(key)}
              </button>
            ))}
          </div>

          <div role="tabpanel" aria-labelledby={`webchat-tab-${seccion}`}>
          {/* ── ¿Está puesto? ── */}
          {seccion === 'instalacion' && (
            <Card>
              {/* El camino bueno primero. Con la tienda conectada es un botón;
                  el código a mano queda plegado para quien no usa Shopify. */}
              {hayBoton ? (
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground">
                      {t('webchat.installAuto')}
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {motivoInstalar === 'sin_permiso'
                        ? t('webchat.installNeedsReconnect')
                        : instalado
                          ? t('webchat.installAutoOn')
                          : t('webchat.installAutoHint')}
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant={instalado ? 'outline' : 'default'}
                    disabled={instalando || motivoInstalar === 'sin_permiso'}
                    onClick={() => instalar(!instalado)}
                  >
                    {instalando ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      t(instalado ? 'webchat.uninstall' : 'webchat.installNow')
                    )}
                  </Button>
                </div>
              ) : null}

              {/* El código a mano se pliega SÓLO cuando hay un botón que hace
                  el trabajo. Sin tienda conectada es el único camino, y
                  esconder el único camino deja la pantalla diciendo nada. */}
              <details className={hayBoton ? 'mt-3' : ''} open={!hayBoton}>
                <summary
                  className={
                    hayBoton
                      ? 'flex cursor-pointer list-none items-center gap-1 text-xs text-muted-foreground transition hover:text-foreground'
                      : 'list-none text-sm font-medium text-foreground'
                  }
                >
                  {hayBoton ? <ChevronDown className="h-3 w-3" /> : null}
                  {t(hayBoton ? 'webchat.installManual' : 'webchat.install')}
                </summary>
                <div className="mt-2 flex items-start gap-2">
                  <code className="min-w-0 flex-1 overflow-x-auto rounded-lg bg-muted px-3 py-2 text-[11px] leading-relaxed text-foreground">
                    {snippet}
                  </code>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      navigator.clipboard.writeText(snippet);
                      setCopied(true);
                      setTimeout(() => setCopied(false), 1800);
                    }}
                  >
                    {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                    <span className="ml-1.5">{copied ? t('webchat.copied') : t('webchat.copy')}</span>
                  </Button>
                </div>
              </details>

              <div className="mt-4 border-t border-border pt-4">
                <Field label={t('webchat.domains')}>
                  {/* La ayuda sólo con la lista vacía: ahí es una instrucción.
                      Con dominios cargados repite lo que ya se ve. */}
                  {domains.length === 0 ? (
                    <p className="mb-2 text-xs text-muted-foreground">
                      {t('webchat.domainsEmpty')}
                    </p>
                  ) : null}
                  <ListaDeChips
                    values={domains}
                    onChange={(next) => save({ allowed_domains: next })}
                    placeholder={t('webchat.domainPlaceholder')}
                    addLabel={t('webchat.domainAdd')}
                    suggestions={suggested}
                    suggestionsLabel={t('webchat.domainsDetected')}
                    disabled={saving}
                  />
                </Field>
              </div>
            </Card>
          )}

          {/* ── ¿Cómo se ve? ── */}
          {seccion === 'apariencia' && (
            <Card>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label={t('webchat.brandName')}>
                  <Input
                    value={cfg.brand_name ?? ''}
                    onChange={(e) => setCfg({ ...cfg, brand_name: e.target.value })}
                    onBlur={(e) => save({ brand_name: e.target.value })}
                  />
                </Field>

                <Field label={t('webchat.color')}>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={cfg.primary_color ?? '#A3E635'}
                      onChange={(e) => setCfg({ ...cfg, primary_color: e.target.value })}
                      onBlur={(e) => save({ primary_color: e.target.value })}
                      className="h-9 w-12 cursor-pointer rounded-lg border border-border bg-transparent"
                    />
                    <span className="text-xs text-muted-foreground">{cfg.primary_color}</span>
                  </div>
                </Field>

                <Field label={t('webchat.avatar')}>
                  <ImagenDelChat
                    url={cfg.avatar_url || null}
                    fallback={(cfg.brand_name || 'R').slice(0, 2).toUpperCase()}
                    onChange={(url) => {
                      setCfg({ ...cfg, avatar_url: url });
                      save({ avatar_url: url });
                    }}
                  />
                </Field>

                <Field label={t('webchat.position')}>
                  <div className="flex gap-2">
                    {(['right', 'left'] as const).map((side) => (
                      <Button
                        key={side}
                        type="button"
                        size="sm"
                        variant={(cfg.position ?? 'right') === side ? 'default' : 'outline'}
                        onClick={() => save({ position: side })}
                      >
                        {side === 'right' ? t('webchat.positionRight') : t('webchat.positionLeft')}
                      </Button>
                    ))}
                  </div>
                </Field>
              </div>

              <div className="mt-3">
                <Field label={t('webchat.greeting')}>
                  <Input
                    value={cfg.greeting ?? ''}
                    placeholder={t('webchat.greetingPlaceholder')}
                    onChange={(e) => setCfg({ ...cfg, greeting: e.target.value })}
                    onBlur={(e) => save({ greeting: e.target.value })}
                  />
                </Field>
              </div>

              <div className="mt-3">
                <Field label={t('webchat.quickReplies')} hint={t('webchat.quickRepliesHint')}>
                  <ListaDeChips
                    values={cfg.quick_replies ?? []}
                    onChange={(next) => save({ quick_replies: next })}
                    placeholder={t('webchat.quickReplyPlaceholder')}
                    max={4}
                    maxLength={60}
                    disabled={saving}
                  />
                </Field>
              </div>
            </Card>
          )}

          {/* ── ¿Quién atiende y cómo? ── */}
          {seccion === 'comportamiento' && (
            <Card>
              {/* Con qué contesta, antes que quién atiende.
                  El chat no responde con lo que sabe un modelo: responde con la
                  ficha que el comercio cargó producto por producto. Ese hueco no
                  se veía en ninguna pantalla — el comercio miraba el chat andar y
                  se enteraba por una respuesta pobre a un cliente real. */}
              {saber ? (
                <div className="mb-4 border-b border-border pb-4">
                  <p className="text-xs font-medium text-muted-foreground">
                    {t('webchat.knowledge')}
                  </p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
                    <p className="text-sm text-foreground">
                      {saber.total === 0
                        ? t('webchat.knowledgeEmpty')
                        : t('webchat.knowledgeReady', {
                            done: String(saber.con_ficha),
                            total: String(saber.total),
                          })}
                    </p>
                    {saber.sin_ficha > 0 ? (
                      <Button
                        render={<Link href="/productos" />}
                        size="sm"
                        variant="outline"
                        className="ml-auto"
                      >
                        {t('webchat.knowledgeFill')}
                      </Button>
                    ) : null}
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {saber.total === 0
                      ? null
                      : saber.sin_ficha > 0
                        ? t('webchat.knowledgeGap', { n: String(saber.sin_ficha) })
                        : t('webchat.knowledgeAll')}
                    {saber.sin_ficha > 0 && saber.ejemplos.length > 0
                      ? ` ${saber.ejemplos.join(', ')}…`
                      : ''}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {t('webchat.knowledgePage')}
                  </p>
                </div>
              ) : null}

              <Field label={t('webchat.agent')}>
                <select
                  value={cfg.agent_id ?? ''}
                  onChange={(e) => save({ agent_id: e.target.value || null })}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
                >
                  <option value="">{t('webchat.agentAuto')}</option>
                  {agents.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                      {a.is_active ? '' : ` — ${t('webchat.agentPaused')}`}
                    </option>
                  ))}
                </select>
              </Field>

              <div className="mt-4 space-y-4 border-t border-border pt-4">
                <Toggle
                  label={t('webchat.requireEmail')}
                  hint={t('webchat.requireEmailHint')}
                  checked={Boolean(cfg.require_email)}
                  onChange={(c) => save({ require_email: c })}
                />
                <Toggle
                  label={t('webchat.uploads')}
                  checked={cfg.allow_uploads !== false}
                  onChange={(c) => save({ allow_uploads: c })}
                />
                <Toggle
                  label={t('webchat.askRating')}
                  hint={t('webchat.askRatingHint')}
                  checked={cfg.ask_rating !== false}
                  onChange={(c) => save({ ask_rating: c })}
                />
              </div>

              <div className="mt-4 border-t border-border pt-4">
                <Field label={t('webchat.offlineMessage')}>
                  <Input
                    value={cfg.offline_message ?? ''}
                    placeholder={t('webchat.offlinePlaceholder')}
                    onChange={(e) => setCfg({ ...cfg, offline_message: e.target.value })}
                    onBlur={(e) => save({ offline_message: e.target.value })}
                  />
                </Field>
              </div>
            </Card>
          )}

          {/* ── ¿Cuándo sale a buscar? ──
              Los tres disparadores apuntan al mismo lugar y el primero que
              llega gana: la invitación sale una vez por visita. Van juntos
              porque la pregunta del comercio es una sola. */}
          {seccion === 'invitacion' && (
            <Card>
              <Field
                label={t('webchat.proactiveMessage')}
                hint={t('webchat.proactiveMessageHint')}
              >
                <Input
                  value={cfg.proactive_message ?? ''}
                  maxLength={200}
                  placeholder={t('webchat.proactiveMessagePlaceholder')}
                  onChange={(e) => setCfg({ ...cfg, proactive_message: e.target.value })}
                  onBlur={(e) => save({ proactive_message: e.target.value })}
                />
              </Field>

              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <Field label={t('webchat.autoOpen')}>
                  <div className="flex flex-wrap gap-2">
                    {AUTO_OPEN.map((s) => (
                      <Button
                        key={s}
                        type="button"
                        size="sm"
                        variant={(cfg.auto_open_seconds ?? 0) === s ? 'default' : 'outline'}
                        onClick={() => save({ auto_open_seconds: s })}
                      >
                        {s === 0 ? t('webchat.autoOpenNever') : `${s}s`}
                      </Button>
                    ))}
                  </div>
                </Field>

                <Field label={t('webchat.proactiveScroll')}>
                  <div className="flex flex-wrap gap-2">
                    {SCROLL.map((p) => (
                      <Button
                        key={p}
                        type="button"
                        size="sm"
                        variant={(cfg.proactive_scroll_percent ?? 0) === p ? 'default' : 'outline'}
                        onClick={() => save({ proactive_scroll_percent: p })}
                      >
                        {p === 0 ? t('webchat.proactiveScrollNever') : `${p}%`}
                      </Button>
                    ))}
                  </div>
                </Field>
              </div>

              <div className="mt-4">
                <Toggle
                  label={t('webchat.proactiveExit')}
                  hint={t('webchat.proactiveExitHint')}
                  checked={cfg.proactive_on_exit === true}
                  onChange={(v) => save({ proactive_on_exit: v })}
                />
              </div>

              <div className="mt-4 border-t border-border pt-4">
                <Field label={t('webchat.proactiveUrls')} hint={t('webchat.proactiveUrlsHint')}>
                  <ListaDeChips
                    values={cfg.proactive_urls ?? []}
                    onChange={(next) => save({ proactive_urls: next })}
                    placeholder={t('webchat.proactiveUrlPlaceholder')}
                    maxLength={120}
                    disabled={saving}
                  />
                </Field>
              </div>
            </Card>
          )}
          </div>
        </div>

        <div className="lg:sticky lg:top-4 lg:h-fit">
          <VistaPrevia cfg={cfg} fallbackName={t('webchat.title')} />
        </div>
      </div>
    </div>
  );
}

function Card({ children }: { children: ReactNode }) {
  return <div className="rounded-xl border border-border bg-card p-4 shadow-sm">{children}</div>;
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-muted-foreground">{label}</label>
      {hint ? <p className="mt-0.5 mb-1.5 text-xs text-muted-foreground/80">{hint}</p> : null}
      <div className="mt-1">{children}</div>
    </div>
  );
}

/** Un interruptor con su nombre y, sólo si aporta algo, una línea de ayuda. */
function Toggle({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <p className="text-sm text-foreground">{label}</p>
        {hint ? <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p> : null}
      </div>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  );
}

function Stat({
  label,
  value,
  extra,
}: {
  label: string;
  value: string;
  /** Lo que no entra en un solo número: el resto de las monedas. */
  extra?: string[];
}) {
  return (
    <div className="rounded-lg border border-border bg-muted/40 p-3">
      <p className="text-lg font-semibold tabular-nums text-foreground">{value}</p>
      {(extra ?? []).map((e) => (
        <p key={e} className="text-xs font-medium tabular-nums text-muted-foreground">
          {e}
        </p>
      ))}
      <p className="mt-0.5 text-xs text-muted-foreground">{label}</p>
    </div>
  );
}
