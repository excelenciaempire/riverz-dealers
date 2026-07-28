'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from '@/components/i18n/locale-link';
import { toast } from 'sonner';
import {
  Loader2,
  Users,
  Tag,
  MessageCircle,
  CornerDownRight,
  ShoppingBag,
  Wand2,
  Radio,
  Save,
  Settings2,
  RotateCw,
  Trash2,
  Check,
  Receipt,
  Rocket,
  X,
  AlertTriangle,
} from 'lucide-react';
import { Button, buttonVariants } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetTitle,
} from '@/components/ui/sheet';
import { CommentToDmPanel } from '@/components/settings/comment-to-dm-panel';
import { useFetchWithCsrf } from '@/lib/api/fetch-with-csrf';
import { useLocalizedRouter } from '@/hooks/use-localized-router';
import { useT } from '@/hooks/use-locale';
import { useFormat } from '@/hooks/use-format';
import { cn } from '@/lib/utils';
import { toShortId } from '@/lib/short-id';
import type {
  InstagramPlan,
  CampaignStatus,
  CampaignMetrics,
} from '@/lib/instagram-agent/types';

export interface PlanContext {
  /** Full IG-sourced history — context, not a promise of reach. */
  instagram_reachable: number;
  /** Who can receive a message right now (both Meta windows open). */
  reachable_now?: number;
  /** Inside Meta's 24h DM window. */
  in_window_24h?: number;
  /** Commenters from the last 7 days (private reply). */
  comment_window_7d?: number;
  instagram_connected?: boolean;
  /** Agentes del workspace: cuál de sus voces escribe los DMs. */
  agents?: Array<{ id: string; name: string }>;
  default_agent_id?: string | null;
  currency: string;
  has_catalog: boolean;
  product_count?: number;
}

interface CampaignRow {
  id: string;
  name: string;
  status: CampaignStatus;
  offer_code: string | null;
  updated_at: string;
  /** Métricas reales acumuladas — la lista ya las devuelve. */
  metrics?: Partial<CampaignMetrics> | null;
}

interface AttributedOrder {
  shopify_order_id: string;
  order_name: string | null;
  source: string;
  revenue: number | null;
  currency: string | null;
  channel: string | null;
  created_at: string;
}

interface CampaignsResponse {
  campaigns?: CampaignRow[];
}

interface OrdersResponse {
  orders?: AttributedOrder[];
  total_revenue?: number;
  currency?: string;
}

const STATUS_LABEL: Record<CampaignStatus, string> = {
  draft: 'igAgent.statusDraft',
  active: 'igAgent.statusActive',
  paused: 'igAgent.statusPaused',
  done: 'igAgent.statusDone',
};

const ORDER_SOURCE_LABEL: Record<string, string> = {
  campaign: 'igAgent.orderSourceCampaign',
  agent: 'igAgent.orderSourceAgent',
  comment_to_dm: 'igAgent.orderSourceCommentToDm',
  ctwa: 'igAgent.orderSourceCtwa',
};

/** Chips de ejemplo: etiqueta corta visible, frase larga la que se escribe. */
const EXAMPLES: Array<[short: string, full: string]> = [
  ['igAgent.exampleShort1', 'igAgent.example1'],
  ['igAgent.exampleShort2', 'igAgent.example2'],
  ['igAgent.exampleShort3', 'igAgent.example3'],
  ['igAgent.exampleShort4', 'igAgent.example4'],
];

/** Reemplaza el token de nombre del plan por un nombre concreto. */
function fillName(text: string, name: string): string {
  return text.replace(/\{\{\s*(nombre|name|1)\s*\}\}/gi, name);
}

/** GET que nunca lanza: null si falla. Todo aquí es secundario a la página. */
async function getJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/* ────────────────────────────── datos ────────────────────────────── */

export interface IgOverview {
  context: PlanContext | null;
  campaigns: CampaignRow[];
  orders: AttributedOrder[];
  revenue: number;
  currency: string;
  reload: () => void;
  mergeContext: (patch: Partial<PlanContext>) => void;
  removeCampaign: (id: string) => void;
}

/**
 * Una sola carga para toda la página: contexto (alcance, conexión, catálogo),
 * campañas con sus métricas y los pedidos atribuidos. Antes cada bloque pedía
 * lo suyo por su cuenta y /context terminaba llamándose dos veces.
 */
