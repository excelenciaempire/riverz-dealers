'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from '@/components/i18n/locale-link';
import { toast } from 'sonner';
import {
  Sparkles,
  Loader2,
  Target,
  Users,
  Tag,
  MessageCircle,
  TrendingUp,
  CornerDownRight,
  ShoppingBag,
  ArrowRight,
  RefreshCw,
  Wand2,
  Radio,
  Save,
  Trash2,
  Check,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { InstagramIcon } from '@/components/layout/instagram-icon';
import { useFetchWithCsrf } from '@/lib/api/fetch-with-csrf';
import { useT } from '@/hooks/use-locale';
import { useFormat } from '@/hooks/use-format';
import { cn } from '@/lib/utils';
import type { InstagramPlan, CampaignStatus } from '@/lib/instagram-agent/types';

interface PlanContext {
  total_contacts: number;
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

/** Examples paired with the engagement signal each one taps into. */
const EXAMPLES = [
  { key: 'igAgent.example1', icon: MessageCircle },
  { key: 'igAgent.example2', icon: ShoppingBag },
  { key: 'igAgent.example3', icon: TrendingUp },
];

/** The agent's job, in three editorial beats (empty-state explainer). */
const HOW_STEPS = [
  { icon: Target, t: 'igAgent.howStep1Title', d: 'igAgent.howStep1Desc' },
  { icon: Sparkles, t: 'igAgent.howStep2Title', d: 'igAgent.howStep2Desc' },
  { icon: TrendingUp, t: 'igAgent.howStep3Title', d: 'igAgent.howStep3Desc' },
];

export default function InstagramAgentPage() {
  const fetchWithCsrf = useFetchWithCsrf();
  const t = useT();
  const fmt = useFormat();
  const [goal, setGoal] = useState('');
  const [loading, setLoading] = useState(false);
  const [plan, setPlan] = useState<InstagramPlan | null>(null);
  const [context, setContext] = useState<PlanContext | null>(null);
  const [saving, setSaving] = useState(false);
  const [holdoutPct, setHoldoutPct] = useState(10);
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
        if (!cancelled && j) setContext(j as PlanContext);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    loadCampaigns();
  }, [loadCampaigns]);

  async function saveCampaign() {
    if (!plan) return;
    setSaving(true);
    try {
      const res = await fetchWithCsrf('/api/ai/instagram-agent/campaigns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ goal: goal.trim(), plan, holdout_pct: holdoutPct }),
      });
      const json = await res.json();
      if (!res.ok) {
        toast.error(json.error ?? t('igAgent.errorSaveCampaign'));
        return;
      }
      toast.success(t('igAgent.toastCampaignSaved'));
      loadCampaigns();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('igAgent.errorNetwork'));
    } finally {
      setSaving(false);
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
      setContext(json.context as PlanContext);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('igAgent.errorNetwork'));
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

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      {/* Cabecera editorial — eyebrow + glifo IG con degradado de marca */}
      <header className="space-y-3">
        <div className="flex items-center gap-3">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-[#5b51d8] via-[#c13584] to-[#f58529] text-white shadow-sm">
            <InstagramIcon className="h-5 w-5" />
          </span>
          <div>
            <p className="app-eyebrow">{t('igAgent.eyebrow')}</p>
            <h1 className="app-page-title">{t('igAgent.title')}</h1>
          </div>
        </div>
        <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
          {t('igAgent.subtitle')}
        </p>
      </header>

      {/* Compositor de objetivo — la pieza central */}
      <div className="group relative overflow-hidden rounded-2xl border border-border bg-card shadow-sm transition-all focus-within:border-accent-ink/40 focus-within:shadow-md">
        {/* Hairline con degradado de Instagram, sutil, para anclar la marca */}
        <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[#c13584]/60 to-transparent" />
        <div className="p-5 sm:p-6">
          <div className="mb-3 flex items-center justify-between gap-3">
            <label
              htmlFor="goal"
              className="flex items-center gap-2 text-sm font-medium text-foreground"
            >
              <Target className="h-4 w-4 text-accent-ink" />
              {t('igAgent.goalLabel')}
            </label>
            <span className="hidden items-center gap-1.5 rounded-full border border-border bg-background px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground sm:inline-flex">
              <Sparkles className="h-3 w-3 text-accent-ink" />
              {t('igAgent.poweredByAi')}
            </span>
          </div>

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

          {/* Pie: señales reales (audiencia + catálogo) + CTA */}
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
            <div className="flex flex-wrap items-center gap-2">
              {context ? (
                <>
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-2.5 py-1 text-[11px] text-muted-foreground">
                    <span className="relative flex h-1.5 w-1.5">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500/60" />
                      <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
                    </span>
                    <Users className="h-3.5 w-3.5" />
                    <span className="font-semibold text-foreground tabular-nums">
                      {fmt.number(context.total_contacts)}
                    </span>
                    {t('igAgent.reachablePeople')}
                  </span>
                  {context.has_catalog && (
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-2.5 py-1 text-[11px] text-muted-foreground">
                      <ShoppingBag className="h-3.5 w-3.5" />
                      {t('igAgent.catalogConnected')}
                    </span>
                  )}
                </>
              ) : (
                <span className="text-[11px] text-muted-foreground">
                  {t('igAgent.groundedInAudience')}
                </span>
              )}
            </div>
            <div className="flex items-center gap-3">
              <span className="hidden text-[11px] text-muted-foreground sm:inline">
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
                    {plan ? t('igAgent.regeneratePlan') : t('igAgent.generatePlan')}
                  </>
                )}
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Sugerencias de ejemplo — solo en el estado inicial */}
      {showEmptyState && (
        <section>
          <p className="app-eyebrow mb-3 flex items-center gap-1.5">
            <Sparkles className="h-3.5 w-3.5 text-accent-ink" />
            {t('igAgent.startFromExample')}
          </p>
          <div className="grid gap-3 sm:grid-cols-3">
            {EXAMPLES.map(({ key, icon: Icon }, i) => {
              const ex = t(key);
              return (
                <button
                  key={i}
                  type="button"
                  onClick={() => setGoal(ex)}
                  className="group/ex flex h-full flex-col gap-2.5 rounded-xl border border-border bg-card p-4 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:border-accent-ink/40 hover:shadow-md"
                >
                  <span className="grid h-7 w-7 place-items-center rounded-lg bg-accent/50 text-accent-ink transition-colors group-hover/ex:bg-accent">
                    <Icon className="h-3.5 w-3.5" />
                  </span>
                  <span className="text-[13px] leading-relaxed text-muted-foreground transition-colors group-hover/ex:text-foreground">
                    {ex}
                  </span>
                  <ArrowRight className="mt-auto h-3.5 w-3.5 text-accent-ink opacity-0 transition-all group-hover/ex:translate-x-0.5 group-hover/ex:opacity-100" />
                </button>
              );
            })}
          </div>
        </section>
      )}

      {/* El agente trabajando — estados en vivo, al estilo Blueberry. */}
      {loading && (
        <AgentThinking
          audience={context?.total_contacts}
          productCount={context?.product_count}
        />
      )}

      {/* Plan generado */}
      {plan && (
        <div className="space-y-4">
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
                  {plan.follow_up}
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

          {/* Acciones */}
          <div className="flex flex-wrap items-center justify-end gap-2 rounded-2xl border border-border bg-card p-3 shadow-sm">
            <label className="mr-auto flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <span>{t('igAgent.controlHoldout')}</span>
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
            <Button variant="outline" onClick={generate} disabled={loading}>
              <RefreshCw className="h-4 w-4" />
              {t('igAgent.regenerate')}
            </Button>
            <Button
              variant="secondary"
              onClick={saveCampaign}
              disabled={saving}
            >
              {saving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Save className="h-4 w-4" />
              )}
              {t('igAgent.saveCampaign')}
            </Button>
            <Button render={<Link href="/asistente" />}>
              {t('igAgent.activateAgentOnInstagram')}
              <ArrowRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {/* Mis campañas guardadas */}
      {campaigns.length > 0 && (
        <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
          <p className="mb-3 flex items-center gap-1.5 text-sm font-medium text-foreground">
            <Radio className="h-4 w-4 text-accent-ink" />
            {t('igAgent.myCampaigns')}
          </p>
          <ul className="divide-y divide-border">
            {campaigns.map((c) => (
              <li
                key={c.id}
                className="flex items-center justify-between gap-3 py-2"
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
                <button
                  type="button"
                  onClick={() => deleteCampaign(c.id)}
                  aria-label={t('igAgent.deleteCampaign')}
                  className="shrink-0 inline-flex items-center justify-center min-h-9 min-w-9 rounded-md p-1 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Estado vacío / cómo funciona */}
      {showEmptyState && (
        <section className="rounded-2xl border border-border bg-card/60 p-5 sm:p-6">
          <p className="app-eyebrow mb-4">{t('igAgent.howItWorks')}</p>
          <ol className="grid gap-3 sm:grid-cols-3">
            {HOW_STEPS.map((step, i) => {
              const Icon = step.icon;
              return (
                <li
                  key={i}
                  className="relative overflow-hidden rounded-xl border border-border bg-background p-4"
                >
                  <span className="pointer-events-none absolute -right-1 -top-2 text-4xl font-bold tabular-nums text-muted-foreground/10">
                    {`0${i + 1}`}
                  </span>
                  <span className="relative grid h-8 w-8 place-items-center rounded-lg bg-accent/50 text-accent-ink">
                    <Icon className="h-4 w-4" />
                  </span>
                  <p className="relative mt-3 text-sm font-medium text-foreground">
                    {t(step.t)}
                  </p>
                  <p className="relative mt-1 text-xs leading-relaxed text-muted-foreground">
                    {t(step.d)}
                  </p>
                </li>
              );
            })}
          </ol>
        </section>
      )}
    </div>
  );
}

/**
 * Live "agent thinking" panel — Blueberry's signature. While the plan is
 * generating, it walks through believable status steps (grounded in the
 * real audience + catalog numbers) with spinner → check transitions, so the
 * wait reads as the agent actually scanning and working.
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
