'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
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
  Sparkles,
  BrainCircuit,
  Download,
  Lightbulb,
  MessageSquareText,
  Target,
  TrendingUp,
} from 'lucide-react';
import { Button, buttonVariants } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
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
  /** Personas con el perfil ya investigado — lo que hace que el DM sea 1:1. */
  researched?: number;
  /** Dieron permiso de Marketing Messages: contactables sin ventana que venza. */
  subscribers?: number;
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
        getJson<OrdersResponse>(
          '/api/ai/instagram-agent/attributed-orders?source=campaign'
        ),
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
      applyCampaigns
    );
    getJson<OrdersResponse>(
      '/api/ai/instagram-agent/attributed-orders?source=campaign'
    ).then(applyOrders);
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
      <span className="border-border bg-card text-muted-foreground inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px]">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
        {t('igAgent.igConnected')}
      </span>
    );
  }
  return (
    <Link
      href="/integraciones"
      className="border-destructive/40 bg-destructive/5 text-destructive hover:bg-destructive/10 inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors"
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
}: {
  settings: ProactiveSettings;
}) {
  const t = useT();
  const label = t('igAgent.settingsMenu');
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
          <span className="bg-destructive absolute top-0.5 right-0.5 h-1.5 w-1.5 rounded-full" />
        )}
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={6} className="w-72 gap-0 p-0">
        <div
          className={cn(
            'divide-border divide-y',
            settings.loaded ? '' : 'pointer-events-none opacity-50'
          )}
        >
          <label className="flex items-start gap-3 p-3">
            <Switch
              checked={settings.outreach}
              onCheckedChange={(v) => {
                settings.setOutreach(v);
                settings.save({ outreach_enabled: v });
              }}
            />
            <span>
              <span className="text-foreground block text-[13px] font-medium">
                {t('igAgent.outreachEnabled')}
              </span>
              <span className="text-muted-foreground mt-0.5 block text-[11px] leading-snug">
                {t('igAgent.outreachEnabledHint')}
              </span>
            </span>
          </label>

          {/* Lo que hace crecer la lista: mientras el agente ya está
              conversando, le pregunta a la persona si quiere recibir
              novedades. Quien acepta queda contactable siempre, sin depender
              de la ventana de 24 h. */}
          <label className="flex items-start gap-3 p-3">
            <Switch
              checked={settings.marketingOptin}
              onCheckedChange={(v) => {
                settings.setMarketingOptin(v);
                settings.save({ marketing_optin_enabled: v });
              }}
            />
            <span>
              <span className="text-foreground block text-[13px] font-medium">
                {t('igAgent.marketingOptin')}
              </span>
              <span className="text-muted-foreground mt-0.5 block text-[11px] leading-snug">
                {t('igAgent.marketingOptinHint')}
              </span>
            </span>
          </label>

          <label
            className="flex items-center justify-between gap-3 p-3"
            title={t('igAgent.controlsDailyCapHint')}
          >
            <span className="text-foreground text-[13px] font-medium">
              {t('igAgent.controlsDailyCap')}
            </span>
            <input
              type="number"
              min={0}
              max={10000}
              value={settings.cap}
              onChange={(e) => settings.setCap(Number(e.target.value))}
              onBlur={() => settings.save({ daily_cap: settings.cap })}
              className="border-border bg-background text-foreground w-20 rounded-md border px-2 py-1 text-right text-[13px] tabular-nums"
            />
          </label>

          <label
            className="flex items-center justify-between gap-3 p-3"
            title={t('igAgent.controlsPauseHint')}
          >
            <span
              className={cn(
                'text-[13px] font-medium',
                settings.paused ? 'text-destructive' : 'text-foreground'
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
    <div className="border-destructive/40 bg-destructive/5 flex flex-wrap items-center justify-between gap-3 rounded-xl border px-4 py-2.5">
      <p className="text-destructive flex items-center gap-2 text-[13px] font-medium">
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
        'border-border bg-border grid gap-px overflow-hidden rounded-2xl border',
        className
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
          'text-muted-foreground flex items-center gap-1.5 tracking-wide uppercase',
          compact ? 'text-[10px]' : 'text-[11px]'
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
          accent ? 'text-accent-ink' : 'text-foreground'
        )}
      >
        {value}
      </p>
      {!compact && (
        <p className="text-muted-foreground mt-0.5 text-[11px]">{sub ?? ' '}</p>
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

  // Suscriptores: los que dieron permiso para recibir novedades. Suman al
  // alcance porque a ellos se les puede escribir SIEMPRE — no dependen de
  // haber comentado esta semana, que es lo que hacía que este número
  // dependiera de si la marca publicó algo o no.
  const subscribers = context?.subscribers ?? 0;
  const reachable = (context?.reachable_now ?? 0) + subscribers;
  const replyRate =
    totals.sent > 0 ? Math.round((totals.replies / totals.sent) * 100) : 0;

  return (
    <StatGrid className="grid-cols-2 shadow-sm sm:grid-cols-4">
      <StatCell
        label={t('igAgent.reachableNow')}
        value={fmt.number(reachable)}
        // Cuántos de ellos llevan el perfil investigado: es la diferencia entre
        // un DM 1:1 y uno con el nombre puesto, y sin esto no se veía en ningún
        // lado si ese trabajo estaba pasando.
        sub={
          subscribers > 0
            ? t('igAgent.subscribersSub', { n: fmt.number(subscribers) })
            : context?.researched
              ? t('igAgent.researchedSub', {
                  n: fmt.number(context.researched),
                })
              : undefined
        }
        title={t('igAgent.reachHint', {
          dm: fmt.number(context?.in_window_24h ?? 0),
          comments: fmt.number(context?.comment_window_7d ?? 0),
          subs: fmt.number(subscribers),
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
                reachable > 0 ? 'bg-emerald-500' : 'bg-muted-foreground/40'
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
                { n: fmt.number(totals.conversions) }
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
        { method: 'POST' }
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
        { method: 'DELETE' }
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
        <div className="border-border bg-card focus-within:border-accent-ink/40 rounded-2xl border shadow-sm transition-colors">
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
              className="border-border bg-card text-muted-foreground hover:border-accent-ink/40 hover:text-foreground rounded-full border px-3 py-1 text-[12px] transition-colors"
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
        <div className="border-border bg-popover sticky top-0 z-10 flex items-center gap-2 border-b px-5 py-3">
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
          <div className="border-border bg-popover sticky bottom-0 flex items-center justify-end gap-2 border-t px-5 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
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
            <p className="text-muted-foreground flex items-center gap-1.5 text-xs">
              <Users className="h-3.5 w-3.5 shrink-0" />
              {plan.audience.description}
            </p>
            <p className="text-muted-foreground flex items-center gap-1.5 text-[11px]">
              <Radio className="text-accent-ink h-3.5 w-3.5 shrink-0" />
              <span>
                <span className="text-foreground font-medium">
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
        <p className="text-muted-foreground text-[10px]">
          {t('igAgent.estimatesDisclaimer')}
        </p>
      </div>

      {/* Vista previa del DM */}
      <div className="space-y-2">
        <p className="text-foreground text-sm font-medium">
          {t('igAgent.instagramDm')}
        </p>
        {/* Cabecera de chat para que la vista previa se lea como una
            conversación real, en la paleta de la casa. */}
        <div className="border-border bg-muted/40 rounded-xl border p-3">
          <div className="border-border mb-2.5 flex items-center gap-2 border-b pb-2.5">
            <span className="bg-accent text-accent-ink grid h-7 w-7 shrink-0 place-items-center rounded-full text-[11px] font-semibold">
              {plan.message.preview_name.slice(0, 1).toUpperCase()}
            </span>
            <p className="text-foreground truncate text-xs font-medium">
              {plan.message.preview_name}
            </p>
          </div>
          <div className="bg-primary text-primary-foreground ml-auto max-w-[85%] rounded-2xl rounded-br-md px-3 py-2 text-[13px] leading-relaxed whitespace-pre-wrap">
            {messagePreview}
          </div>
          {plan.offer && (
            <div className="bg-primary text-primary-foreground mt-1.5 ml-auto max-w-[85%] rounded-2xl rounded-br-md px-3 py-2 text-[13px]">
              🎁 {t('igAgent.offerCodeLabel')}{' '}
              <span className="font-semibold">{plan.offer.code}</span> —{' '}
              {plan.offer.discount}
            </div>
          )}
        </div>
      </div>

      <PlanNote
        icon={<CornerDownRight className="text-muted-foreground h-3.5 w-3.5" />}
        label={t('igAgent.followUpIfNoReply')}
        text={fillName(plan.follow_up, plan.message.preview_name)}
      />

      {plan.comment_reply && (
        <PlanNote
          icon={<MessageCircle className="text-muted-foreground h-3.5 w-3.5" />}
          label={t('igAgent.highIntentCommentReply')}
          text={plan.comment_reply}
        />
      )}

      {plan.offer && (
        <div className="space-y-2">
          <p className="text-foreground flex items-center gap-1.5 text-sm font-medium">
            <Tag className="text-accent-ink h-4 w-4" />
            {t('igAgent.offer')}
          </p>
          <div className="flex items-baseline gap-2">
            <span className="border-accent-ink/40 bg-accent/40 text-accent-ink rounded-md border border-dashed px-2 py-1 font-mono text-sm font-semibold">
              {plan.offer.code}
            </span>
            <span className="text-foreground text-sm font-medium">
              {plan.offer.discount}
            </span>
          </div>
          {plan.offer.conditions && (
            <p className="text-muted-foreground text-xs">
              {plan.offer.conditions}
            </p>
          )}
        </div>
      )}

      {plan.recommended_products.length > 0 && (
        <div className="space-y-2">
          <p className="text-foreground flex items-center gap-1.5 text-sm font-medium">
            <ShoppingBag className="text-accent-ink h-4 w-4" />
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
      <p className="text-foreground flex items-center gap-1.5 text-xs font-medium">
        {icon}
        {label}
      </p>
      <p className="border-border bg-muted/40 text-muted-foreground rounded-lg border border-dashed px-3 py-2 text-[13px] whitespace-pre-wrap">
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
    [audience, productCount, t, fmt]
  );
  const [active, setActive] = useState(0);
  useEffect(() => {
    if (active >= steps.length - 1) return;
    const timer = setTimeout(
      () => setActive((a) => Math.min(a + 1, steps.length - 1)),
      850
    );
    return () => clearTimeout(timer);
  }, [active, steps.length]);

  return (
    <div>
      <p className="app-eyebrow flex items-center gap-1.5">
        <span className="relative flex h-2 w-2">
          <span className="bg-accent-ink/50 absolute inline-flex h-full w-full animate-ping rounded-full" />
          <span className="bg-accent-ink relative inline-flex h-2 w-2 rounded-full" />
        </span>
        {t('igAgent.agentWorking')}
      </p>
      <ul className="mt-3 space-y-2">
        {steps.map((s, i) => (
          <li
            key={i}
            className={cn(
              'flex items-center gap-2 text-sm transition-colors',
              i <= active ? 'text-foreground' : 'text-muted-foreground/40'
            )}
          >
            {i < active ? (
              <Check className="h-4 w-4 shrink-0 text-emerald-500" />
            ) : i === active ? (
              <Loader2 className="text-accent-ink h-4 w-4 shrink-0 animate-spin" />
            ) : (
              <span className="border-muted-foreground/30 h-4 w-4 shrink-0 rounded-full border" />
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
        <h2 className="text-foreground flex items-center gap-1.5 text-sm font-medium">
          <Radio className="text-muted-foreground h-4 w-4" />
          {t('igAgent.myCampaigns')}
        </h2>
      </div>

      {campaigns.length === 0 ? (
        <p className="text-muted-foreground text-[13px]">
          {t('igAgent.noCampaignsYet')}
        </p>
      ) : (
        <ul className="space-y-2">
          {campaigns.map((c) => (
            <li
              key={c.id}
              className="group border-border bg-card hover:border-accent-ink/40 relative overflow-hidden rounded-2xl border p-4 pl-5 shadow-sm transition-colors"
            >
              {/* Filo lima: de un vistazo se ve cuál está trabajando ahora. */}
              {c.status === 'active' && (
                <span className="bg-primary absolute inset-y-0 left-0 w-[3px]" />
              )}

              <div className="flex items-start justify-between gap-3">
                <Link
                  href={`/agente-instagram/${toShortId(c.id)}`}
                  className="min-w-0 flex-1"
                >
                  <p className="text-foreground group-hover:text-accent-ink truncate text-sm font-medium transition-colors">
                    {c.name}
                  </p>
                  <p className="text-muted-foreground mt-0.5 text-[11px]">
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
                      className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive inline-flex size-7 items-center justify-center rounded-md opacity-0 transition-all group-hover:opacity-100 focus-visible:opacity-100"
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
      <div className="bg-muted relative h-1.5 overflow-hidden rounded-full">
        <div className="bg-accent-ink/25 absolute inset-y-0 left-0 w-full" />
        <div
          className="bg-accent-ink/60 absolute inset-y-0 left-0 transition-all duration-500"
          style={{ width: width(replies) }}
        />
        <div
          className="bg-accent-ink absolute inset-y-0 left-0 transition-all duration-500"
          style={{ width: width(conversions) }}
        />
      </div>

      <div className="text-muted-foreground flex flex-wrap items-baseline gap-x-4 gap-y-0.5 text-[11px]">
        <ResultStat n={fmt.number(sent)} label={t('igAgent.sent')} />
        <ResultStat n={fmt.number(replies)} label={t('igAgent.replies')} />
        <ResultStat
          n={fmt.number(conversions)}
          label={t('igAgent.conversions')}
        />
        {revenue > 0 && (
          <span className="text-accent-ink ml-auto font-semibold tabular-nums">
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
      <span className="text-foreground font-semibold tabular-nums">{n}</span>
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
        <h2 className="text-foreground flex items-center gap-1.5 text-sm font-medium">
          <Receipt className="text-muted-foreground h-4 w-4" />
          {t('igAgent.attributedOrdersTitle')}
        </h2>
      </div>
      <ul className="divide-border border-border bg-card divide-y rounded-2xl border px-5 shadow-sm">
        {orders.slice(0, 5).map((o) => (
          <li
            key={o.shopify_order_id}
            className="flex items-center justify-between gap-3 py-2.5"
          >
            <div className="min-w-0">
              <p className="text-foreground truncate text-sm font-medium">
                {o.order_name
                  ? t('igAgent.orderLabelName', { name: o.order_name })
                  : o.shopify_order_id}
              </p>
              <p className="text-muted-foreground text-[11px]">
                {t(ORDER_SOURCE_LABEL[o.source] ?? 'igAgent.orderSourceAgent')}{' '}
                · {fmt.date(o.created_at, { day: 'numeric', month: 'numeric' })}
              </p>
            </div>
            {o.revenue != null && (
              <span className="text-accent-ink shrink-0 text-sm font-semibold tabular-nums">
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
export type CommentAudience = 'intent' | 'all';

/**
 * Qué sale cuando la IA contesta un comentario (migración 177). Una sola
 * decisión: antes eran "responder también en público" (interruptor) y "manda
 * DM siempre" (clavado en el código), y de las dos juntas salía una conducta
 * que no estaba escrita en ningún lado.
 */
export type CommentReplyMode = 'dm' | 'public_dm' | 'public_smart' | 'public';

/**
 * En qué redes trabaja Comentarios (migraciones 203 y 204). Antes Instagram
 * estaba clavado y Facebook era un "también" al final de la pantalla: no había
 * forma de decir "solo Facebook", y la decisión —que es la primera que se
 * toma— estaba escrita como la última.
 *
 * Se eligen varias: son independientes, no tres respuestas a una sola pregunta.
 */
export type CommentNetwork = 'instagram' | 'facebook' | 'tiktok';

export interface ProactiveSettings {
  loaded: boolean;
  paused: boolean;
  autoReply: boolean;
  outreach: boolean;
  cap: number;
  /** A quién contesta la IA en comentarios (migración 132). */
  audience: CommentAudience;
  /** Cuántas veces insiste en un mismo hilo. 0 = sin tope. */
  maxThreadReplies: number;
  /** Qué sale cuando contesta: público, privado o las dos (migración 177). */
  replyMode: CommentReplyMode;
  /** En qué redes trabaja. Nunca vacío. */
  networks: CommentNetwork[];
  /** Pide permiso para escribir fuera de la ventana de Meta (migración 148). */
  marketingOptin: boolean;
  setPaused: (v: boolean) => void;
  setAutoReply: (v: boolean) => void;
  setOutreach: (v: boolean) => void;
  setCap: (v: number) => void;
  setAudience: (v: CommentAudience) => void;
  setMaxThreadReplies: (v: number) => void;
  setReplyMode: (v: CommentReplyMode) => void;
  setNetworks: (v: CommentNetwork[]) => void;
  setMarketingOptin: (v: boolean) => void;
  save: (next: {
    paused?: boolean;
    daily_cap?: number;
    auto_reply_comments?: boolean;
    outreach_enabled?: boolean;
    comment_audience?: CommentAudience;
    comment_max_thread_replies?: number;
    comment_reply_mode?: CommentReplyMode;
    comment_instagram?: boolean;
    comment_facebook?: boolean;
    comment_tiktok?: boolean;
    marketing_optin_enabled?: boolean;
  }) => void;
}

export function useProactiveSettings(): ProactiveSettings {
  const fetchWithCsrf = useFetchWithCsrf();
  const [paused, setPaused] = useState(false);
  const [autoReply, setAutoReply] = useState(true);
  const [outreach, setOutreach] = useState(true);
  const [cap, setCap] = useState(500);
  const [audience, setAudience] = useState<CommentAudience>('intent');
  const [maxThreadReplies, setMaxThreadReplies] = useState(3);
  const [replyMode, setReplyMode] = useState<CommentReplyMode>('dm');
  const [networks, setNetworks] = useState<CommentNetwork[]>(['instagram']);
  // Pedir permiso para escribir fuera de la ventana. Arranca APAGADO: es una
  // burbuja más que el cliente recibe, no algo que se le agregue solo.
  const [marketingOptin, setMarketingOptin] = useState(false);
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
          setAudience(j.comment_audience === 'all' ? 'all' : 'intent');
          setMaxThreadReplies(
            typeof j.comment_max_thread_replies === 'number'
              ? j.comment_max_thread_replies
              : 3
          );
          setReplyMode(
            REPLY_MODES.includes(j.comment_reply_mode)
              ? (j.comment_reply_mode as CommentReplyMode)
              : j.comment_public_reply === true
                ? 'public_dm'
                : 'dm'
          );
          setNetworks(
            networksFrom({
              instagram: j.comment_instagram !== false,
              facebook: j.comment_facebook === true,
              tiktok: j.comment_tiktok === true,
            })
          );
          setMarketingOptin(j.marketing_optin_enabled === true);
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
      comment_audience?: CommentAudience;
      comment_max_thread_replies?: number;
      comment_reply_mode?: CommentReplyMode;
      comment_instagram?: boolean;
      comment_facebook?: boolean;
      comment_tiktok?: boolean;
      marketing_optin_enabled?: boolean;
    }) => {
      void fetchWithCsrf('/api/ai/instagram-agent/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(next),
      }).catch(() => {});
    },
    [fetchWithCsrf]
  );

  return {
    loaded,
    paused,
    autoReply,
    outreach,
    cap,
    audience,
    maxThreadReplies,
    replyMode,
    networks,
    marketingOptin,
    setPaused,
    setAutoReply,
    setOutreach,
    setCap,
    setAudience,
    setMaxThreadReplies,
    setReplyMode,
    setNetworks,
    setMarketingOptin,
    save,
  };
}

/**
 * El piso autónomo: lo que pasa con un comentario cuando ninguna regla lo
 * atiende. Es la conducta por defecto de la página, así que va primero y sin
 * caja: una caja lo habría dejado al mismo nivel que una regla cualquiera.
 */
export function CommentAutoReply({
  settings,
}: {
  settings: ProactiveSettings;
}) {
  const t = useT();
  return (
    <label
      className={cn(
        'flex items-start justify-between gap-6 transition-opacity',
        settings.loaded ? '' : 'pointer-events-none opacity-50'
      )}
    >
      <span>
        <span className="text-foreground block text-[15px] font-medium">
          {t('igAgent.autoReplyComments')}
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

/* ─────────────────── estadísticas propias de Comentarios ─────────────────── */

interface CommentStats {
  /** Respuestas publicadas EN el comentario (IA + reglas). */
  public_replies: number;
  /** DMs privados enviados (IA + reglas). */
  dms_sent: number;
  days: number;
}

/**
 * Lo que hizo Comentarios, y nada más. Prospección IA tiene las suyas y el
 * agente las suyas: la misma cifra en dos pantallas no significaría nada en
 * ninguna de las dos.
 */
function useCommentStats(workspaceId?: string | null): CommentStats | null {
  const [stats, setStats] = useState<CommentStats | null>(null);
  useEffect(() => {
    let cancelled = false;
    const qs = workspaceId ? `?workspace_id=${workspaceId}` : '';
    getJson<CommentStats>(`/api/comments/stats${qs}`).then((json) => {
      if (!cancelled && json) setStats(json);
    });
    return () => {
      cancelled = true;
    };
  }, [workspaceId]);
  return stats;
}

function CommentStatsStrip({ stats }: { stats: CommentStats | null }) {
  const t = useT();
  const fmt = useFormat();
  if (!stats) return null;

  return (
    <div>
      {/* Sin "ingresos atribuidos": una venta que empieza en un comentario se
          cierra en la conversación, y adjudicársela a esta pantalla era
          apuntarse trabajo del agente. El dinero se mide donde se cierra. */}
      <StatGrid className="grid-cols-2 shadow-sm">
        <StatCell
          label={t('igAgent.statCommentsAnswered')}
          value={fmt.number(stats.public_replies)}
        />
        <StatCell
          label={t('igAgent.statDmsSent')}
          value={fmt.number(stats.dms_sent)}
        />
      </StatGrid>
      <p className="text-muted-foreground mt-2 text-[11px]">
        {t('igAgent.statLastDays', { n: stats.days })}
      </p>
    </div>
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
/**
 * Las dos decisiones que antes estaban clavadas en el código: a quién contesta
 * la IA y cuánto insiste. Solo se ven con la IA encendida — configurar el
 * comportamiento de algo apagado es ruido.
 */
function CommentReplyOptions({ settings }: { settings: ProactiveSettings }) {
  const t = useT();
  if (!settings.autoReply) return null;
  return (
    <div className="border-border mt-5 space-y-4 border-l-2 pl-4">
      {/* En qué redes, primero: es la decisión que enmarca a las otras dos, y
          estaba escrita al final como un "también Facebook" que además no
          dejaba elegir sólo Facebook. */}
      <div>
        <p className="text-foreground text-[13px] font-medium">
          {t('igAgent.networksLabel')}
        </p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {NETWORKS.map((net) => {
            const on = settings.networks.includes(net);
            return (
              <button
                key={net}
                type="button"
                onClick={() => {
                  const next = on
                    ? settings.networks.filter((n) => n !== net)
                    : [...settings.networks, net];
                  // Apagarlas todas dejaría "Responder con IA" encendido sin
                  // ningún lado donde contestar: la última no se apaga.
                  if (next.length === 0) return;
                  settings.setNetworks(next);
                  settings.save({
                    comment_instagram: next.includes('instagram'),
                    comment_facebook: next.includes('facebook'),
                    comment_tiktok: next.includes('tiktok'),
                  });
                }}
                aria-pressed={on}
                className={cn(
                  'rounded-lg border px-3 py-1.5 text-[13px] transition-colors',
                  on
                    ? 'border-accent-ink/40 bg-accent/40 text-foreground font-medium'
                    : 'border-border text-muted-foreground hover:bg-accent/20'
                )}
              >
                {t(`igAgent.network_${net}`)}
              </button>
            );
          })}
        </div>
        {/* Lo único que hay que saber de TikTok, y sólo cuando está elegido:
            sin esto, elegir "Solo por privado" con TikTok encendido sorprende
            con respuestas públicas bajo el video. */}
        {settings.networks.includes('tiktok') && (
          <p className="text-muted-foreground mt-1.5 text-[11px] leading-snug">
            {t('igAgent.tiktokPublicOnly')}
          </p>
        )}
      </div>

      <OptionRow
        title={t('igAgent.audienceIntent')}
        hint={t('igAgent.audienceIntentHint')}
        checked={settings.audience === 'intent'}
        onChange={(v) => {
          const next = v ? 'intent' : 'all';
          settings.setAudience(next);
          settings.save({ comment_audience: next });
        }}
      />

      {/* Dónde contesta. Una sola pregunta con cuatro respuestas, en vez de un
          interruptor de "también en público" con el DM invisible detrás. La
          tercera es la nueva: contesta a la vista de todos y abre el privado
          solo cuando hay algo que ganar o algo que no se dice en público. */}
      <div>
        <p className="text-foreground text-[13px] font-medium">
          {t('igAgent.replyModeLabel')}
        </p>
        <div className="mt-2 space-y-1.5">
          {REPLY_MODES.map((mode) => (
            <ModeRow
              key={mode}
              title={t(`igAgent.replyMode_${mode}`)}
              hint={t(`igAgent.replyModeHint_${mode}`)}
              selected={settings.replyMode === mode}
              onSelect={() => {
                settings.setReplyMode(mode);
                settings.save({ comment_reply_mode: mode });
              }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * Los cuatro modos: primero los dos que hacen UNA sola cosa —solo privado,
 * solo público— y después los dos que hacen las dos. Antes el "solo en el
 * comentario" quedaba al final, lejos de su espejo.
 */
const REPLY_MODES: CommentReplyMode[] = [
  'dm',
  'public',
  'public_dm',
  'public_smart',
];

/** Las redes con comentarios, en el orden en que se leen. */
const NETWORKS: CommentNetwork[] = ['instagram', 'facebook', 'tiktok'];

/** Las columnas de la BD, leídas como una sola lista. Nunca devuelve vacío. */
function networksFrom(on: Record<CommentNetwork, boolean>): CommentNetwork[] {
  const list = NETWORKS.filter((n) => on[n]);
  return list.length > 0 ? list : ['instagram'];
}

/** Una opción de "dónde contesta". Se elige una, como una radio. */
function ModeRow({
  title,
  hint,
  selected,
  onSelect,
}: {
  title: string;
  hint: string;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={cn(
        'flex w-full items-start gap-2.5 rounded-lg border px-3 py-2 text-left transition-colors',
        selected
          ? 'border-accent-ink/40 bg-accent/40'
          : 'hover:bg-accent/20 border-transparent'
      )}
    >
      <span
        className={cn(
          'mt-[3px] flex size-3.5 shrink-0 items-center justify-center rounded-full border',
          selected ? 'border-accent-ink' : 'border-border'
        )}
      >
        {selected && <span className="bg-accent-ink size-1.5 rounded-full" />}
      </span>
      <span className="min-w-0">
        <span className="text-foreground block text-[13px] font-medium">
          {title}
        </span>
        {hint && (
          <span className="text-muted-foreground mt-0.5 block text-[11px] leading-snug">
            {hint}
          </span>
        )}
      </span>
    </button>
  );
}

function OptionRow({
  title,
  hint,
  checked,
  onChange,
}: {
  title: string;
  hint: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-start justify-between gap-4">
      <span>
        <span className="text-foreground block text-[13px] font-medium">
          {title}
        </span>
        {hint && (
          <span className="text-muted-foreground mt-0.5 block max-w-md text-[11px] leading-snug">
            {hint}
          </span>
        )}
      </span>
      <Switch
        className="mt-0.5 shrink-0"
        checked={checked}
        onCheckedChange={(v) => onChange(!!v)}
      />
    </label>
  );
}

export function CommentsSection({
  settings,
  workspaceId,
}: {
  settings: ProactiveSettings;
  workspaceId?: string | null;
}) {
  // Una sola carga para la sección: las cifras y el estado de quién puede
  // contestar salen de la misma consulta.
  const t = useT();
  const stats = useCommentStats(workspaceId);
  return (
    <Tabs defaultValue="automation" className="space-y-6">
      <TabsList className="border-border bg-card h-10 border p-1">
        <TabsTrigger
          value="automation"
          className="data-active:bg-accent data-active:text-accent-ink px-3"
        >
          <MessageCircle className="size-4" />
          {t('igAgent.commentsTabAutomation')}
        </TabsTrigger>
        <TabsTrigger
          value="analysis"
          className="data-active:bg-accent data-active:text-accent-ink px-3"
        >
          <BrainCircuit className="size-4" />
          {t('igAgent.commentsTabAnalysis')}
        </TabsTrigger>
      </TabsList>

      <TabsContent value="automation" className="space-y-8">
        <CommentStatsStrip stats={stats} />
        <section className="border-border bg-card rounded-3xl border p-5 sm:p-6">
          <CommentAutoReply settings={settings} />
          <CommentReplyOptions settings={settings} />
        </section>
        <CommentToDmPanel />
      </TabsContent>

      <TabsContent value="analysis">
        {workspaceId && <CommentMarketResearch workspaceId={workspaceId} />}
      </TabsContent>
    </Tabs>
  );
}

interface MarketResearchResponse {
  total: number;
  analyzed_sample: number;
  generated_with_ai: boolean;
  metrics: {
    byChannel: Record<'ig_comment' | 'fb_comment' | 'tiktok_comment', number>;
    sentiment: { positive: number; neutral: number; negative: number };
    signals: Array<{
      key:
        | 'price'
        | 'purchase'
        | 'where_to_buy'
        | 'information'
        | 'availability'
        | 'product_use'
        | 'complaint';
      count: number;
    }>;
    terms: Array<{ term: string; count: number }>;
  };
  summary: string;
  findings: Array<{ title: string; detail: string }>;
  opportunities: string[];
  risks: string[];
  actions: string[];
}

type MarketResearchCommentCategory =
  | 'all'
  | 'positive'
  | 'neutral'
  | 'negative'
  | 'price'
  | 'purchase'
  | 'where_to_buy'
  | 'information'
  | 'availability'
  | 'product_use'
  | 'complaint';

interface MarketResearchComment {
  id?: string;
  channel: 'ig_comment' | 'fb_comment' | 'tiktok_comment';
  text: string;
  createdAt: string;
}

interface MarketResearchCommentPage {
  category: MarketResearchCommentCategory;
  total: number;
  page: number;
  page_size: number;
  comments: MarketResearchComment[];
  has_more: boolean;
}

type MarketResearchProgressStage =
  | 'starting'
  | 'reading'
  | 'calculating'
  | 'synthesizing';

type MarketResearchStreamEvent =
  | {
      type: 'progress';
      stage: Exclude<MarketResearchProgressStage, 'starting'>;
      value: number;
    }
  | { type: 'result'; report: MarketResearchResponse }
  | { type: 'error'; error: string };

const MARKET_RESEARCH_PROGRESS_KEY: Record<
  MarketResearchProgressStage,
  | 'igAgent.marketResearchProgressStarting'
  | 'igAgent.marketResearchProgressReading'
  | 'igAgent.marketResearchProgressCalculating'
  | 'igAgent.marketResearchProgressSynthesizing'
> = {
  starting: 'igAgent.marketResearchProgressStarting',
  reading: 'igAgent.marketResearchProgressReading',
  calculating: 'igAgent.marketResearchProgressCalculating',
  synthesizing: 'igAgent.marketResearchProgressSynthesizing',
};

const MARKET_RESEARCH_SIGNAL_KEY = {
  price: 'igAgent.marketResearchSignalPrice',
  purchase: 'igAgent.marketResearchSignalPurchase',
  where_to_buy: 'igAgent.marketResearchSignalWhereToBuy',
  information: 'igAgent.marketResearchSignalInformation',
  availability: 'igAgent.marketResearchSignalAvailability',
  product_use: 'igAgent.marketResearchSignalProductUse',
  complaint: 'igAgent.marketResearchSignalComplaint',
} as const;

const MARKET_RESEARCH_CHANNEL_KEY = {
  ig_comment: 'igAgent.network_instagram',
  fb_comment: 'igAgent.network_facebook',
  tiktok_comment: 'igAgent.network_tiktok',
} as const;

/** Investigación pasiva: convierte todos los comentarios ya importados en señales de mercado. */
function CommentMarketResearch({ workspaceId }: { workspaceId: string }) {
  const t = useT();
  const fmt = useFormat();
  const fetchWithCsrf = useFetchWithCsrf();
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{
    value: number;
    stage: MarketResearchProgressStage;
  } | null>(null);
  const [report, setReport] = useState<MarketResearchResponse | null>(null);
  const [detailCategory, setDetailCategory] =
    useState<MarketResearchCommentCategory | null>(null);
  const [detail, setDetail] = useState<MarketResearchCommentPage | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const categoryLabel = (category: MarketResearchCommentCategory) => {
    if (category === 'all') return t('igAgent.marketResearchComments');
    if (category === 'positive') return t('igAgent.marketResearchPositive');
    if (category === 'negative') return t('igAgent.marketResearchNegative');
    if (category === 'neutral') return t('igAgent.marketResearchNeutral');
    return t(MARKET_RESEARCH_SIGNAL_KEY[category]);
  };

  const openDetail = async (
    category: MarketResearchCommentCategory,
    page = 0
  ) => {
    setDetailCategory(category);
    setDetailLoading(true);
    try {
      const params = new URLSearchParams({
        workspace_id: workspaceId,
        category,
        page: String(page),
      });
      const response = await fetchWithCsrf(
        `/api/comments/market-research?${params.toString()}`
      );
      const payload = (await response.json().catch(() => ({}))) as
        | MarketResearchCommentPage
        | { error?: string };
      if (!response.ok || !('comments' in payload))
        throw new Error(
          'error' in payload && payload.error
            ? payload.error
            : t('igAgent.marketResearchFailed')
        );
      setDetail(payload);
    } catch (error) {
      toast.error(
        error instanceof Error && error.message
          ? error.message
          : t('igAgent.marketResearchFailed')
      );
      setDetailCategory(null);
    } finally {
      setDetailLoading(false);
    }
  };

  const run = async () => {
    setRunning(true);
    setProgress({ value: 5, stage: 'starting' });
    try {
      const response = await fetchWithCsrf('/api/comments/market-research', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workspace_id: workspaceId }),
      });
      if (!response.ok) {
        const result = (await response.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(result.error);
      }
      if (!response.body) throw new Error(t('igAgent.marketResearchFailed'));

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let receivedResult = false;
      const handleEvent = (event: MarketResearchStreamEvent) => {
        if (event.type === 'progress') {
          setProgress({ value: event.value, stage: event.stage });
          return;
        }
        if (event.type === 'error') throw new Error(event.error);
        setReport(event.report);
        setProgress({ value: 100, stage: 'synthesizing' });
        receivedResult = true;
      };

      for (;;) {
        const { done, value } = await reader.read();
        buffer += decoder.decode(value, { stream: !done });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          if (line.trim())
            handleEvent(JSON.parse(line) as MarketResearchStreamEvent);
        }
        if (done) break;
      }
      if (buffer.trim())
        handleEvent(JSON.parse(buffer) as MarketResearchStreamEvent);
      if (!receivedResult) throw new Error(t('igAgent.marketResearchFailed'));
    } catch (error) {
      toast.error(
        error instanceof Error && error.message
          ? error.message
          : t('igAgent.marketResearchFailed')
      );
    } finally {
      setRunning(false);
      setProgress(null);
    }
  };

  const total = report?.total ?? 0;
  const positiveRate = total
    ? Math.round(((report?.metrics.sentiment.positive ?? 0) / total) * 100)
    : 0;
  const negativeRate = total
    ? Math.round(((report?.metrics.sentiment.negative ?? 0) / total) * 100)
    : 0;
  const signalCount = (
    key: MarketResearchResponse['metrics']['signals'][number]['key']
  ) => report?.metrics.signals.find((signal) => signal.key === key)?.count ?? 0;

  return (
    <section className="border-border bg-card overflow-hidden rounded-3xl border">
      <div className="from-accent/45 via-card to-card flex flex-wrap items-start justify-between gap-5 bg-gradient-to-br p-5 sm:p-7">
        <div className="max-w-xl">
          <div className="text-accent-ink flex items-center gap-2 text-xs font-semibold tracking-wide uppercase">
            <BrainCircuit className="size-4" />
            {t('igAgent.marketResearchEyebrow')}
          </div>
          <h2 className="mt-3 text-xl font-semibold tracking-tight">
            {t('igAgent.marketResearchTitle')}
          </h2>
          <p className="text-muted-foreground mt-2 text-sm leading-6">
            {t('igAgent.marketResearchSubtitle')}
          </p>
        </div>
        <Button type="button" onClick={run} disabled={running} size="sm">
          {running ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Sparkles className="size-3.5" />
          )}
          {running
            ? t('igAgent.marketResearchRunning')
            : t('igAgent.marketResearchRun')}
        </Button>
      </div>

      {running && progress && (
        <div
          aria-live="polite"
          className="border-border space-y-2 border-t px-5 py-4 sm:px-7"
        >
          <div
            aria-valuemax={100}
            aria-valuemin={0}
            aria-valuenow={progress.value}
            aria-valuetext={t(MARKET_RESEARCH_PROGRESS_KEY[progress.stage])}
            className="bg-muted h-1.5 overflow-hidden rounded-full"
            role="progressbar"
          >
            <div
              className="bg-primary h-full rounded-full transition-[width] duration-500 ease-out"
              style={{ width: `${progress.value}%` }}
            />
          </div>
          <p className="text-muted-foreground text-xs">
            {t(MARKET_RESEARCH_PROGRESS_KEY[progress.stage])} {progress.value}%
          </p>
        </div>
      )}

      {!running && !report && (
        <div className="text-muted-foreground flex items-center gap-3 px-5 py-6 text-sm sm:px-7">
          <MessageSquareText className="text-accent-ink size-5 shrink-0" />
          {t('igAgent.marketResearchEmpty')}
        </div>
      )}

      {report && (
        <div className="border-border space-y-7 border-t p-5 sm:p-7">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <ResearchStat
              icon={<MessageSquareText className="size-4" />}
              label={t('igAgent.marketResearchComments')}
              value={report.total}
              onClick={() => openDetail('all')}
            />
            <ResearchStat
              icon={<TrendingUp className="size-4" />}
              label={t('igAgent.marketResearchPositiveRate')}
              value={`${positiveRate}%`}
              onClick={() => openDetail('positive')}
            />
            <ResearchStat
              icon={<Target className="size-4" />}
              label={t('igAgent.marketResearchPurchaseSignal')}
              value={signalCount('purchase')}
              onClick={() => openDetail('purchase')}
            />
            <ResearchStat
              icon={<AlertTriangle className="size-4" />}
              label={t('igAgent.marketResearchNegativeRate')}
              value={`${negativeRate}%`}
              onClick={() => openDetail('negative')}
            />
          </div>

          <div className="grid gap-6 lg:grid-cols-[minmax(0,1.35fr)_minmax(16rem,.65fr)]">
            <div className="space-y-5">
              <div>
                <p className="text-sm font-semibold">
                  {t('igAgent.marketResearchMarketVoice')}
                </p>
                <p className="text-muted-foreground mt-2 text-sm leading-6">
                  {report.summary}
                </p>
              </div>
              <div className="grid gap-3">
                {report.findings.map((finding, index) => (
                  <div
                    key={`${finding.title}-${finding.detail}`}
                    className="border-border bg-background rounded-2xl border p-4"
                  >
                    <p className="text-accent-ink text-xs font-semibold tabular-nums">
                      0{index + 1}
                    </p>
                    <p className="mt-1 text-sm font-semibold">
                      {finding.title}
                    </p>
                    <p className="text-muted-foreground mt-1 text-sm leading-5">
                      {finding.detail}
                    </p>
                  </div>
                ))}
              </div>
            </div>

            <div className="border-border bg-background space-y-5 rounded-2xl border p-4">
              <div>
                <p className="text-sm font-semibold">
                  {t('igAgent.marketResearchSignals')}
                </p>
                <p className="text-muted-foreground mt-1 text-xs">
                  {t('igAgent.marketResearchSignalsSubtitle')}
                </p>
              </div>
              <div className="space-y-3">
                {report.metrics.signals.map((signal) => (
                  <ResearchSignal
                    key={signal.key}
                    label={t(MARKET_RESEARCH_SIGNAL_KEY[signal.key])}
                    count={signal.count}
                    total={report.total}
                    onClick={() => openDetail(signal.key)}
                  />
                ))}
              </div>
              <div className="border-border border-t pt-4">
                <p className="text-muted-foreground text-xs font-medium">
                  {t('igAgent.marketResearchChannelMix')}
                </p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {Object.entries(report.metrics.byChannel).map(
                    ([channel, count]) => (
                      <Badge key={channel} variant="secondary">
                        {t(
                          MARKET_RESEARCH_CHANNEL_KEY[
                            channel as keyof typeof MARKET_RESEARCH_CHANNEL_KEY
                          ]
                        )}{' '}
                        {count}
                      </Badge>
                    )
                  )}
                </div>
              </div>
            </div>
          </div>

          {report.metrics.terms.length > 0 && (
            <div>
              <p className="text-sm font-semibold">
                {t('igAgent.marketResearchTerms')}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {report.metrics.terms.map(({ term, count }) => (
                  <Badge key={term} variant="secondary">
                    {term} · {count}
                  </Badge>
                ))}
              </div>
            </div>
          )}

          <div className="grid gap-4 lg:grid-cols-2">
            <ResearchPanel
              icon={<Lightbulb className="size-4" />}
              title={t('igAgent.marketResearchOpportunities')}
              items={report.opportunities}
            />
            <ResearchPanel
              icon={<AlertTriangle className="size-4" />}
              title={t('igAgent.marketResearchRisks')}
              items={report.risks}
              empty={t('igAgent.marketResearchNoRisks')}
            />
          </div>

          <ResearchPanel
            icon={<Target className="size-4" />}
            title={t('igAgent.marketResearchActions')}
            items={report.actions}
            numbered
          />
          {report.analyzed_sample < report.total && (
            <p className="text-muted-foreground text-xs">
              {t('igAgent.marketResearchSample', {
                n: report.analyzed_sample,
                total: report.total,
              })}
            </p>
          )}
        </div>
      )}

      <Dialog
        open={detailCategory !== null}
        onOpenChange={(open) => {
          if (!open) {
            setDetailCategory(null);
            setDetail(null);
          }
        }}
      >
        <DialogContent className="border-border bg-card max-h-[calc(100dvh-2rem)] overflow-hidden p-0 sm:max-w-2xl">
          <DialogHeader className="border-border border-b px-5 pt-5 pr-12 pb-4">
            <DialogTitle>
              {detailCategory ? categoryLabel(detailCategory) : ''}
            </DialogTitle>
            <DialogDescription>
              {detail
                ? t('igAgent.marketResearchDetailCount', { n: detail.total })
                : t('igAgent.marketResearchDetailLoading')}
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[65dvh] overflow-y-auto px-5 py-4">
            {detailLoading ? (
              <div className="text-muted-foreground flex items-center gap-2 py-8 text-sm">
                <Loader2 className="size-4 animate-spin" />
                {t('igAgent.marketResearchDetailLoading')}
              </div>
            ) : detail ? (
              <div className="space-y-3">
                {detail.comments.map((comment, index) => (
                  <article
                    key={comment.id ?? `${comment.createdAt}-${index}`}
                    className="border-border bg-background rounded-xl border p-3.5"
                  >
                    <p className="text-sm leading-6">{comment.text}</p>
                    <p className="text-muted-foreground mt-2 text-xs">
                      {t(MARKET_RESEARCH_CHANNEL_KEY[comment.channel])} ·{' '}
                      {fmt.dateTime(comment.createdAt)}
                    </p>
                  </article>
                ))}
                {detail.comments.length === 0 && (
                  <p className="text-muted-foreground py-8 text-center text-sm">
                    {t('igAgent.marketResearchDetailEmpty')}
                  </p>
                )}
                <div className="flex justify-between gap-3 pt-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={
                      detail.page === 0 || detailLoading || !detailCategory
                    }
                    onClick={() =>
                      detailCategory &&
                      openDetail(detailCategory, detail.page - 1)
                    }
                  >
                    {t('igAgent.marketResearchPrevious')}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={
                      !detail.has_more || detailLoading || !detailCategory
                    }
                    onClick={() =>
                      detailCategory &&
                      openDetail(detailCategory, detail.page + 1)
                    }
                  >
                    {t('igAgent.marketResearchNext')}
                  </Button>
                </div>
              </div>
            ) : null}
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}

function ResearchStat({
  icon,
  label,
  value,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  value: number | string;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="border-border bg-background hover:border-accent-ink/40 hover:bg-accent/15 rounded-2xl border p-4 text-left transition-colors"
    >
      <p className="text-muted-foreground flex items-center gap-2 text-xs font-medium">
        {icon}
        {label}
      </p>
      <p className="mt-2 text-2xl font-semibold tracking-tight tabular-nums">
        {value}
      </p>
    </button>
  );
}

function ResearchSignal({
  label,
  count,
  total,
  onClick,
}: {
  label: string;
  count: number;
  total: number;
  onClick?: () => void;
}) {
  const percentage = total ? Math.round((count / total) * 100) : 0;
  return (
    <button type="button" onClick={onClick} className="w-full text-left">
      <div className="flex items-baseline justify-between gap-3 text-xs">
        <span className="text-foreground font-medium">{label}</span>
        <span className="text-muted-foreground shrink-0 tabular-nums">
          {count} · {percentage}%
        </span>
      </div>
      <div className="bg-muted mt-1.5 h-1.5 overflow-hidden rounded-full">
        <div
          className="bg-accent-ink h-full rounded-full"
          style={{ width: `${percentage}%` }}
        />
      </div>
    </button>
  );
}

function ResearchPanel({
  icon,
  title,
  items,
  empty,
  numbered = false,
}: {
  icon: ReactNode;
  title: string;
  items: string[];
  empty?: string;
  numbered?: boolean;
}) {
  return (
    <div className="border-border bg-background rounded-2xl border p-4">
      <p className="flex items-center gap-2 text-sm font-semibold">
        <span className="text-accent-ink">{icon}</span>
        {title}
      </p>
      {items.length > 0 ? (
        <ol className="text-muted-foreground mt-3 space-y-2 text-sm leading-5">
          {items.map((item, index) => (
            <li key={item} className="flex gap-2">
              {numbered && (
                <span className="text-accent-ink font-semibold tabular-nums">
                  {index + 1}.
                </span>
              )}
              <span>{item}</span>
            </li>
          ))}
        </ol>
      ) : (
        empty && <p className="text-muted-foreground mt-3 text-sm">{empty}</p>
      )}
    </div>
  );
}

export function CommentBackfillDialog({
  workspaceId,
}: {
  workspaceId: string;
}) {
  const [open, setOpen] = useState(false);
  const t = useT();
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" />}>
        <Download className="size-3.5" />
        {t('igAgent.backfillOpen')}
      </DialogTrigger>
      <DialogContent className="border-border bg-card max-h-[calc(100dvh-2rem)] p-0 sm:max-w-xl">
        <DialogHeader className="border-border border-b px-5 pt-5 pr-12 pb-4">
          <DialogTitle>{t('igAgent.backfillTitle')}</DialogTitle>
          <DialogDescription>
            {t('igAgent.backfillDialogDescription')}
          </DialogDescription>
        </DialogHeader>
        <div className="px-5 py-5">
          <CommentBackfill
            workspaceId={workspaceId}
            onComplete={() => setOpen(false)}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}

function CommentBackfill({
  workspaceId,
  onComplete,
}: {
  workspaceId: string;
  onComplete?: () => void;
}) {
  type CommentBackfillChannel = 'ig_comment' | 'fb_comment' | 'tiktok_comment';
  type MessageBackfillChannel = 'instagram' | 'facebook';
  type BackfillCapabilities = {
    comments: { instagram: boolean; facebook: boolean; tiktok: boolean };
    messages: {
      instagram: boolean;
      facebook: boolean;
      whatsapp: {
        connected: boolean;
        mode: 'coexistence' | 'cloud' | 'disconnected';
        manual_backfill: boolean;
      };
    };
  };
  const t = useT();
  const fetchWithCsrf = useFetchWithCsrf();
  const today = new Date().toISOString().slice(0, 10);
  const dateDaysAgo = (days: number) =>
    new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
  const [fromDate, setFromDate] = useState(() => dateDaysAgo(30));
  const [toDate, setToDate] = useState(today);
  const [allHistory, setAllHistory] = useState(false);
  const [surfaces, setSurfaces] = useState<Array<'comments' | 'messages'>>([
    'comments',
  ]);
  const [channels, setChannels] = useState<CommentBackfillChannel[]>([
    'ig_comment',
    'fb_comment',
  ]);
  const [messageChannels, setMessageChannels] = useState<
    MessageBackfillChannel[]
  >(['instagram', 'facebook']);
  const [capabilities, setCapabilities] = useState<BackfillCapabilities | null>(
    null
  );
  const [running, setRunning] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(
      `/api/messages/backfill?workspace_id=${encodeURIComponent(workspaceId)}`,
      { cache: 'no-store' }
    )
      .then((response) => (response.ok ? response.json() : null))
      .then((payload: BackfillCapabilities | null) => {
        if (cancelled || !payload) return;
        setCapabilities(payload);
        setChannels((current) =>
          current.filter(
            (channel) =>
              (channel === 'ig_comment' && payload.comments.instagram) ||
              (channel === 'fb_comment' && payload.comments.facebook) ||
              (channel === 'tiktok_comment' && payload.comments.tiktok)
          )
        );
        setMessageChannels((current) =>
          current.filter(
            (channel) =>
              (channel === 'instagram' && payload.messages.instagram) ||
              (channel === 'facebook' && payload.messages.facebook)
          )
        );
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [workspaceId]);

  const toggleChannel = (channel: CommentBackfillChannel) => {
    setChannels((current) =>
      current.includes(channel)
        ? current.filter((value) => value !== channel)
        : [...current, channel]
    );
  };

  const toggleMessageChannel = (channel: MessageBackfillChannel) => {
    setMessageChannels((current) =>
      current.includes(channel)
        ? current.filter((value) => value !== channel)
        : [...current, channel]
    );
  };

  const run = async () => {
    if (
      !surfaces.length ||
      (surfaces.includes('comments') && !channels.length) ||
      (surfaces.includes('messages') && !messageChannels.length)
    )
      return;
    setRunning(true);
    try {
      const requests = surfaces.map((surface) =>
        fetchWithCsrf(
          surface === 'comments'
            ? '/api/comments/backfill'
            : '/api/messages/backfill',
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              workspace_id: workspaceId,
              date_from: allHistory ? undefined : fromDate,
              date_to: toDate,
              all_history: allHistory,
              channels: surface === 'comments' ? channels : messageChannels,
            }),
          }
        )
      );
      const responses = await Promise.all(requests);
      const results = await Promise.all(
        responses.map(async (response) => ({
          response,
          result: (await response.json().catch(() => ({}))) as {
            error?: string;
            ingestedInbound?: number;
            ingested?: number;
            complete?: boolean;
            partial?: boolean;
          },
        }))
      );
      const failed = results.find(({ response }) => !response.ok);
      if (failed) throw new Error(failed.result.error);
      const imported = results.reduce(
        (sum, { result }) =>
          sum + (result.ingestedInbound ?? 0) + (result.ingested ?? 0),
        0
      );
      const partial = results.some(
        ({ result }) => result.partial || result.complete === false
      );
      if (partial) toast.warning(t('igAgent.backfillPartial', { n: imported }));
      else toast.success(t('igAgent.backfillDone', { n: imported }));
      onComplete?.();
    } catch (error) {
      toast.error(
        error instanceof Error && error.message
          ? error.message
          : t('igAgent.backfillFailed')
      );
    } finally {
      setRunning(false);
    }
  };

  const toggleSurface = (surface: 'comments' | 'messages') => {
    setSurfaces((current) =>
      current.includes(surface)
        ? current.filter((value) => value !== surface)
        : [...current, surface]
    );
  };

  const selectPeriod = (days: number | 'all') => {
    const all = days === 'all';
    setAllHistory(all);
    setFromDate(all ? '' : dateDaysAgo(days));
    setToDate(today);
  };

  const commentAvailable = (channel: CommentBackfillChannel) =>
    !capabilities ||
    (channel === 'ig_comment' && capabilities.comments.instagram) ||
    (channel === 'fb_comment' && capabilities.comments.facebook) ||
    (channel === 'tiktok_comment' && capabilities.comments.tiktok);
  const messageAvailable = (channel: MessageBackfillChannel) =>
    !capabilities ||
    (channel === 'instagram' && capabilities.messages.instagram) ||
    (channel === 'facebook' && capabilities.messages.facebook);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-muted-foreground text-xs">
          {t('igAgent.backfillContent')}
        </span>
        <label
          className={cn(
            'border-border flex cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs transition-colors',
            surfaces.includes('comments')
              ? 'border-accent-ink/35 bg-accent/40 text-foreground'
              : 'text-muted-foreground hover:bg-accent/20'
          )}
        >
          <input
            className="accent-primary"
            type="checkbox"
            checked={surfaces.includes('comments')}
            onChange={() => toggleSurface('comments')}
          />
          {t('igAgent.backfillComments')}
        </label>
        <label
          className={cn(
            'border-border flex cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs transition-colors',
            surfaces.includes('messages')
              ? 'border-accent-ink/35 bg-accent/40 text-foreground'
              : 'text-muted-foreground hover:bg-accent/20'
          )}
        >
          <input
            className="accent-primary"
            type="checkbox"
            checked={surfaces.includes('messages')}
            onChange={() => toggleSurface('messages')}
          />
          {t('igAgent.backfillMessages')}
        </label>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className="text-muted-foreground text-xs">
          {t('igAgent.backfillDays')}
        </span>
        {[7, 30, 90].map((value) => (
          <Button
            key={value}
            size="sm"
            variant={
              !allHistory && fromDate === dateDaysAgo(value) && toDate === today
                ? 'secondary'
                : 'outline'
            }
            onClick={() => selectPeriod(value)}
          >
            {t(`igAgent.backfillDays${value}` as 'igAgent.backfillDays7')}
          </Button>
        ))}
        <Button
          size="sm"
          variant={allHistory ? 'secondary' : 'outline'}
          onClick={() => selectPeriod('all')}
        >
          {t('igAgent.backfillDays3650')}
        </Button>
      </div>
      <div className="mt-3 flex flex-wrap items-end gap-3 text-sm">
        <label className="text-muted-foreground grid gap-1 text-xs">
          {t('igAgent.backfillFrom')}
          <input
            type="date"
            value={fromDate}
            max={toDate || today}
            disabled={allHistory}
            onChange={(event) => {
              setAllHistory(false);
              setFromDate(event.target.value);
            }}
            className="border-border bg-background text-foreground rounded-md border px-2 py-1.5 text-sm"
          />
        </label>
        <label className="text-muted-foreground grid gap-1 text-xs">
          {t('igAgent.backfillTo')}
          <input
            type="date"
            value={toDate}
            min={fromDate || undefined}
            max={today}
            onChange={(event) => {
              setAllHistory(false);
              setToDate(event.target.value);
            }}
            className="border-border bg-background text-foreground rounded-md border px-2 py-1.5 text-sm"
          />
        </label>
      </div>
      {surfaces.includes('comments') && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted-foreground text-xs">
            {t('igAgent.backfillChannels')}
          </span>
          <label
            className={cn(
              'border-border flex cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs transition-colors',
              channels.includes('ig_comment')
                ? 'border-accent-ink/35 bg-accent/40 text-foreground'
                : 'text-muted-foreground hover:bg-accent/20',
              !commentAvailable('ig_comment') && 'cursor-not-allowed opacity-45'
            )}
          >
            <input
              className="accent-primary"
              type="checkbox"
              checked={channels.includes('ig_comment')}
              disabled={!commentAvailable('ig_comment')}
              onChange={() => toggleChannel('ig_comment')}
            />
            {t('igAgent.network_instagram')}
          </label>
          <label
            className={cn(
              'border-border flex cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs transition-colors',
              channels.includes('fb_comment')
                ? 'border-accent-ink/35 bg-accent/40 text-foreground'
                : 'text-muted-foreground hover:bg-accent/20',
              !commentAvailable('fb_comment') && 'cursor-not-allowed opacity-45'
            )}
          >
            <input
              className="accent-primary"
              type="checkbox"
              checked={channels.includes('fb_comment')}
              disabled={!commentAvailable('fb_comment')}
              onChange={() => toggleChannel('fb_comment')}
            />
            {t('igAgent.network_facebook')}
          </label>
          <label
            className={cn(
              'border-border flex cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs transition-colors',
              channels.includes('tiktok_comment')
                ? 'border-accent-ink/35 bg-accent/40 text-foreground'
                : 'text-muted-foreground hover:bg-accent/20',
              !commentAvailable('tiktok_comment') &&
                'cursor-not-allowed opacity-45'
            )}
          >
            <input
              className="accent-primary"
              type="checkbox"
              checked={channels.includes('tiktok_comment')}
              disabled={!commentAvailable('tiktok_comment')}
              onChange={() => toggleChannel('tiktok_comment')}
            />
            {t('igAgent.network_tiktok')}
          </label>
        </div>
      )}
      {surfaces.includes('messages') && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-muted-foreground text-xs">
              {t('igAgent.backfillMessageChannels')}
            </span>
            {(
              [
                ['instagram', 'igAgent.network_instagram'],
                ['facebook', 'igAgent.network_facebook'],
              ] as const
            ).map(([channel, label]) => (
              <label
                key={channel}
                className={cn(
                  'border-border flex cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs transition-colors',
                  messageChannels.includes(channel)
                    ? 'border-accent-ink/35 bg-accent/40 text-foreground'
                    : 'text-muted-foreground hover:bg-accent/20',
                  !messageAvailable(channel) && 'cursor-not-allowed opacity-45'
                )}
              >
                <input
                  className="accent-primary"
                  type="checkbox"
                  checked={messageChannels.includes(channel)}
                  disabled={!messageAvailable(channel)}
                  onChange={() => toggleMessageChannel(channel)}
                />
                {t(label)}
              </label>
            ))}
          </div>
          {capabilities?.messages.whatsapp.connected && (
            <div className="border-border bg-muted/30 flex items-start gap-2 rounded-lg border px-2.5 py-2 text-xs leading-5">
              <span className="text-foreground shrink-0 font-medium">
                {t('igAgent.backfillWhatsApp')}
              </span>
              <p className="text-muted-foreground">
                {capabilities.messages.whatsapp.mode === 'coexistence'
                  ? t('igAgent.backfillWhatsAppCoexistence')
                  : t('igAgent.backfillWhatsAppCloud')}
              </p>
            </div>
          )}
        </div>
      )}
      <Button
        className="mt-4"
        size="sm"
        onClick={run}
        disabled={
          running ||
          !surfaces.length ||
          (surfaces.includes('comments') && !channels.length) ||
          (surfaces.includes('messages') && !messageChannels.length) ||
          (!allHistory && (!fromDate || !toDate || fromDate > toDate))
        }
      >
        {running && <Loader2 className="size-3.5 animate-spin" />}
        {running ? t('igAgent.backfillRunning') : t('igAgent.backfillRun')}
      </Button>
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
        if (!cancelled && j) {
          setConnected(
            !!(j.instagram_comments_connected ?? j.instagram_connected)
          );
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);
  return connected;
}