export function useIgOverview(): IgOverview {
  const [context, setContext] = useState<PlanContext | null>(null);
  const [campaigns, setCampaigns] = useState<CampaignRow[]>([]);
  const [orders, setOrders] = useState<AttributedOrder[]>([]);
  const [revenue, setRevenue] = useState(0);
  const [currency, setCurrency] = useState('USD');

  const applyCampaigns = useCallback((json: CampaignsResponse | null) => {
    if (json) setCampaigns(json.campaigns ?? []);
  }, []);

  const applyOrders = useCallback((json: OrdersResponse | null) => {
    if (!json) return;
    setOrders(json.orders ?? []);
    setRevenue(Number(json.total_revenue) || 0);
    setCurrency(json.currency ?? 'USD');
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const [ctx, camps, ords] = await Promise.all([
        getJson<PlanContext>('/api/ai/instagram-agent/context'),
        getJson<CampaignsResponse>('/api/ai/instagram-agent/campaigns'),
        getJson<OrdersResponse>('/api/ai/instagram-agent/attributed-orders'),
      ]);
      if (cancelled) return;
      if (ctx) setContext(ctx);
      applyCampaigns(camps);
      applyOrders(ords);
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [applyCampaigns, applyOrders]);

  /** Lo que cambia al guardar o lanzar una campaña. */
  const reload = useCallback(() => {
    getJson<CampaignsResponse>('/api/ai/instagram-agent/campaigns').then(
      applyCampaigns,
    );
    getJson<OrdersResponse>('/api/ai/instagram-agent/attributed-orders').then(
      applyOrders,
    );
  }, [applyCampaigns, applyOrders]);

  const mergeContext = useCallback((patch: Partial<PlanContext>) => {
    setContext((prev) => ({ ...(prev ?? ({} as PlanContext)), ...patch }));
  }, []);

  const removeCampaign = useCallback((id: string) => {
    setCampaigns((prev) => prev.filter((c) => c.id !== id));
  }, []);

  return {
    context,
    campaigns,
    orders,
    revenue,
    currency,
    reload,
    mergeContext,
    removeCampaign,
  };
}

/* ──────────────────────────── encabezado ─────────────────────────── */

/** Estado de la conexión de Instagram: sin ella, nada de esto envía. */
export function ConnectionPill({ connected }: { connected?: boolean }) {
  const t = useT();
  if (connected === undefined) return null;
  if (connected) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-1 text-[11px] text-muted-foreground">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
        {t('igAgent.igConnected')}
      </span>
    );
  }
  return (
    <Link
      href="/integraciones"
      className="inline-flex items-center gap-1.5 rounded-full border border-destructive/40 bg-destructive/5 px-2.5 py-1 text-[11px] font-medium text-destructive transition-colors hover:bg-destructive/10"
    >
      <AlertTriangle className="h-3 w-3" />
      {t('igAgent.igNotConnected')}
    </Link>
  );
}

/**
 * Los tres controles del piloto automático —salir a buscar, tope diario y el
 * freno de emergencia— en un solo menú del encabezado. Antes ocupaban dos
 * tarjetas del ancho de la página para tres interruptores que se tocan una vez.
 */
export function AgentSettingsMenu({
  settings,
  showOutreach = true,
}: {
  settings: ProactiveSettings;
  /** En Comentarios el menú es solo los límites: salir a buscar no se decide
   *  desde aquí, y ofrecerlo en las dos páginas era prometer que la misma
   *  palanca hace dos cosas distintas. */
  showOutreach?: boolean;
}) {
  const t = useT();
  const label = showOutreach
    ? t('igAgent.settingsMenu')
    : t('igAgent.limitsMenu');
  return (
    <Popover>
      <PopoverTrigger
        aria-label={label}
        title={label}
        className={buttonVariants({
          variant: 'ghost',
          size: 'icon-sm',
          className: 'relative',
        })}
      >
        <Settings2 className="h-4 w-4" />
        {settings.paused && (
          <span className="absolute top-0.5 right-0.5 h-1.5 w-1.5 rounded-full bg-destructive" />
        )}
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={6} className="w-72 gap-0 p-0">
        <div
          className={cn(
            'divide-y divide-border',
            settings.loaded ? '' : 'pointer-events-none opacity-50',
          )}
        >
          {showOutreach && (
            <label className="flex items-start gap-3 p-3">
              <Switch
                checked={settings.outreach}
                onCheckedChange={(v) => {
                  settings.setOutreach(v);
                  settings.save({ outreach_enabled: v });
                }}
              />
              <span>
                <span className="block text-[13px] font-medium text-foreground">
                  {t('igAgent.outreachEnabled')}
                </span>
                <span className="mt-0.5 block text-[11px] leading-snug text-muted-foreground">
                  {t('igAgent.outreachEnabledHint')}
                </span>
              </span>
            </label>
          )}

          <label
            className="flex items-center justify-between gap-3 p-3"
            title={t('igAgent.controlsDailyCapHint')}
          >
            <span className="text-[13px] font-medium text-foreground">
              {t('igAgent.controlsDailyCap')}
            </span>
            <input
              type="number"
              min={0}
              max={10000}
              value={settings.cap}
              onChange={(e) => settings.setCap(Number(e.target.value))}
              onBlur={() => settings.save({ daily_cap: settings.cap })}
              className="w-20 rounded-md border border-border bg-background px-2 py-1 text-right text-[13px] tabular-nums text-foreground"
            />
          </label>

          <label
            className="flex items-center justify-between gap-3 p-3"
            title={t('igAgent.controlsPauseHint')}
          >
            <span
              className={cn(
                'text-[13px] font-medium',
                settings.paused ? 'text-destructive' : 'text-foreground',
              )}
            >
              {t('igAgent.controlsPause')}
            </span>
            <Switch
              checked={settings.paused}
              onCheckedChange={(v) => {
                settings.setPaused(v);
                settings.save({ paused: v });
              }}
            />
          </label>
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** Un freno de emergencia guardado en un menú tiene que avisar cuando está puesto. */
export function PausedBanner({ settings }: { settings: ProactiveSettings }) {
  const t = useT();
  if (!settings.paused) return null;
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-destructive/40 bg-destructive/5 px-4 py-2.5">
      <p className="flex items-center gap-2 text-[13px] font-medium text-destructive">
        <AlertTriangle className="h-4 w-4 shrink-0" />
        {t('igAgent.controlsPausedOn')}
      </p>
      <Button
        variant="outline"
        size="sm"
        onClick={() => {
          settings.setPaused(false);
          settings.save({ paused: false });
        }}
      >
        {t('igAgent.resume')}
      </Button>
    </div>
  );
}

/* ─────────────────────────── estadísticas ────────────────────────── */

/** Rejilla de cifras con hairlines a prueba de saltos de línea (gap-px). */
function StatGrid({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        'grid gap-px overflow-hidden rounded-2xl border border-border bg-border',
        className,
      )}
    >
      {children}
    </div>
  );
}

