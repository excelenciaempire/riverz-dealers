'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
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
  draft: 'Borrador',
  active: 'Activa',
  paused: 'Pausada',
  done: 'Finalizada',
};

const EXAMPLES = [
  'Escribe por DM a quienes comentaron mi último reel de la oferta de junio y ofrece 10% si dudan por precio.',
  'Responde a quienes contestaron mis historias del lanzamiento y captura su email para la lista.',
  'Reactiva por DM a seguidores que interactuaban antes y dejaron de comprar, con un código de bienvenida de vuelta.',
];

export default function InstagramAgentPage() {
  const fetchWithCsrf = useFetchWithCsrf();
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
        toast.error(json.error ?? 'No se pudo guardar la campaña');
        return;
      }
      toast.success('Campaña guardada como borrador');
      loadCampaigns();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error de red');
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
        toast.error('No se pudo eliminar');
        return;
      }
      setCampaigns((prev) => prev.filter((c) => c.id !== id));
    } catch {
      toast.error('Error de red');
    }
  }

  async function generate() {
    const trimmed = goal.trim();
    if (!trimmed) {
      toast.error('Describe el objetivo de tu campaña.');
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
        toast.error(json.error ?? 'No se pudo generar el plan');
        return;
      }
      setPlan(json.plan as InstagramPlan);
      setContext(json.context as PlanContext);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error de red');
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

  return (
    <div className="space-y-5">
      {/* Cabecera */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="app-eyebrow">IA · Instagram</p>
          <h1 className="app-page-title mt-1.5 flex items-center gap-2">
            <InstagramIcon className="h-5 w-5" />
            Agente de Instagram
          </h1>
        </div>
      </div>

      {/* Caja de objetivo */}
      <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
        <label
          htmlFor="goal"
          className="mb-2 flex items-center gap-1.5 text-sm font-medium text-foreground"
        >
          <Target className="h-4 w-4 text-accent-ink" />
          ¿Cuál es tu objetivo?
        </label>
        <Textarea
          id="goal"
          value={goal}
          onChange={(e) => setGoal(e.target.value)}
          rows={3}
          maxLength={2000}
          placeholder="Ej: Vende mi inventario de la oferta de junio. Enfócate en las pulseras y ofrece hasta 10% de descuento si dudan por precio."
          className="resize-none"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              if (!loading) generate();
            }
          }}
        />

        {/* Ejemplos rápidos */}
        <div className="mt-3 flex flex-wrap gap-1.5">
          {EXAMPLES.map((ex, i) => (
            <button
              key={i}
              type="button"
              onClick={() => setGoal(ex)}
              className="rounded-full border border-border bg-background px-2.5 py-1 text-left text-[11px] text-muted-foreground transition-colors hover:border-accent-ink/40 hover:text-foreground"
            >
              {ex.length > 56 ? ex.slice(0, 56) + '…' : ex}
            </button>
          ))}
        </div>

        <div className="mt-4 flex items-center justify-between gap-3">
          <p className="text-[11px] text-muted-foreground">
            {context
              ? `${context.total_contacts} personas alcanzables${
                  context.has_catalog ? ' · catálogo conectado' : ''
                }`
              : 'Aterrizado en tu audiencia y catálogo reales.'}
          </p>
          <Button onClick={generate} disabled={loading}>
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Diseñando…
              </>
            ) : (
              <>
                <Wand2 className="h-4 w-4" />
                {plan ? 'Regenerar plan' : 'Generar plan'}
              </>
            )}
          </Button>
        </div>
      </div>

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
          <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="app-eyebrow">Campaña propuesta</p>
                <h2 className="mt-1 text-lg font-semibold text-foreground">
                  {plan.campaign_name}
                </h2>
                <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Users className="h-3.5 w-3.5" />
                  {plan.audience.description}
                </p>
                <p className="mt-1 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  <Radio className="h-3.5 w-3.5 text-accent-ink" />
                  <span>
                    <span className="font-medium text-foreground">
                      Engagement:
                    </span>{' '}
                    {plan.audience.source}
                  </span>
                </p>
              </div>
              <Badge variant="secondary" className="shrink-0">
                <Users className="mr-1 h-3 w-3" />
                {plan.audience.estimated_reach.toLocaleString()} contactos
              </Badge>
            </div>

            {/* Embudo estimado — al estilo de la atribución de Métricas */}
            <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
              <FunnelStat
                icon={<MessageCircle className="h-3.5 w-3.5" />}
                label="Contactados"
                value={plan.funnel.contacted.toLocaleString()}
              />
              <FunnelStat
                icon={<CornerDownRight className="h-3.5 w-3.5" />}
                label="Respuestas"
                value={plan.funnel.replies.toLocaleString()}
              />
              <FunnelStat
                icon={<Tag className="h-3.5 w-3.5" />}
                label="Conversiones"
                value={plan.funnel.conversions.toLocaleString()}
              />
              <FunnelStat
                icon={<TrendingUp className="h-3.5 w-3.5" />}
                label="Ingresos est."
                value={plan.funnel.est_revenue}
                highlight
              />
            </div>
            <p className="mt-2 text-[10px] text-muted-foreground">
              Estimaciones generadas por IA para orientar la campaña, no cifras
              garantizadas.
            </p>
          </div>

          <div className="grid gap-4 lg:grid-cols-5">
            {/* Vista previa del DM de Instagram */}
            <div className="rounded-xl border border-border bg-card p-4 shadow-sm lg:col-span-3">
              <p className="mb-3 flex items-center gap-1.5 text-sm font-medium text-foreground">
                <InstagramIcon className="h-4 w-4" />
                DM de Instagram
              </p>
              <div className="rounded-xl bg-[#0b0b0f] p-3">
                <div className="ml-auto max-w-[85%] rounded-2xl rounded-br-md bg-gradient-to-br from-[#5b51d8] to-[#c13584] px-3 py-2 text-[13px] leading-relaxed text-white whitespace-pre-wrap">
                  {messagePreview}
                </div>
                {plan.offer && (
                  <div className="ml-auto mt-1.5 max-w-[85%] rounded-2xl rounded-br-md bg-gradient-to-br from-[#5b51d8] to-[#c13584] px-3 py-2 text-[13px] text-white">
                    🎁 Código{' '}
                    <span className="font-semibold">{plan.offer.code}</span> —{' '}
                    {plan.offer.discount}
                  </div>
                )}
              </div>
              <p className="mt-2 text-[10px] text-muted-foreground">
                Este es el DM base. Al enviarse, el agente lo reescribe 1:1
                para cada persona en tu voz de marca, respondiendo a su
                interacción y con su propio código de descuento. Vista previa
                con “{plan.message.preview_name}”.
              </p>

              {/* Follow-up */}
              <div className="mt-4">
                <p className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-foreground">
                  <CornerDownRight className="h-3.5 w-3.5 text-muted-foreground" />
                  Seguimiento si no responden
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
                    Respuesta a comentarios de alta intención
                  </p>
                  <p className="rounded-lg border border-dashed border-border bg-muted/40 px-3 py-2 text-[13px] text-muted-foreground whitespace-pre-wrap">
                    {plan.comment_reply}
                  </p>
                  <p className="mt-1 text-[10px] text-muted-foreground">
                    Mueve la conversación del comentario público al DM privado.
                  </p>
                </div>
              )}
            </div>

            {/* Oferta + productos + pasos */}
            <div className="space-y-4 lg:col-span-2">
              {plan.offer && (
                <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
                  <p className="mb-2 flex items-center gap-1.5 text-sm font-medium text-foreground">
                    <Tag className="h-4 w-4 text-accent-ink" />
                    Oferta
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
                <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
                  <p className="mb-2 flex items-center gap-1.5 text-sm font-medium text-foreground">
                    <ShoppingBag className="h-4 w-4 text-accent-ink" />
                    Productos a destacar
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

              <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
                <p className="mb-2 flex items-center gap-1.5 text-sm font-medium text-foreground">
                  <Target className="h-4 w-4 text-accent-ink" />
                  Próximos pasos
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
          <div className="flex flex-wrap items-center justify-end gap-2">
            <label className="mr-auto flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <span>Control (holdout)</span>
              <select
                value={holdoutPct}
                onChange={(e) => setHoldoutPct(Number(e.target.value))}
                className="rounded-md border border-border bg-background px-1.5 py-1 text-xs text-foreground"
                title="% de la audiencia que NO recibe DM, para medir incrementalidad real"
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
              Regenerar
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
              Guardar campaña
            </Button>
            <Button render={<Link href="/asistente" />}>
              Activar agente en Instagram
              <ArrowRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {/* Mis campañas guardadas */}
      {campaigns.length > 0 && (
        <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
          <p className="mb-3 flex items-center gap-1.5 text-sm font-medium text-foreground">
            <Radio className="h-4 w-4 text-accent-ink" />
            Mis campañas
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
                    {c.offer_code ? `Código ${c.offer_code} · ` : ''}
                    {new Date(c.updated_at).toLocaleDateString()}
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
                  {STATUS_LABEL[c.status]}
                </Badge>
                <button
                  type="button"
                  onClick={() => deleteCampaign(c.id)}
                  aria-label="Eliminar campaña"
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
      {!plan && !loading && (
        <div className="rounded-xl border border-dashed border-border bg-card/50 p-5">
          <p className="text-sm font-medium text-foreground">¿Cómo funciona?</p>
          <ol className="mt-3 grid gap-3 sm:grid-cols-3">
            {[
              {
                icon: <Target className="h-4 w-4" />,
                t: 'Describe un objetivo',
                d: 'En lenguaje natural, como se lo dirías a un marketer.',
              },
              {
                icon: <Sparkles className="h-4 w-4" />,
                t: 'El agente arma la campaña',
                d: 'Detecta el engagement, redacta el DM 1:1 y propone la oferta.',
              },
              {
                icon: <TrendingUp className="h-4 w-4" />,
                t: 'Revisa y lanza',
                d: 'Ajusta lo que quieras y conviértelo en una campaña real.',
              },
            ].map((step, i) => (
              <li
                key={i}
                className={cn(
                  'rounded-lg border border-border bg-background p-3',
                )}
              >
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-accent/50 text-accent-ink">
                  {step.icon}
                </span>
                <p className="mt-2 text-sm font-medium text-foreground">
                  {step.t}
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">{step.d}</p>
              </li>
            ))}
          </ol>
        </div>
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
  const steps = useMemo(
    () => [
      'Entendiendo tu objetivo…',
      productCount
        ? `Revisando tu catálogo (${productCount} productos)…`
        : 'Revisando tu catálogo…',
      audience
        ? `Escaneando tu audiencia de Instagram (${audience.toLocaleString()} personas)…`
        : 'Escaneando tu audiencia de Instagram…',
      'Detectando señales de intención…',
      'Filtrando comentarios y respuestas a historias…',
      'Redactando el DM 1:1 en tu voz de marca…',
      'Calculando el embudo y la oferta…',
    ],
    [audience, productCount],
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
    <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
      <p className="app-eyebrow flex items-center gap-1.5">
        <Radio className="h-3.5 w-3.5 text-accent-ink" />
        El agente está trabajando
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
