'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from '@/components/i18n/locale-link';
import { toast } from 'sonner';
import {
  Loader2,
  Target,
  Users,
  Tag,
  MessageCircle,
  TrendingUp,
  CornerDownRight,
  ShoppingBag,
  RefreshCw,
  Wand2,
  Radio,
  Save,
  Trash2,
  Check,
  Send,
  Receipt,
  Rocket,
  SlidersHorizontal,
  AlertTriangle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { InstagramIcon } from '@/components/layout/instagram-icon';
import { CommentToDmPanel } from '@/components/settings/comment-to-dm-panel';
import { useFetchWithCsrf } from '@/lib/api/fetch-with-csrf';
import { useLocalizedRouter } from '@/hooks/use-localized-router';
import { useT } from '@/hooks/use-locale';
import { useFormat } from '@/hooks/use-format';
import { cn } from '@/lib/utils';
import type { InstagramPlan, CampaignStatus } from '@/lib/instagram-agent/types';

interface PlanContext {
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
}

const STATUS_LABEL: Record<CampaignStatus, string> = {
  draft: 'igAgent.statusDraft',
  active: 'igAgent.statusActive',
  paused: 'igAgent.statusPaused',
  done: 'igAgent.statusDone',
};

/** Example goal prompts (empty-state chips). */
const EXAMPLES = [
  'igAgent.example1',
  'igAgent.example2',
  'igAgent.example3',
  'igAgent.example4',
];

export default function InstagramAgentPage() {
  const fetchWithCsrf = useFetchWithCsrf();
  const router = useLocalizedRouter();
  const t = useT();
  const fmt = useFormat();
  const [goal, setGoal] = useState('');
  const [loading, setLoading] = useState(false);
  const [plan, setPlan] = useState<InstagramPlan | null>(null);
  const [context, setContext] = useState<PlanContext | null>(null);
  const [saving, setSaving] = useState<'draft' | 'launch' | null>(null);
  const [holdoutPct, setHoldoutPct] = useState(10);
  const [agentId, setAgentId] = useState<string | null>(null);
  const [campaigns, setCampaigns] = useState<CampaignRow[]>([]);

  const loadCampaigns = useCallback(async () => {
    try {
      const res = await fetch('/api/ai/instagram-agent/campaigns', {
        cache: 'no-store',
      });
      const json = await res.json();
      if (res.ok) setCampaigns((json.campaigns ?? []) as CampaignRow[]);
    } catch {
      /* silencioso: la lista es secundaria */
    }
  }, []);

  // Cheap context snapshot on mount so the goal box + the "thinking" states
  // can show real numbers (reachable audience, catalog) before generating.
  useEffect(() => {
    let cancelled = false;
    fetch('/api/ai/instagram-agent/context', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!cancelled && j) {
          const ctx = j as PlanContext;
          setContext(ctx);
          setAgentId(ctx.default_agent_id ?? null);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    loadCampaigns();
  }, [loadCampaigns]);

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
        ai_agent_id: agentId,
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
        loadCampaigns();
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
        loadCampaigns();
        router.push(`/agente-instagram/${id}`);
        return;
      }
      toast.success(t('igAgent.toastCampaignLaunched'));
      router.push(`/agente-instagram/${id}`);
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
      setCampaigns((prev) => prev.filter((c) => c.id !== id));
    } catch {
      toast.error(t('igAgent.errorNetwork'));
    }
  }

  async function generate() {
    const trimmed = goal.trim();
    if (!trimmed) {
      toast.error(t('igAgent.errorDescribeGoal'));
      return;
    }
    setLoading(true);
    try {
      const res = await fetchWithCsrf('/api/ai/instagram-agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ goal: trimmed }),
      });
      const json = await res.json();
      if (!res.ok) {
        toast.error(json.error ?? t('igAgent.errorGeneratePlan'));
        return;
      }
      setPlan(json.plan as InstagramPlan);
      setContext((prev) => ({ ...prev, ...(json.context as PlanContext) }));
    } catch {
      toast.error(t('igAgent.errorNetwork'));
    } finally {
      setLoading(false);
    }
  }

  // Previsualiza el DM reemplazando el token de nombre por el ejemplo.
  const messagePreview = plan
    ? plan.message.text.replace(
        /\{\{\s*(nombre|name|1)\s*\}\}/gi,
        plan.message.preview_name,
      )
    : '';

  const showEmptyState = !plan && !loading;
  const busy = saving !== null;

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      {/* Cabecera — glifo + título + estado real de la conexión */}
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-[#5b51d8] via-[#c13584] to-[#f58529] text-white shadow-sm">
            <InstagramIcon className="h-5 w-5" />
          </span>
          <h1 className="app-page-title">{t('igAgent.title')}</h1>
        </div>
        <ConnectionPill connected={context?.instagram_connected} />
      </header>

      {/* Lo que espera tu decisión va primero. */}
      <ApprovalsQueue />

      {/* 1 — Nueva campaña */}
      <section className="space-y-3">
        <div className="app-section-head">
          <h2 className="text-sm font-medium text-foreground">
            {t('igAgent.newCampaign')}
          </h2>
          <ReachChip context={context} />
        </div>

        <div className="group relative overflow-hidden rounded-2xl border border-border bg-card shadow-sm transition-all focus-within:border-accent-ink/40 focus-within:shadow-md">
          {/* Hairline con degradado de Instagram, sutil, para anclar la marca */}
          <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[#c13584]/60 to-transparent" />
          <div className="p-5 sm:p-6">
            <Textarea
              id="goal"
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              rows={3}
              maxLength={2000}
              placeholder={t('igAgent.goalPlaceholder')}
              className="resize-none border-0 bg-transparent px-0 text-[15px] leading-relaxed shadow-none focus-visible:ring-0 dark:bg-transparent"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  if (!loading) generate();
                }
              }}
            />

            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
              <span className="text-[11px] text-muted-foreground">
                {t('igAgent.generateHint')}
              </span>
              <Button size="lg" onClick={generate} disabled={loading}>
                {loading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    {t('igAgent.designing')}
                  </>
                ) : (
                  <>
                    <Wand2 className="h-4 w-4" />
                    {plan
                      ? t('igAgent.regeneratePlan')
                      : t('igAgent.generatePlan')}
                  </>
                )}
              </Button>
            </div>
          </div>
        </div>

        {/* Ejemplos — chips ligeros, solo en el estado inicial */}
        {showEmptyState && (
          <div className="grid gap-2 sm:grid-cols-2">
            {EXAMPLES.map((key, i) => (
              <button
                key={i}
                type="button"
                onClick={() => setGoal(t(key))}
                className="rounded-xl border border-border bg-card px-3.5 py-2.5 text-left text-[13px] leading-snug text-muted-foreground transition-colors hover:border-accent-ink/40 hover:text-foreground"
              >
                {t(key)}
              </button>
            ))}
          </div>
        )}
      </section>

      {/* El agente trabajando — estados en vivo. */}
      {loading && (
        <AgentThinking
          audience={context?.reachable_now ?? context?.instagram_reachable}
          productCount={context?.product_count}
        />
      )}

      {/* 2 — Plan generado */}
      {plan && (
        <section className="space-y-4">
          {/* Encabezado de campaña + embudo */}
          <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="app-eyebrow">{t('igAgent.proposedCampaign')}</p>
                <h2 className="mt-1 text-lg font-semibold text-foreground">
                  {plan.campaign_name}
                </h2>
                <p className="mt-1.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Users className="h-3.5 w-3.5" />
                  {plan.audience.description}
                </p>
                <p className="mt-1 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  <Radio className="h-3.5 w-3.5 text-accent-ink" />
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

            {/* Embudo estimado — al estilo de la atribución de Métricas */}
            <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
              <FunnelStat
                icon={<MessageCircle className="h-3.5 w-3.5" />}
                label={t('igAgent.funnelContacted')}
                value={fmt.number(plan.funnel.contacted)}
              />
              <FunnelStat
                icon={<CornerDownRight className="h-3.5 w-3.5" />}
                label={t('igAgent.funnelReplies')}
                value={fmt.number(plan.funnel.replies)}
              />
              <FunnelStat
                icon={<Tag className="h-3.5 w-3.5" />}
                label={t('igAgent.funnelConversions')}
                value={fmt.number(plan.funnel.conversions)}
              />
              <FunnelStat
                icon={<TrendingUp className="h-3.5 w-3.5" />}
                label={t('igAgent.funnelEstRevenue')}
                value={plan.funnel.est_revenue}
                highlight
              />
            </div>
            <p className="mt-2 text-[10px] text-muted-foreground">
              {t('igAgent.estimatesDisclaimer')}
            </p>
          </div>

          <div className="grid gap-4 lg:grid-cols-5">
            {/* Vista previa del DM de Instagram */}
            <div className="rounded-2xl border border-border bg-card p-5 shadow-sm lg:col-span-3">
              <p className="mb-3 flex items-center gap-1.5 text-sm font-medium text-foreground">
                <InstagramIcon className="h-4 w-4" />
                {t('igAgent.instagramDm')}
              </p>
              <div className="rounded-xl bg-[#0b0b0f] p-3">
                {/* Cabecera de chat tipo Instagram para que la vista previa
                    se lea como una conversación real. */}
                <div className="mb-2.5 flex items-center gap-2 border-b border-white/10 pb-2.5">
                  <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-gradient-to-br from-[#5b51d8] via-[#c13584] to-[#f58529] text-[11px] font-semibold text-white">
                    {plan.message.preview_name.slice(0, 1).toUpperCase()}
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-xs font-medium text-white">
                      {plan.message.preview_name}
                    </p>
                    <p className="text-[10px] text-white/40">Instagram · DM</p>
                  </div>
                </div>
                <div className="ml-auto max-w-[85%] rounded-2xl rounded-br-md bg-gradient-to-br from-[#5b51d8] to-[#c13584] px-3 py-2 text-[13px] leading-relaxed text-white whitespace-pre-wrap">
                  {messagePreview}
                </div>
                {plan.offer && (
                  <div className="ml-auto mt-1.5 max-w-[85%] rounded-2xl rounded-br-md bg-gradient-to-br from-[#5b51d8] to-[#c13584] px-3 py-2 text-[13px] text-white">
                    🎁 {t('igAgent.offerCodeLabel')}{' '}
                    <span className="font-semibold">{plan.offer.code}</span> —{' '}
                    {plan.offer.discount}
                  </div>
                )}
              </div>
              <p className="mt-2 text-[10px] text-muted-foreground">
                {t('igAgent.dmBaseNote', { name: plan.message.preview_name })}
              </p>

              {/* Follow-up */}
              <div className="mt-4">
                <p className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-foreground">
                  <CornerDownRight className="h-3.5 w-3.5 text-muted-foreground" />
                  {t('igAgent.followUpIfNoReply')}
                </p>
                <p className="rounded-lg border border-dashed border-border bg-muted/40 px-3 py-2 text-[13px] text-muted-foreground whitespace-pre-wrap">
                  {plan.follow_up.replace(
                    /{{s*(nombre|name|1)s*}}/gi,
                    plan.message.preview_name,
                  )}
                </p>
              </div>

              {/* Respuesta pública a comentarios de alta intención */}
              {plan.comment_reply && (
                <div className="mt-4">
                  <p className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-foreground">
                    <MessageCircle className="h-3.5 w-3.5 text-[#E1306C]" />
                    {t('igAgent.highIntentCommentReply')}
                  </p>
                  <p className="rounded-lg border border-dashed border-border bg-muted/40 px-3 py-2 text-[13px] text-muted-foreground whitespace-pre-wrap">
                    {plan.comment_reply}
                  </p>
                  <p className="mt-1 text-[10px] text-muted-foreground">
                    {t('igAgent.commentToDmNote')}
                  </p>
                </div>
              )}
            </div>

            {/* Oferta + productos + pasos */}
            <div className="space-y-4 lg:col-span-2">
              {plan.offer && (
                <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
                  <p className="mb-2 flex items-center gap-1.5 text-sm font-medium text-foreground">
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
                  <p className="mt-2 text-xs text-muted-foreground">
                    {plan.offer.conditions}
                  </p>
                </div>
              )}

              {plan.recommended_products.length > 0 && (
                <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
                  <p className="mb-2 flex items-center gap-1.5 text-sm font-medium text-foreground">
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

              <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
                <p className="mb-2 flex items-center gap-1.5 text-sm font-medium text-foreground">
                  <Target className="h-4 w-4 text-accent-ink" />
                  {t('igAgent.nextSteps')}
                </p>
                <ol className="space-y-1.5">
                  {plan.next_steps.map((s, i) => (
                    <li
                      key={i}
                      className="flex gap-2 text-xs text-muted-foreground"
                    >
                      <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-accent/50 text-[10px] font-semibold text-accent-ink">
                        {i + 1}
                      </span>
                      {s}
                    </li>
                  ))}
                </ol>
              </div>
            </div>
          </div>

          {/* Acciones — una sola fila, con la acción principal a la derecha */}
          <div className="flex flex-wrap items-center justify-end gap-2 rounded-2xl border border-border bg-card p-3 shadow-sm">
            {(context?.agents?.length ?? 0) > 1 && (
              <label className="flex items-center gap-2 text-[11px] text-muted-foreground">
                <span>{t('igAgent.voiceLabel')}</span>
                <select
                  value={agentId ?? ''}
                  onChange={(e) => setAgentId(e.target.value || null)}
                  className="max-w-52 truncate rounded-md border border-border bg-background px-1.5 py-1 text-xs text-foreground"
                  title={t('igAgent.voiceHint')}
                >
                  {context?.agents?.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label className="mr-auto flex items-center gap-2 text-[11px] text-muted-foreground">
              <span>{t('igAgent.holdoutLabel')}</span>
              <select
                value={holdoutPct}
                onChange={(e) => setHoldoutPct(Number(e.target.value))}
                className="rounded-md border border-border bg-background px-1.5 py-1 text-xs text-foreground"
                title={t('igAgent.holdoutTitle')}
              >
                {[0, 5, 10, 20].map((p) => (
                  <option key={p} value={p}>
                    {p}%
                  </option>
                ))}
              </select>
            </label>
            <Button variant="ghost" onClick={generate} disabled={loading || busy}>
              <RefreshCw className="h-4 w-4" />
              {t('igAgent.regenerate')}
            </Button>
            <Button variant="outline" onClick={saveDraft} disabled={busy}>
              {saving === 'draft' ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Save className="h-4 w-4" />
              )}
              {t('igAgent.saveDraft')}
            </Button>
            <Button onClick={saveAndLaunch} disabled={busy}>
              {saving === 'launch' ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Rocket className="h-4 w-4" />
              )}
              {t('igAgent.saveAndLaunch')}
            </Button>
          </div>
        </section>
      )}

      {/* 3 — Campañas */}
      <CampaignsSection campaigns={campaigns} onDelete={deleteCampaign} />

      {/* 4 — Automatización: modo, freno de emergencia, tope y reglas */}
      <section className="space-y-3">
        <div className="app-section-head">
          <h2 className="flex items-center gap-1.5 text-sm font-medium text-foreground">
            <SlidersHorizontal className="h-4 w-4 text-muted-foreground" />
            {t('igAgent.automationSection')}
          </h2>
        </div>
        <ProactiveControls />
        <CommentToDmPanel />
      </section>

      {/* 5 — Resultados */}
      <AttributedOrders />
    </div>
  );
}

/** Estado de la conexión de Instagram: sin ella, nada de esto envía. */
function ConnectionPill({ connected }: { connected?: boolean }) {
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
 * Cuánta gente puede recibir un mensaje AHORA. Meta abre dos ventanas —24h
 * desde un DM, 7 días desde un comentario— y solo dentro de ellas se puede
 * escribir; el histórico completo no es alcance real.
 */
function ReachChip({ context }: { context: PlanContext | null }) {
  const t = useT();
  const fmt = useFormat();
  if (!context) return null;
  const now = context.reachable_now ?? 0;
  const dm = context.in_window_24h ?? 0;
  const comments = context.comment_window_7d ?? 0;

  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-2.5 py-1 text-[11px] text-muted-foreground"
      title={t('igAgent.reachHint', {
        dm: fmt.number(dm),
        comments: fmt.number(comments),
        total: fmt.number(context.instagram_reachable),
      })}
    >
      <span className="relative flex h-1.5 w-1.5">
        {now > 0 && (
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500/60" />
        )}
        <span
          className={cn(
            'relative inline-flex h-1.5 w-1.5 rounded-full',
            now > 0 ? 'bg-emerald-500' : 'bg-muted-foreground/40',
          )}
        />
      </span>
      <span className="font-semibold text-foreground tabular-nums">
        {fmt.number(now)}
      </span>
      {t('igAgent.reachableNow')}
    </span>
  );
}

/** Lista de campañas guardadas + estado vacío que explica el flujo. */
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
        <ol className="grid gap-2 sm:grid-cols-3">
          {[
            ['igAgent.howStep1Title', 'igAgent.howStep1Desc'],
            ['igAgent.howStep2Title', 'igAgent.howStep2Desc'],
            ['igAgent.howStep3Title', 'igAgent.howStep3Desc'],
          ].map(([title, desc], i) => (
            <li
              key={title}
              className="rounded-xl border border-border bg-card p-3.5"
            >
              <p className="flex items-center gap-2 text-[13px] font-medium text-foreground">
                <span className="flex h-4 w-4 items-center justify-center rounded-full bg-accent/50 text-[10px] font-semibold text-accent-ink">
                  {i + 1}
                </span>
                {t(title)}
              </p>
              <p className="mt-1 text-[11px] leading-snug text-muted-foreground">
                {t(desc)}
              </p>
            </li>
          ))}
        </ol>
      ) : (
        <ul className="divide-y divide-border rounded-2xl border border-border bg-card px-5 shadow-sm">
          {campaigns.map((c) => (
            <li
              key={c.id}
              className="flex items-center justify-between gap-3 py-2.5"
            >
              <Link
                href={`/agente-instagram/${c.id}`}
                className="min-w-0 flex-1 hover:underline"
              >
                <p className="truncate text-sm font-medium text-foreground">
                  {c.name}
                </p>
                <p className="text-[11px] text-muted-foreground">
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
              <Badge
                variant={
                  c.status === 'active'
                    ? 'default'
                    : c.status === 'paused'
                      ? 'outline'
                      : 'secondary'
                }
                className="shrink-0"
              >
                {t(STATUS_LABEL[c.status])}
              </Badge>
              {confirming === c.id ? (
                <span className="flex shrink-0 items-center gap-1">
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
                  className="inline-flex min-h-9 min-w-9 shrink-0 items-center justify-center rounded-md p-1 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
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
    const t = setTimeout(
      () => setActive((a) => Math.min(a + 1, steps.length - 1)),
      850,
    );
    return () => clearTimeout(t);
  }, [active, steps.length]);

  return (
    <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
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

type SendMode = 'auto' | 'hybrid_intent' | 'approval';

const MODE_DESC: Record<SendMode, string> = {
  auto: 'igAgent.modeAutoDesc',
  hybrid_intent: 'igAgent.modeHybridDesc',
  approval: 'igAgent.modeApprovalDesc',
};

/**
 * Controles del agente proactivo: cuánto envía solo, el freno de emergencia y
 * el tope diario. Cada control con su etiqueta visible — antes era una fila de
 * botones y un campo numérico sin nombre.
 */
function ProactiveControls() {
  const t = useT();
  const fetchWithCsrf = useFetchWithCsrf();
  const [paused, setPaused] = useState(false);
  const [cap, setCap] = useState(500);
  const [mode, setMode] = useState<SendMode>('auto');
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/ai/instagram-agent/settings', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!cancelled && j) {
          setPaused(!!j.paused);
          setCap(Number(j.daily_cap) || 500);
          if (j.send_mode) setMode(j.send_mode as SendMode);
          setLoaded(true);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  async function save(next: {
    paused?: boolean;
    daily_cap?: number;
    send_mode?: SendMode;
  }) {
    try {
      await fetchWithCsrf('/api/ai/instagram-agent/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(next),
      });
    } catch {
      /* silencioso */
    }
  }

  if (!loaded) return null;

  const MODES: { v: SendMode; label: string }[] = [
    { v: 'auto', label: t('igAgent.modeAuto') },
    { v: 'hybrid_intent', label: t('igAgent.modeHybrid') },
    { v: 'approval', label: t('igAgent.modeApproval') },
  ];

  return (
    <div
      className={cn(
        'rounded-2xl border p-4 shadow-sm transition-colors',
        paused ? 'border-destructive/40 bg-destructive/5' : 'border-border bg-card',
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-[13px] font-medium text-foreground">
            {t('igAgent.modeLabel')}
          </p>
          <div className="mt-1.5 inline-flex items-center gap-0.5 rounded-lg border border-border bg-background p-0.5">
            {MODES.map((m) => (
              <button
                key={m.v}
                type="button"
                onClick={() => {
                  setMode(m.v);
                  save({ send_mode: m.v });
                }}
                className={cn(
                  'rounded-md px-2.5 py-1 text-[12px] font-medium transition-colors',
                  mode === m.v
                    ? 'bg-accent text-accent-ink'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {m.label}
              </button>
            ))}
          </div>
          <p className="mt-1.5 text-[11px] text-muted-foreground">
            {t(MODE_DESC[mode])}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-5">
          <label className="flex flex-col gap-1.5 text-[13px]">
            <span className="font-medium text-foreground">
              {t('igAgent.controlsDailyCap')}
            </span>
            <input
              type="number"
              min={0}
              max={10000}
              value={cap}
              onChange={(e) => setCap(Number(e.target.value))}
              onBlur={() => save({ daily_cap: cap })}
              title={t('igAgent.controlsDailyCapHint')}
              className="w-20 rounded-md border border-border bg-background px-2 py-1 tabular-nums text-foreground"
            />
          </label>

          <label
            className="flex flex-col gap-1.5 text-[13px]"
            title={t('igAgent.controlsPauseHint')}
          >
            <span
              className={cn(
                'font-medium',
                paused ? 'text-destructive' : 'text-foreground',
              )}
            >
              {paused ? t('igAgent.controlsPausedOn') : t('igAgent.controlsPause')}
            </span>
            <Switch
              checked={paused}
              onCheckedChange={(v) => {
                setPaused(v);
                save({ paused: v });
              }}
            />
          </label>
        </div>
      </div>
    </div>
  );
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

const ORDER_SOURCE_LABEL: Record<string, string> = {
  campaign: 'igAgent.orderSourceCampaign',
  agent: 'igAgent.orderSourceAgent',
  comment_to_dm: 'igAgent.orderSourceCommentToDm',
  ctwa: 'igAgent.orderSourceCtwa',
};

/**
 * Order-attribution ledger (migration 094): the orders that happened thanks to
 * the Instagram engine, with source + revenue and the attributed total. Hidden
 * when empty.
 */
function AttributedOrders() {
  const t = useT();
  const fmt = useFormat();
  const [orders, setOrders] = useState<AttributedOrder[]>([]);
  const [total, setTotal] = useState(0);
  const [currency, setCurrency] = useState('USD');

  useEffect(() => {
    let cancelled = false;
    fetch('/api/ai/instagram-agent/attributed-orders', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!cancelled && j) {
          setOrders((j.orders ?? []) as AttributedOrder[]);
          setTotal(Number(j.total_revenue) || 0);
          setCurrency(j.currency ?? 'USD');
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  if (orders.length === 0) return null;

  return (
    <section className="rounded-2xl border border-border bg-card p-5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="mb-0.5 flex items-center gap-1.5 text-sm font-medium text-foreground">
            <Receipt className="h-4 w-4 text-accent-ink" />
            {t('igAgent.attributedOrdersTitle')}
          </p>
          <p className="text-[11px] text-muted-foreground">
            {t('igAgent.attributedOrdersHint')}
          </p>
        </div>
        <div className="text-right">
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
            {t('igAgent.attributedOrdersTotal')}
          </p>
          <p className="text-lg font-semibold tabular-nums text-accent-ink">
            {fmt.currency(total, currency)}
          </p>
        </div>
      </div>
      <ul className="mt-3 divide-y divide-border">
        {orders.slice(0, 8).map((o) => (
          <li
            key={o.shopify_order_id}
            className="flex items-center justify-between gap-3 py-2"
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

interface ApprovalRow {
  id: string;
  draft_text: string;
  discount_code: string | null;
  lead_score: string | null;
  created_at: string;
  contact_name: string | null;
  campaign_name: string | null;
  /** Ventana de Meta agotada (se marca al cargar la cola). */
  expired?: boolean;
}

/** Ventana máxima de Meta para una respuesta privada a un comentario. */
const COMMENT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/** Pasada la ventana de Meta el envío ya no es posible. Se calcula al cargar
 *  (no en render) para no depender del reloj en cada repintado. */
function markExpired(rows: ApprovalRow[]): ApprovalRow[] {
  const now = Date.now();
  return rows.map((r) => ({
    ...r,
    expired: now - new Date(r.created_at).getTime() > COMMENT_WINDOW_MS,
  }));
}

/**
 * Proactive DMs the agent drafted and held for review (agent's
 * proactive_send_mode = approval, or hybrid for a non-high lead). The merchant
 * edits, then approves (sends) or discards. Hidden entirely when empty.
 */
function ApprovalsQueue() {
  const t = useT();
  const fetchWithCsrf = useFetchWithCsrf();
  const [items, setItems] = useState<ApprovalRow[]>([]);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/ai/instagram-agent/approvals', {
        cache: 'no-store',
      });
      const json = await res.json();
      if (res.ok) setItems(markExpired((json.approvals ?? []) as ApprovalRow[]));
    } catch {
      /* la cola es secundaria */
    }
  }, []);

  // Initial fetch — defer setState into the promise callback (not a synchronous
  // call in the effect body) to keep renders from cascading.
  useEffect(() => {
    let cancelled = false;
    fetch('/api/ai/instagram-agent/approvals', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!cancelled && j)
          setItems(markExpired((j.approvals ?? []) as ApprovalRow[]));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  async function act(
    id: string,
    action: 'approve' | 'reject',
    text?: string,
  ) {
    setItems((prev) => prev.filter((x) => x.id !== id));
    try {
      const res = await fetchWithCsrf(
        `/api/ai/instagram-agent/approvals/${id}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action, text }),
        },
      );
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(json.error ?? t('igAgent.approvalError'));
        load();
      } else if (action === 'approve') {
        // El envío puede caerse por la ventana de Meta ya cerrada: decirlo,
        // no cantar un "enviado" que no ocurrió.
        if (json.status === 'skipped') {
          toast.error(t('igAgent.approvalWindowClosed'));
        } else {
          toast.success(t('igAgent.approvalSent'));
        }
      }
    } catch {
      toast.error(t('igAgent.approvalError'));
      load();
    }
  }

  if (items.length === 0) return null;

  return (
    <section className="rounded-2xl border border-amber-500/30 bg-amber-500/[0.03] p-5 shadow-sm">
      <p className="mb-1 flex items-center gap-1.5 text-sm font-medium text-foreground">
        <MessageCircle className="h-4 w-4 text-amber-500" />
        {t('igAgent.approvalsTitle')}
        <span className="ml-1 rounded-full bg-amber-500/15 px-1.5 text-[11px] font-semibold text-amber-700 tabular-nums dark:text-amber-300">
          {items.length}
        </span>
      </p>
      <p className="text-[11px] text-muted-foreground">
        {t('igAgent.approvalsHint')}
      </p>
      <ul className="mt-3 space-y-3">
        {items.map((it) => (
          <ApprovalItem key={it.id} item={it} onAct={act} />
        ))}
      </ul>
    </section>
  );
}

function ApprovalItem({
  item,
  onAct,
}: {
  item: ApprovalRow;
  onAct: (id: string, action: 'approve' | 'reject', text?: string) => void;
}) {
  const t = useT();
  const fmt = useFormat();
  const [text, setText] = useState(item.draft_text);
  const name = item.contact_name ?? t('igAgent.approvalUnknownContact');
  // Fuera de la ventana de Meta no ofrecemos un botón que solo puede fallar.
  const expired = item.expired === true;

  return (
    <li className="rounded-xl border border-border bg-background p-3">
      <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
        <p className="truncate text-xs font-medium text-foreground">
          {t('igAgent.approvalTo', { name })}
        </p>
        <span className="shrink-0 text-[11px] text-muted-foreground">
          {item.campaign_name ? `${item.campaign_name} · ` : ''}
          {fmt.date(item.created_at, { day: 'numeric', month: 'short' })}
        </span>
      </div>
      <Textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={3}
        maxLength={950}
        disabled={expired}
        className="resize-none text-[13px]"
      />
      {expired && (
        <p className="mt-1.5 flex items-center gap-1.5 text-[11px] text-destructive">
          <AlertTriangle className="h-3 w-3 shrink-0" />
          {t('igAgent.approvalExpired')}
        </p>
      )}
      <div className="mt-2 flex items-center justify-end gap-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onAct(item.id, 'reject')}
        >
          <Trash2 className="h-3.5 w-3.5" />
          {expired ? t('igAgent.approvalDismiss') : t('igAgent.approvalReject')}
        </Button>
        {!expired && (
          <Button
            size="sm"
            onClick={() => onAct(item.id, 'approve', text.trim())}
            disabled={!text.trim()}
          >
            <Send className="h-3.5 w-3.5" />
            {t('igAgent.approvalApprove')}
          </Button>
        )}
      </div>
    </li>
  );
}

function FunnelStat({
  icon,
  label,
  value,
  highlight = false,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div
      className={cn(
        'rounded-lg border p-2.5',
        highlight
          ? 'border-accent-ink/30 bg-accent/30'
          : 'border-border bg-background',
      )}
    >
      <p className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-muted-foreground">
        {icon}
        {label}
      </p>
      <p
        className={cn(
          'mt-1 text-base font-semibold tabular-nums',
          highlight ? 'text-accent-ink' : 'text-foreground',
        )}
      >
        {value}
      </p>
    </div>
  );
}