function StatCell({
  label,
  value,
  sub,
  lead,
  accent = false,
  compact = false,
  title,
}: {
  label: string;
  value: string;
  sub?: string;
  lead?: React.ReactNode;
  accent?: boolean;
  compact?: boolean;
  title?: string;
}) {
  return (
    <div
      className={cn('bg-card', compact ? 'px-3 py-2.5' : 'px-5 py-4')}
      title={title}
    >
      <p
        className={cn(
          'flex items-center gap-1.5 uppercase tracking-wide text-muted-foreground',
          compact ? 'text-[10px]' : 'text-[11px]',
        )}
      >
        {lead}
        {label}
      </p>
      <p
        className={cn(
          'tabular-nums',
          compact
            ? 'mt-1 text-base font-semibold'
            : 'mt-1.5 text-2xl font-medium',
          accent ? 'text-accent-ink' : 'text-foreground',
        )}
      >
        {value}
      </p>
      {!compact && (
        <p className="mt-0.5 text-[11px] text-muted-foreground">{sub ?? ' '}</p>
      )}
    </div>
  );
}

/**
 * Lo que la funcionalidad logró, arriba de todo: a cuánta gente se puede
 * escribir ahora mismo y qué salió de lo enviado. Las cifras 2–4 se suman de
 * `instagram_campaigns.metrics`, que la lista ya devolvía y la UI tiraba.
 */
export function IgStats({ overview }: { overview: IgOverview }) {
  const t = useT();
  const fmt = useFormat();
  const { context, campaigns, revenue, currency } = overview;

  const totals = useMemo(() => {
    let sent = 0;
    let replies = 0;
    let conversions = 0;
    for (const c of campaigns) {
      sent += Number(c.metrics?.contacted) || 0;
      replies += Number(c.metrics?.replies) || 0;
      conversions += Number(c.metrics?.conversions) || 0;
    }
    return { sent, replies, conversions };
  }, [campaigns]);

  const reachable = context?.reachable_now ?? 0;
  const replyRate =
    totals.sent > 0 ? Math.round((totals.replies / totals.sent) * 100) : 0;

  return (
    <StatGrid className="grid-cols-2 shadow-sm sm:grid-cols-4">
      <StatCell
        label={t('igAgent.reachableNow')}
        value={fmt.number(reachable)}
        title={t('igAgent.reachHint', {
          dm: fmt.number(context?.in_window_24h ?? 0),
          comments: fmt.number(context?.comment_window_7d ?? 0),
          total: fmt.number(context?.instagram_reachable ?? 0),
        })}
        lead={
          <span className="relative flex h-1.5 w-1.5">
            {reachable > 0 && (
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500/60" />
            )}
            <span
              className={cn(
                'relative inline-flex h-1.5 w-1.5 rounded-full',
                reachable > 0 ? 'bg-emerald-500' : 'bg-muted-foreground/40',
              )}
            />
          </span>
        }
      />
      <StatCell label={t('igAgent.sent')} value={fmt.number(totals.sent)} />
      <StatCell
        label={t('igAgent.replies')}
        value={fmt.number(totals.replies)}
        sub={
          totals.sent > 0
            ? t('igAgent.statReplyRate', { n: replyRate })
            : undefined
        }
      />
      <StatCell
        label={t('igAgent.statRevenue')}
        value={fmt.currency(revenue, currency)}
        accent
        sub={
          totals.conversions > 0
            ? t(
                totals.conversions === 1
                  ? 'igAgent.salesCountOne'
                  : 'igAgent.salesCountOther',
                { n: fmt.number(totals.conversions) },
              )
            : undefined
        }
      />
    </StatGrid>
  );
}

/* ──────────────────────── objetivo → plan ────────────────────────── */

