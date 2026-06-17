'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { toast } from 'sonner';
import {
  ArrowLeft,
  Loader2,
  Users,
  Tag,
  Radio,
  MessageCircle,
  TrendingUp,
  Rocket,
  Pause,
  Play,
  CheckCircle2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { InstagramIcon } from '@/components/layout/instagram-icon';
import { useFetchWithCsrf } from '@/lib/api/fetch-with-csrf';
import { cn } from '@/lib/utils';
import type {
  InstagramCampaign,
  CampaignStatus,
  CampaignMetrics,
} from '@/lib/instagram-agent/types';

const STATUS_LABEL: Record<CampaignStatus, string> = {
  draft: 'Borrador',
  active: 'Activa',
  paused: 'Pausada',
  done: 'Finalizada',
};

export default function CampaignDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id;
  const fetchWithCsrf = useFetchWithCsrf();
  const [campaign, setCampaign] = useState<InstagramCampaign | null>(null);
  const [byStatus, setByStatus] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const res = await fetch(`/api/ai/instagram-agent/campaigns/${id}`, {
        cache: 'no-store',
      });
      const json = await res.json();
      if (res.ok) {
        setCampaign(json.campaign as InstagramCampaign);
        setByStatus((json.recipients_by_status ?? {}) as Record<string, number>);
      } else {
        toast.error(json.error ?? 'No se pudo cargar la campaña');
      }
    } catch {
      toast.error('Error de red');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  async function action(
    path: string,
    method: 'POST' | 'PATCH',
    body?: unknown,
    okMsg?: string,
  ) {
    if (!id) return;
    setBusy(true);
    try {
      const res = await fetchWithCsrf(
        `/api/ai/instagram-agent/campaigns/${id}${path}`,
        {
          method,
          headers: body ? { 'Content-Type': 'application/json' } : undefined,
          body: body ? JSON.stringify(body) : undefined,
        },
      );
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(json.error ?? 'La acción falló');
        return;
      }
      if (okMsg) toast.success(okMsg);
      load();
    } catch {
      toast.error('Error de red');
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }
  if (!campaign) {
    return (
      <div className="space-y-4">
        <BackLink />
        <p className="text-sm text-muted-foreground">Campaña no encontrada.</p>
      </div>
    );
  }

  const plan = campaign.plan;
  const metrics = (
    campaign.metrics && 'recipients' in campaign.metrics
      ? campaign.metrics
      : null
  ) as CampaignMetrics | null;
  const messagePreview = plan.message.text.replace(
    /\{\{\s*(nombre|name|1)\s*\}\}/gi,
    plan.message.preview_name,
  );

  return (
    <div className="space-y-5">
      <BackLink />

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="app-eyebrow flex items-center gap-1.5">
            <InstagramIcon className="h-3.5 w-3.5" />
            Campaña de Instagram
          </p>
          <h1 className="app-page-title mt-1.5">{campaign.name}</h1>
          <p className="mt-1 text-xs text-muted-foreground">{campaign.goal}</p>
        </div>
        <Badge
          variant={
            campaign.status === 'active'
              ? 'default'
              : campaign.status === 'paused'
                ? 'outline'
                : 'secondary'
          }
          className="shrink-0"
        >
          {STATUS_LABEL[campaign.status]}
        </Badge>
      </div>

      {/* Acciones de ciclo de vida */}
      <div className="flex flex-wrap gap-2">
        {(campaign.status === 'draft' || campaign.status === 'paused') && (
          <Button
            onClick={() =>
              action('/launch', 'POST', undefined, 'Campaña lanzada')
            }
            disabled={busy}
          >
            {busy ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Rocket className="h-4 w-4" />
            )}
            {campaign.status === 'paused' ? 'Retomar' : 'Lanzar campaña'}
          </Button>
        )}
        {campaign.status === 'active' && (
          <Button
            variant="outline"
            onClick={() =>
              action('', 'PATCH', { status: 'paused' }, 'Campaña pausada')
            }
            disabled={busy}
          >
            <Pause className="h-4 w-4" />
            Pausar agente
          </Button>
        )}
        {campaign.status !== 'done' && (
          <Button
            variant="ghost"
            onClick={() =>
              action('', 'PATCH', { status: 'done' }, 'Campaña finalizada')
            }
            disabled={busy}
          >
            <CheckCircle2 className="h-4 w-4" />
            Finalizar
          </Button>
        )}
        {campaign.status === 'draft' && (
          <Button
            variant="ghost"
            onClick={() =>
              action('/resolve', 'POST', undefined, 'Audiencia resuelta')
            }
            disabled={busy}
          >
            <Play className="h-4 w-4" />
            Resolver audiencia
          </Button>
        )}
      </div>

      {/* Embudo real */}
      <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
        <p className="app-eyebrow">Embudo real</p>
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat label="En cola" value={byStatus.queued ?? 0} />
          <Stat label="Enviados" value={byStatus.sent ?? 0} />
          <Stat label="Respuestas" value={byStatus.replied ?? 0} />
          <Stat
            label="Conversiones"
            value={byStatus.converted ?? 0}
            highlight
          />
        </div>
        {metrics && metrics.revenue > 0 && (
          <p className="mt-3 flex items-center gap-1.5 text-sm">
            <TrendingUp className="h-4 w-4 text-accent-ink" />
            <span className="font-semibold text-accent-ink">
              {metrics.revenue.toLocaleString()} {metrics.currency}
            </span>
            <span className="text-muted-foreground">atribuidos (último toque)</span>
          </p>
        )}

        {/* Incrementalidad — el diferenciador: revenue que NO habría ocurrido
            sin el agente, medido contra un grupo de control (holdout). */}
        {metrics && metrics.control_size > 0 && (
          <div className="mt-3 rounded-lg border border-accent-ink/30 bg-accent/20 p-3">
            <p className="flex items-center gap-1.5 text-xs font-medium text-foreground">
              <TrendingUp className="h-3.5 w-3.5 text-accent-ink" />
              Incrementalidad (vs. control de {metrics.control_size})
            </p>
            <div className="mt-2 flex flex-wrap items-baseline gap-x-4 gap-y-1">
              <span className="text-lg font-semibold text-accent-ink">
                {metrics.incremental_revenue.toLocaleString()} {metrics.currency}
              </span>
              <span className="text-xs text-muted-foreground">
                revenue incremental · {metrics.incremental_conversions} ventas netas
              </span>
              {metrics.uplift_pct > 0 && (
                <span className="text-xs font-medium text-accent-ink">
                  +{metrics.uplift_pct}% uplift
                </span>
              )}
            </div>
            <p className="mt-1 text-[10px] text-muted-foreground">
              El control no recibió DM; restamos su compra orgánica para aislar
              el efecto real del agente.
            </p>
          </div>
        )}
      </div>

      {/* Plan */}
      <div className="grid gap-4 lg:grid-cols-5">
        <div className="rounded-xl border border-border bg-card p-4 shadow-sm lg:col-span-3">
          <p className="mb-3 flex items-center gap-1.5 text-sm font-medium text-foreground">
            <InstagramIcon className="h-4 w-4" />
            DM de Instagram
          </p>
          <div className="rounded-xl bg-[#0b0b0f] p-3">
            <div className="ml-auto max-w-[85%] rounded-2xl rounded-br-md bg-gradient-to-br from-[#5b51d8] to-[#c13584] px-3 py-2 text-[13px] leading-relaxed whitespace-pre-wrap text-white">
              {messagePreview}
            </div>
          </div>
          <div className="mt-4">
            <p className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-foreground">
              <MessageCircle className="h-3.5 w-3.5 text-muted-foreground" />
              Seguimiento
            </p>
            <p className="rounded-lg border border-dashed border-border bg-muted/40 px-3 py-2 text-[13px] text-muted-foreground whitespace-pre-wrap">
              {plan.follow_up}
            </p>
          </div>
        </div>

        <div className="space-y-4 lg:col-span-2">
          <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
            <p className="mb-1.5 flex items-center gap-1.5 text-sm font-medium text-foreground">
              <Users className="h-4 w-4 text-accent-ink" />
              Audiencia
            </p>
            <p className="text-xs text-muted-foreground">
              {plan.audience.description}
            </p>
            <p className="mt-1.5 flex items-start gap-1.5 text-[11px] text-muted-foreground">
              <Radio className="mt-0.5 h-3 w-3 shrink-0 text-accent-ink" />
              {plan.audience.source}
            </p>
          </div>
          {plan.offer && (
            <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
              <p className="mb-2 flex items-center gap-1.5 text-sm font-medium text-foreground">
                <Tag className="h-4 w-4 text-accent-ink" />
                Oferta
              </p>
              <span className="rounded-md border border-dashed border-accent-ink/40 bg-accent/40 px-2 py-1 font-mono text-sm font-semibold text-accent-ink">
                {plan.offer.code}
              </span>{' '}
              <span className="text-sm text-foreground">
                {plan.offer.discount}
              </span>
              <p className="mt-2 text-xs text-muted-foreground">
                {plan.offer.conditions}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function BackLink() {
  return (
    <Link
      href="/agente-instagram"
      className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
    >
      <ArrowLeft className="h-3.5 w-3.5" />
      Agente de Instagram
    </Link>
  );
}

function Stat({
  label,
  value,
  highlight = false,
}: {
  label: string;
  value: number;
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
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p
        className={cn(
          'mt-1 text-base font-semibold tabular-nums',
          highlight ? 'text-accent-ink' : 'text-foreground',
        )}
      >
        {value.toLocaleString()}
      </p>
    </div>
  );
}