export function OutreachSection({ overview }: { overview: IgOverview }) {
  const fetchWithCsrf = useFetchWithCsrf();
  const router = useLocalizedRouter();
  const t = useT();
  const [goal, setGoal] = useState('');
  const [loading, setLoading] = useState(false);
  const [plan, setPlan] = useState<InstagramPlan | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [saving, setSaving] = useState<'draft' | 'launch' | null>(null);
  // Grupo de control fijo: 10% de la audiencia no recibe DM, para poder medir
  // qué habría pasado sin el agente. Es estadística, no una decisión que el
  // comercio deba tomar, así que no se pregunta.
  const holdoutPct = 10;
  const { context, campaigns, reload, mergeContext, removeCampaign } = overview;

  /** Persiste el plan como campaña. Devuelve el id, o null si falló. */
  async function saveCampaign(): Promise<string | null> {
    if (!plan) return null;
    const res = await fetchWithCsrf('/api/ai/instagram-agent/campaigns', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        goal: goal.trim(),
        plan,
        holdout_pct: holdoutPct,
      }),
    });
    const json = await res.json();
    if (!res.ok) {
      toast.error(json.error ?? t('igAgent.errorSaveCampaign'));
      return null;
    }
    return json.id as string;
  }

  async function saveDraft() {
    setSaving('draft');
    try {
      const id = await saveCampaign();
      if (id) {
        toast.success(t('igAgent.toastCampaignSaved'));
        setSheetOpen(false);
        setPlan(null);
        setGoal('');
        reload();
      }
    } catch {
      toast.error(t('igAgent.errorNetwork'));
    } finally {
      setSaving(null);
    }
  }

  // Guardar y lanzar en un paso: antes había que guardar, buscar la campaña en
  // la lista y entrar al detalle para encontrar el botón de lanzar.
  async function saveAndLaunch() {
    setSaving('launch');
    try {
      const id = await saveCampaign();
      if (!id) return;
      const res = await fetchWithCsrf(
        `/api/ai/instagram-agent/campaigns/${id}/launch`,
        { method: 'POST' },
      );
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(json.error ?? t('igAgent.errorActionFailed'));
        reload();
        router.push(`/agente-instagram/${toShortId(id)}`);
        return;
      }
      toast.success(t('igAgent.toastCampaignLaunched'));
      router.push(`/agente-instagram/${toShortId(id)}`);
    } catch {
      toast.error(t('igAgent.errorNetwork'));
    } finally {
      setSaving(null);
    }
  }

  async function deleteCampaign(id: string) {
    try {
      const res = await fetchWithCsrf(
        `/api/ai/instagram-agent/campaigns/${id}`,
        { method: 'DELETE' },
      );
      if (!res.ok) {
        toast.error(t('igAgent.errorDelete'));
        return;
      }
      removeCampaign(id);
    } catch {
      toast.error(t('igAgent.errorNetwork'));
    }
  }

  /**
   * El panel se abre ANTES de la llamada: pulsar el botón responde al instante
   * y el agente se ve trabajando en la superficie donde después se decide.
   */
  async function generate() {
    const trimmed = goal.trim();
    if (!trimmed) {
      toast.error(t('igAgent.errorDescribeGoal'));
      return;
    }
    setPlan(null);
    setLoading(true);
    setSheetOpen(true);
    try {
      const res = await fetchWithCsrf('/api/ai/instagram-agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ goal: trimmed }),
      });
      const json = await res.json();
      if (!res.ok) {
        toast.error(json.error ?? t('igAgent.errorGeneratePlan'));
        setSheetOpen(false);
        return;
      }
      setPlan(json.plan as InstagramPlan);
      mergeContext(json.context as Partial<PlanContext>);
      // Si lo cerraron a mitad de la generación, se reabre: una llamada al
      // modelo ya pagada no se tira.
      setSheetOpen(true);
    } catch {
      toast.error(t('igAgent.errorNetwork'));
      setSheetOpen(false);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="space-y-2.5">
        <div className="rounded-2xl border border-border bg-card shadow-sm transition-colors focus-within:border-accent-ink/40">
          <div className="p-5">
            <Textarea
              id="goal"
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              rows={2}
              maxLength={2000}
              placeholder={t('igAgent.goalLabel')}
              className="resize-none border-0 bg-transparent px-0 text-[15px] leading-relaxed shadow-none focus-visible:ring-0 dark:bg-transparent"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  if (!loading) generate();
                }
              }}
            />

            <div className="mt-3 flex justify-end">
              <Button
                size="lg"
                onClick={generate}
                disabled={loading || !goal.trim()}
              >
                {loading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    {t('igAgent.designing')}
                  </>
                ) : (
                  <>
                    <Wand2 className="h-4 w-4" />
                    {t('igAgent.generatePlan')}
                  </>
                )}
              </Button>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap gap-1.5">
          {EXAMPLES.map(([short, full]) => (
            <button
              key={short}
              type="button"
              onClick={() => setGoal(t(full))}
              className="rounded-full border border-border bg-card px-3 py-1 text-[12px] text-muted-foreground transition-colors hover:border-accent-ink/40 hover:text-foreground"
            >
              {t(short)}
            </button>
          ))}
        </div>
      </div>

      <PlanSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        loading={loading}
        plan={plan}
        context={context}
        saving={saving}
        onRegenerate={generate}
        onSaveDraft={saveDraft}
        onSaveAndLaunch={saveAndLaunch}
      />

      <CampaignsSection campaigns={campaigns} onDelete={deleteCampaign} />
    </div>
  );
}

/**
 * El plan, en su propia superficie: se abre trabajando, se lee de arriba abajo
 * y las dos decisiones —guardar o lanzar— viven fijas al pie, siempre visibles.
 * Antes se apilaba en la página y la acción quedaba enterrada tras un scroll.
 */
function PlanSheet({
  open,
  onOpenChange,
  loading,
  plan,
  context,
  saving,
  onRegenerate,
  onSaveDraft,
  onSaveAndLaunch,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  loading: boolean;
  plan: InstagramPlan | null;
  context: PlanContext | null;
  saving: 'draft' | 'launch' | null;
  onRegenerate: () => void;
  onSaveDraft: () => void;
  onSaveAndLaunch: () => void;
}) {
  const t = useT();
  const busy = saving !== null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        showCloseButton={false}
        className="gap-0 p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-xl"
      >
        <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-border bg-popover px-5 py-3">
          <SheetTitle className="min-w-0 flex-1 truncate">
            {plan ? plan.campaign_name : t('igAgent.proposedCampaign')}
          </SheetTitle>
          {plan && !loading && (
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={onRegenerate}
              disabled={busy}
              aria-label={t('igAgent.regeneratePlan')}
              title={t('igAgent.regeneratePlan')}
            >
              <RotateCw className="h-4 w-4" />
            </Button>
          )}
          <SheetClose
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={t('igAgent.cancel')}
              />
            }
          >
            <X className="h-4 w-4" />
          </SheetClose>
        </div>

        <div className="flex-1 px-5 py-4">
          {loading || !plan ? (
            <AgentThinking
              audience={context?.reachable_now ?? context?.instagram_reachable}
              productCount={context?.product_count}
            />
          ) : (
            <PlanBody plan={plan} />
          )}
        </div>

        {plan && !loading && (
          <div className="sticky bottom-0 flex items-center justify-end gap-2 border-t border-border bg-popover px-5 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
            <Button variant="outline" onClick={onSaveDraft} disabled={busy}>
              {saving === 'draft' ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Save className="h-4 w-4" />
              )}
              {t('igAgent.saveDraft')}
            </Button>
            <Button onClick={onSaveAndLaunch} disabled={busy}>
              {saving === 'launch' ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Rocket className="h-4 w-4" />
              )}
              {t('igAgent.saveAndLaunch')}
            </Button>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

function PlanBody({ plan }: { plan: InstagramPlan }) {
  const t = useT();
  const fmt = useFormat();
  const messagePreview = fillName(plan.message.text, plan.message.preview_name);

  return (
    <div className="space-y-5">
      {/* Audiencia + embudo estimado */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0 space-y-1">
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Users className="h-3.5 w-3.5 shrink-0" />
              {plan.audience.description}
            </p>
            <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <Radio className="h-3.5 w-3.5 shrink-0 text-accent-ink" />
              <span>
                <span className="font-medium text-foreground">
                  {t('igAgent.engagementLabel')}
                </span>{' '}
                {plan.audience.source}
              </span>
            </p>
          </div>
          <Badge variant="secondary" className="shrink-0">
            <Users className="mr-1 h-3 w-3" />
            {t('igAgent.contactsCount', {
              n: fmt.number(plan.audience.estimated_reach),
            })}
          </Badge>
        </div>

        <StatGrid className="grid-cols-2 sm:grid-cols-4">
          <StatCell
            compact
            label={t('igAgent.funnelContacted')}
            value={fmt.number(plan.funnel.contacted)}
          />
          <StatCell
            compact
            label={t('igAgent.funnelReplies')}
            value={fmt.number(plan.funnel.replies)}
          />
          <StatCell
            compact
            label={t('igAgent.funnelConversions')}
            value={fmt.number(plan.funnel.conversions)}
          />
          <StatCell
            compact
            accent
            label={t('igAgent.funnelEstRevenue')}
            value={plan.funnel.est_revenue}
          />
        </StatGrid>
        <p className="text-[10px] text-muted-foreground">
          {t('igAgent.estimatesDisclaimer')}
        </p>
      </div>

      {/* Vista previa del DM */}
      <div className="space-y-2">
        <p className="text-sm font-medium text-foreground">
          {t('igAgent.instagramDm')}
        </p>
        {/* Cabecera de chat para que la vista previa se lea como una
            conversación real, en la paleta de la casa. */}
        <div className="rounded-xl border border-border bg-muted/40 p-3">
          <div className="mb-2.5 flex items-center gap-2 border-b border-border pb-2.5">
            <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-accent text-[11px] font-semibold text-accent-ink">
              {plan.message.preview_name.slice(0, 1).toUpperCase()}
            </span>
            <p className="truncate text-xs font-medium text-foreground">
              {plan.message.preview_name}
            </p>
          </div>
          <div className="ml-auto max-w-[85%] rounded-2xl rounded-br-md bg-primary px-3 py-2 text-[13px] leading-relaxed whitespace-pre-wrap text-primary-foreground">
            {messagePreview}
          </div>
          {plan.offer && (
            <div className="ml-auto mt-1.5 max-w-[85%] rounded-2xl rounded-br-md bg-primary px-3 py-2 text-[13px] text-primary-foreground">
              🎁 {t('igAgent.offerCodeLabel')}{' '}
              <span className="font-semibold">{plan.offer.code}</span> —{' '}
              {plan.offer.discount}
            </div>
          )}
        </div>
      </div>

      <PlanNote
        icon={<CornerDownRight className="h-3.5 w-3.5 text-muted-foreground" />}
        label={t('igAgent.followUpIfNoReply')}
        text={fillName(plan.follow_up, plan.message.preview_name)}
      />

      {plan.comment_reply && (
        <PlanNote
          icon={<MessageCircle className="h-3.5 w-3.5 text-muted-foreground" />}
          label={t('igAgent.highIntentCommentReply')}
          text={plan.comment_reply}
        />
      )}

      {plan.offer && (
        <div className="space-y-2">
          <p className="flex items-center gap-1.5 text-sm font-medium text-foreground">
            <Tag className="h-4 w-4 text-accent-ink" />
            {t('igAgent.offer')}
          </p>
          <div className="flex items-baseline gap-2">
            <span className="rounded-md border border-dashed border-accent-ink/40 bg-accent/40 px-2 py-1 font-mono text-sm font-semibold text-accent-ink">
              {plan.offer.code}
            </span>
            <span className="text-sm font-medium text-foreground">
              {plan.offer.discount}
            </span>
          </div>
          {plan.offer.conditions && (
            <p className="text-xs text-muted-foreground">
              {plan.offer.conditions}
            </p>
          )}
        </div>
      )}

      {plan.recommended_products.length > 0 && (
        <div className="space-y-2">
          <p className="flex items-center gap-1.5 text-sm font-medium text-foreground">
            <ShoppingBag className="h-4 w-4 text-accent-ink" />
            {t('igAgent.productsToFeature')}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {plan.recommended_products.map((p, i) => (
              <Badge key={i} variant="outline">
                {p}
              </Badge>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function PlanNote({
  icon,
  label,
  text,
}: {
  icon: React.ReactNode;
  label: string;
  text: string;
}) {
  return (
    <div className="space-y-1.5">
      <p className="flex items-center gap-1.5 text-xs font-medium text-foreground">
        {icon}
        {label}
      </p>
      <p className="rounded-lg border border-dashed border-border bg-muted/40 px-3 py-2 text-[13px] whitespace-pre-wrap text-muted-foreground">
        {text}
      </p>
    </div>
  );
}

/**
 * Live "agent thinking" panel. While the plan is generating, it walks through
 * believable status steps (grounded in the real audience + catalog numbers)
 * with spinner → check transitions, so the wait reads as the agent actually
 * scanning and working.
 */
function AgentThinking({
  audience,
  productCount,
}: {
  audience?: number;
  productCount?: number;
}) {
  const t = useT();
  const fmt = useFormat();
  const steps = useMemo(
    () => [
      t('igAgent.thinkingUnderstandGoal'),
      productCount
        ? t('igAgent.thinkingReviewCatalogCount', { n: productCount })
        : t('igAgent.thinkingReviewCatalog'),
      audience
        ? t('igAgent.thinkingScanAudienceCount', {
            n: fmt.number(audience),
          })
        : t('igAgent.thinkingScanAudience'),
      t('igAgent.thinkingDetectIntent'),
      t('igAgent.thinkingFilterComments'),
      t('igAgent.thinkingDraftDm'),
      t('igAgent.thinkingComputeFunnel'),
    ],
    [audience, productCount, t, fmt],
  );
  const [active, setActive] = useState(0);
  useEffect(() => {
    if (active >= steps.length - 1) return;
    const timer = setTimeout(
      () => setActive((a) => Math.min(a + 1, steps.length - 1)),
      850,
    );
    return () => clearTimeout(timer);
  }, [active, steps.length]);

  return (
    <div>
      <p className="app-eyebrow flex items-center gap-1.5">
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent-ink/50" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-accent-ink" />
        </span>
        {t('igAgent.agentWorking')}
      </p>
      <ul className="mt-3 space-y-2">
        {steps.map((s, i) => (
          <li
            key={i}
            className={cn(
              'flex items-center gap-2 text-sm transition-colors',
              i <= active ? 'text-foreground' : 'text-muted-foreground/40',
            )}
          >
            {i < active ? (
              <Check className="h-4 w-4 shrink-0 text-emerald-500" />
            ) : i === active ? (
              <Loader2 className="h-4 w-4 shrink-0 animate-spin text-accent-ink" />
            ) : (
              <span className="h-4 w-4 shrink-0 rounded-full border border-muted-foreground/30" />
            )}
            {s}
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ───────────────────────────── campañas ──────────────────────────── */

/** Lista de campañas guardadas, cada una con lo que realmente logró. */
function CampaignsSection({
  campaigns,
  onDelete,
}: {
  campaigns: CampaignRow[];
  onDelete: (id: string) => void;
}) {
  const t = useT();
  const fmt = useFormat();
  const [confirming, setConfirming] = useState<string | null>(null);

  return (
    <section className="space-y-3">
      <div className="app-section-head">
        <h2 className="flex items-center gap-1.5 text-sm font-medium text-foreground">
          <Radio className="h-4 w-4 text-muted-foreground" />
          {t('igAgent.myCampaigns')}
        </h2>
      </div>

      {campaigns.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">
          {t('igAgent.noCampaignsYet')}
        </p>
      ) : (
        <ul className="space-y-2">
          {campaigns.map((c) => (
            <li
              key={c.id}
              className="group relative overflow-hidden rounded-2xl border border-border bg-card p-4 pl-5 shadow-sm transition-colors hover:border-accent-ink/40"
            >
              {/* Filo lima: de un vistazo se ve cuál está trabajando ahora. */}
              {c.status === 'active' && (
                <span className="absolute inset-y-0 left-0 w-[3px] bg-primary" />
              )}

              <div className="flex items-start justify-between gap-3">
                <Link
                  href={`/agente-instagram/${toShortId(c.id)}`}
                  className="min-w-0 flex-1"
                >
                  <p className="truncate text-sm font-medium text-foreground transition-colors group-hover:text-accent-ink">
                    {c.name}
                  </p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    {c.offer_code
                      ? `${t('igAgent.codePrefix', { code: c.offer_code })} · `
                      : ''}
                    {fmt.date(c.updated_at, {
                      day: 'numeric',
                      month: 'numeric',
                      year: 'numeric',
                    })}
                  </p>
                </Link>

                <div className="flex shrink-0 items-center gap-1">
                  <Badge
                    variant={
                      c.status === 'active'
                        ? 'default'
                        : c.status === 'paused'
                          ? 'outline'
                          : 'secondary'
                    }
                  >
                    {t(STATUS_LABEL[c.status])}
                  </Badge>

                  {confirming === c.id ? (
                    <span className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setConfirming(null)}
                      >
                        {t('igAgent.cancel')}
                      </Button>
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => {
                          setConfirming(null);
                          onDelete(c.id);
                        }}
                      >
                        {t('igAgent.confirmDelete')}
                      </Button>
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirming(c.id)}
                      aria-label={t('igAgent.deleteCampaign')}
                      className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-all hover:bg-destructive/10 hover:text-destructive focus-visible:opacity-100 group-hover:opacity-100"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
              </div>

              <CampaignResults metrics={c.metrics} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * Lo que logró una campaña, dentro de su propia tarjeta: el embudo como una
 * barra y las tres cifras debajo. Un solo tono —el lima de la casa en tres
 * intensidades— en vez de un color por etapa: el embudo es una sola cosa que
 * se estrecha, no tres cosas distintas.
 */
function CampaignResults({
  metrics,
}: {
  metrics?: Partial<CampaignMetrics> | null;
}) {
  const t = useT();
  const fmt = useFormat();
  const sent = Number(metrics?.contacted) || 0;
  const replies = Number(metrics?.replies) || 0;
  const conversions = Number(metrics?.conversions) || 0;
  const revenue = Number(metrics?.revenue) || 0;
  if (sent === 0 && replies === 0 && revenue === 0) return null;

  /** Ancho relativo al total contactado; 0 no dibuja nada. */
  const width = (n: number) =>
    sent > 0 && n > 0 ? `${Math.max(3, Math.round((n / sent) * 100))}%` : '0%';

  return (
    <div className="mt-3 space-y-2">
      <div className="relative h-1.5 overflow-hidden rounded-full bg-muted">
        <div className="absolute inset-y-0 left-0 w-full bg-accent-ink/25" />
        <div
          className="absolute inset-y-0 left-0 bg-accent-ink/60 transition-all duration-500"
          style={{ width: width(replies) }}
        />
        <div
          className="absolute inset-y-0 left-0 bg-accent-ink transition-all duration-500"
          style={{ width: width(conversions) }}
        />
      </div>

      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-0.5 text-[11px] text-muted-foreground">
        <ResultStat n={fmt.number(sent)} label={t('igAgent.sent')} />
        <ResultStat n={fmt.number(replies)} label={t('igAgent.replies')} />
        <ResultStat
          n={fmt.number(conversions)}
          label={t('igAgent.conversions')}
        />
        {revenue > 0 && (
          <span className="ml-auto font-semibold tabular-nums text-accent-ink">
            {fmt.currency(revenue, metrics?.currency ?? 'USD')}
          </span>
        )}
      </div>
    </div>
  );
}

function ResultStat({ n, label }: { n: string; label: string }) {
  return (
    <span className="inline-flex items-baseline gap-1">
      <span className="font-semibold tabular-nums text-foreground">{n}</span>
      <span className="lowercase">{label}</span>
    </span>
  );
}

/**
 * Order-attribution ledger (migration 094): los pedidos que ocurrieron gracias
 * al motor de Instagram. El total ya vive en las estadísticas de arriba, así
 * que aquí solo queda la evidencia. Oculto si está vacío.
 */
export function AttributedOrders({ overview }: { overview: IgOverview }) {
  const t = useT();
  const fmt = useFormat();
  const { orders, currency } = overview;
  if (orders.length === 0) return null;

  return (
    <section className="space-y-3">
      <div className="app-section-head">
        <h2 className="flex items-center gap-1.5 text-sm font-medium text-foreground">
          <Receipt className="h-4 w-4 text-muted-foreground" />
          {t('igAgent.attributedOrdersTitle')}
        </h2>
      </div>
      <ul className="divide-y divide-border rounded-2xl border border-border bg-card px-5 shadow-sm">
        {orders.slice(0, 5).map((o) => (
          <li
            key={o.shopify_order_id}
            className="flex items-center justify-between gap-3 py-2.5"
          >
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-foreground">
                {o.order_name
                  ? t('igAgent.orderLabelName', { name: o.order_name })
                  : o.shopify_order_id}
              </p>
              <p className="text-[11px] text-muted-foreground">
                {t(ORDER_SOURCE_LABEL[o.source] ?? 'igAgent.orderSourceAgent')} ·{' '}
                {fmt.date(o.created_at, { day: 'numeric', month: 'numeric' })}
              </p>
            </div>
            {o.revenue != null && (
              <span className="shrink-0 text-sm font-semibold tabular-nums text-accent-ink">
                {fmt.currency(o.revenue, o.currency ?? currency)}
              </span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

/* ──────────────────── ajustes proactivos (compartidos) ───────────── */

/**
 * Ajustes proactivos: una sola carga, una sola escritura. Los consume el menú
 * del encabezado en Ventas por Instagram y la tarjeta de Límites en Comentarios.
 */
export interface ProactiveSettings {
  loaded: boolean;
  paused: boolean;
  autoReply: boolean;
  outreach: boolean;
  cap: number;
  setPaused: (v: boolean) => void;
  setAutoReply: (v: boolean) => void;
  setOutreach: (v: boolean) => void;
  setCap: (v: number) => void;
  save: (next: {
    paused?: boolean;
    daily_cap?: number;
    auto_reply_comments?: boolean;
    outreach_enabled?: boolean;
  }) => void;
}

export function useProactiveSettings(): ProactiveSettings {
  const fetchWithCsrf = useFetchWithCsrf();
  const [paused, setPaused] = useState(false);
  const [autoReply, setAutoReply] = useState(true);
  const [outreach, setOutreach] = useState(true);
  const [cap, setCap] = useState(500);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/ai/instagram-agent/settings', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!cancelled && j) {
          setPaused(!!j.paused);
          setAutoReply(j.auto_reply_comments !== false);
          setOutreach(j.outreach_enabled !== false);
          setCap(Number(j.daily_cap) || 500);
          setLoaded(true);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const save = useCallback(
    (next: {
      paused?: boolean;
      daily_cap?: number;
      auto_reply_comments?: boolean;
      outreach_enabled?: boolean;
    }) => {
      void fetchWithCsrf('/api/ai/instagram-agent/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(next),
      }).catch(() => {});
    },
    [fetchWithCsrf],
  );

  return {
    loaded,
    paused,
    autoReply,
    outreach,
    cap,
    setPaused,
    setAutoReply,
    setOutreach,
    setCap,
    save,
  };
}

/**
 * El piso autónomo: lo que pasa con un comentario cuando ninguna regla lo
 * atiende. Es la conducta por defecto de la página, así que va primero y sin
 * caja: una caja lo habría dejado al mismo nivel que una regla cualquiera.
 */
export function CommentAutoReply({ settings }: { settings: ProactiveSettings }) {
  const t = useT();
  return (
    <label
      className={cn(
        'flex items-start justify-between gap-6 transition-opacity',
        settings.loaded ? '' : 'pointer-events-none opacity-50',
      )}
    >
      <span>
        <span className="block text-[15px] font-medium text-foreground">
          {t('igAgent.autoReplyComments')}
        </span>
        <span className="mt-1 block max-w-md text-[13px] leading-relaxed text-muted-foreground">
          {t('igAgent.autoReplyCommentsHint')}
        </span>
      </span>
      <Switch
        className="mt-1 shrink-0"
        checked={settings.autoReply}
        onCheckedChange={(v) => {
          settings.setAutoReply(v);
          settings.save({ auto_reply_comments: v });
        }}
      />
    </label>
  );
}

/**
 * Qué pasa cuando alguien comenta: solo dos cosas pueden atenderlo, y en este
 * orden —la regla que escribiste tú, y si ninguna encaja, la IA—. Se muestran
 * en ese mismo orden invertido a propósito: arriba la conducta por defecto
 * (siempre activa), abajo las excepciones, que es como se lee un contrato.
 *
 * El tope diario y el freno de emergencia se fueron al menú del encabezado:
 * son los mismos de Ventas por Instagram, se tocan una vez y ocupaban una
 * tarjeta del ancho de la página.
 */
export function CommentsSection({ settings }: { settings: ProactiveSettings }) {
  return (
    <div className="space-y-10">
      <CommentAutoReply settings={settings} />
      <CommentToDmPanel />
    </div>
  );
}

/** ¿Instagram está conectado? Lo único que la cabecera necesita saber. */
export function useIgConnected(): boolean | undefined {
  const [connected, setConnected] = useState<boolean | undefined>(undefined);
  useEffect(() => {
    let cancelled = false;
    fetch('/api/ai/instagram-agent/context', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!cancelled && j) setConnected(!!j.instagram_connected);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);
  return connected;
}
