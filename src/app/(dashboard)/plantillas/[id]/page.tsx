'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { useLocalizedRouter } from '@/hooks/use-localized-router';
import { toast } from 'sonner';
import { ArrowLeft, Loader2, Trash2 } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useT } from '@/hooks/use-locale';
import { useFormat } from '@/hooks/use-format';
import { TemplateMetrics } from '@/components/templates/template-metrics';
import { WhatsappPreview } from '@/components/templates/whatsapp-preview';
import { idColumn } from '@/lib/short-id';
import type {
  TemplateHeaderType,
  TemplateButtonInput,
} from '@/lib/whatsapp/template-components';
import type { ButtonUrlVariable } from '@/lib/whatsapp/dynamic-links';
import type { TFn } from '@/lib/i18n/translate';
import type { MessageTemplate, Broadcast } from '@/types';

/**
 * Detail de una plantilla — preview del mensaje + datos de aprobación +
 * dónde se está usando (qué campañas la referencian).
 *
 * CATEGORY_KEYS / STATUS_KEYS map a DB value to its i18n key, resolved with
 * t() at render time.
 */
const CATEGORY_KEYS: Record<string, string> = {
  Marketing: 'templates.categoryMarketing',
  Utility: 'templates.categoryUtility',
  Authentication: 'templates.categoryAuthentication',
};

/** Qué link de Shopify representa cada botón dinámico (mismo mapa que el builder). */
const URL_VARIABLE_KEYS: Record<ButtonUrlVariable, string> = {
  abandoned_checkout: 'templates.linkVarAbandonedCheckout',
  order_status: 'templates.linkVarOrderStatus',
  tracking: 'templates.linkVarTracking',
  product: 'templates.linkVarProduct',
  payment: 'templates.linkVarPayment',
};

const STATUS_KEYS: Record<string, string> = {
  Draft: 'templates.statusDraft',
  Pending: 'templates.statusPending',
  Approved: 'templates.statusApproved',
  Rejected: 'templates.statusRejected',
};

function StatusPill({ status, t }: { status: string; t: TFn }) {
  const tone =
    status === 'Approved'
      ? 'border-emerald-600/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
      : status === 'Rejected'
        ? 'border-red-600/30 bg-red-500/10 text-red-700 dark:text-red-300'
        : status === 'Pending'
          ? 'border-amber-600/25 bg-amber-500/10 text-amber-700 dark:text-amber-300'
          : 'border-border bg-muted text-muted-foreground';
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium',
        tone,
      )}
    >
      {STATUS_KEYS[status] ? t(STATUS_KEYS[status]) : status}
    </span>
  );
}

export default function TemplateDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useLocalizedRouter();
  const templateId = params.id;
  const t = useT();
  const fmt = useFormat();

  const [template, setTemplate] = useState<MessageTemplate | null>(null);
  const [usedIn, setUsedIn] = useState<Broadcast[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    async function load() {
      if (!templateId) return;
      try {
        const supabase = createClient();
        const { data, error: err } = await supabase
          .from('message_templates')
          .select('*')
          .eq(idColumn(templateId), templateId)
          .maybeSingle();
        if (err) throw err;
        if (!data) {
          setError(t('templates.templateNotFound'));
        } else {
          setTemplate(data as MessageTemplate);
          // Campañas que usan esta plantilla por nombre
          // (broadcasts.template_name).
          const tmplName = (data as MessageTemplate).name;
          if (tmplName) {
            const { data: bcs } = await supabase
              .from('broadcasts')
              .select('*')
              .eq('template_name', tmplName)
              .order('created_at', { ascending: false })
              .limit(20);
            setUsedIn((bcs ?? []) as Broadcast[]);
          }
        }
      } catch (err) {
        setError(t('templates.genericError'));
      } finally {
        setLoading(false);
      }
    }
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [templateId]);

  async function handleDelete() {
    if (!template) {
      router.push('/plantillas');
      return;
    }
    setDeleting(true);
    try {
      const supabase = createClient();
      const { error: delErr } = await supabase
        .from('message_templates')
        .delete()
        .eq('id', template.id);
      if (delErr) throw delErr;
      toast.success(t('templates.templateDeleted'));
      router.push('/plantillas');
    } catch (err) {
      toast.error(t('templates.deleteFailed'));
    } finally {
      setDeleting(false);
    }
  }

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (error || !template) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-2">
        <p className="text-sm text-red-500">{error ?? t('templates.templateNotFound')}</p>
        <Button variant="outline" onClick={() => router.push('/plantillas')}>
          {t('templates.back')}
        </Button>
      </div>
    );
  }

  // Example value stored for each {{n}} (index 0 = {{1}}). It's the only
  // per-variable hint the template carries, so we use it to show what each
  // variable represents instead of an opaque {{1}} token.
  const samples = Array.isArray(template.variable_samples)
    ? (template.variable_samples as (string | null)[])
    : [];
  // Unique variable numbers, sorted, so the legend lists each once in order.
  const varNums = Array.from(
    new Set(
      Array.from((template.body_text ?? '').matchAll(/{{(\d+)}}/g)).map((m) =>
        Number(m[1]),
      ),
    ),
  ).sort((a, b) => a - b);

  // Cuerpo con cada {{n}} reemplazado por su valor de ejemplo (o el token si no
  // hay ejemplo), para el mockup de WhatsApp. Se guarda el rango de cada valor
  // sustituido para poder resaltarlo — es lo que promete el subtítulo.
  const bodyHighlights: Array<{ start: number; end: number }> = [];
  let filledBody = '';
  {
    const src = template.body_text ?? '';
    const re = /\{\{(\d+)\}\}/g;
    let last = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(src)) !== null) {
      filledBody += src.slice(last, m.index);
      const sample = samples[Number(m[1]) - 1];
      const piece = sample || m[0];
      if (sample) {
        bodyHighlights.push({ start: filledBody.length, end: filledBody.length + piece.length });
      }
      filledBody += piece;
      last = m.index + m[0].length;
    }
    filledBody += src.slice(last);
  }
  const previewHeaderType = (template.header_type as TemplateHeaderType) ?? 'none';
  const previewButtons = (Array.isArray(template.buttons)
    ? template.buttons
    : []) as unknown as TemplateButtonInput[];
  // Botones cuyo enlace se arma por cliente al enviar: no tienen destino que
  // abrir en la vista previa, así que se explican en la leyenda.
  const dynamicButtons = previewButtons.filter(
    (b) => b.type === 'URL' && b.url_variable,
  );
  // El subtítulo sólo se muestra si describe algo que está pasando en el mockup.
  const previewHint =
    bodyHighlights.length > 0
      ? t('templates.previewHintWithSamples')
      : varNums.length > 0
        ? t('templates.previewHintNoSamples')
        : null;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <Button
            variant="outline"
            size="icon"
            onClick={() => router.push('/plantillas')}
            className="size-10 sm:size-8 border-border"
            aria-label={t('templates.back')}
          >
            <ArrowLeft className="size-4" />
          </Button>
          <div className="min-w-0">
            <h1 className="truncate text-xl font-semibold tracking-tight text-foreground">
              {template.name}
            </h1>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span>
                {CATEGORY_KEYS[template.category]
                  ? t(CATEGORY_KEYS[template.category])
                  : template.category}
              </span>
              <span>·</span>
              <span className="uppercase">{template.language ?? 'es'}</span>
              <span>·</span>
              <StatusPill status={template.status || 'Draft'} t={t} />
              <span>·</span>
              <span>
                {t('templates.createdOn', {
                  date: fmt.date(template.created_at, {
                    day: 'numeric',
                    month: 'numeric',
                    year: 'numeric',
                  }),
                })}
              </span>
            </div>
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={handleDelete}
          disabled={deleting}
          className="h-8 border-border bg-transparent text-foreground hover:bg-muted"
        >
          <Trash2 className="size-3.5" />
          {t('templates.delete')}
        </Button>
      </div>

      {/* Métricas (izquierda) + vista previa (derecha, como al crear una plantilla) */}
      <div className="grid gap-3 lg:grid-cols-[1fr_360px] lg:items-start">
        {/* Izquierda: métricas + dónde se usa */}
        <div className="min-w-0 space-y-3">
          <TemplateMetrics templateId={template.id} />

          {usedIn.length > 0 && (
            <div className="rounded-lg border border-border bg-card p-4">
              <h3 className="text-xs uppercase tracking-wide text-muted-foreground">
                {t('templates.usedIn')}
              </h3>
              <ul className="mt-2 space-y-1.5">
                {usedIn.map((bc) => (
                  <li key={bc.id}>
                    <button
                      type="button"
                      onClick={() => router.push(`/campanas/${bc.id}`)}
                      className="flex w-full items-center justify-between gap-2 rounded-md border border-border bg-muted/30 px-2.5 py-1.5 text-left text-xs hover:bg-muted"
                    >
                      <span className="truncate text-foreground">{bc.name}</span>
                      <span className="shrink-0 text-muted-foreground">
                        {fmt.date(bc.created_at, {
                          day: '2-digit',
                          month: 'short',
                        })}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {/* Derecha: vista previa del mensaje (sticky en desktop) */}
        <div className="lg:sticky lg:top-4">
          <div className="rounded-lg border border-border bg-card p-4">
            <h2 className="text-sm font-medium text-foreground">
              {t('templates.preview')}
            </h2>
            {previewHint && (
              <p className="mt-1 text-xs text-muted-foreground">{previewHint}</p>
            )}

            <div className="mt-4">
              <WhatsappPreview
                headerType={previewHeaderType}
                headerText={template.header_content ?? undefined}
                bodyText={filledBody}
                bodyHighlights={bodyHighlights}
                footerText={template.footer_text ?? undefined}
                buttons={previewButtons}
              />
            </div>

            {(varNums.length > 0 || dynamicButtons.length > 0) && (
              <div className="mt-4">
                <p className="text-xs text-muted-foreground">
                  {t('templates.whatEachVariableReplaces')}
                </p>
                <div className="mt-1.5 space-y-1">
                  {varNums.map((n) => {
                    const sample = samples[n - 1];
                    return (
                      <div key={n} className="flex items-center gap-2 text-[12px]">
                        <span className="rounded-full border border-border bg-muted px-2 py-0.5 font-medium tabular-nums text-foreground">
                          {`{{${n}}}`}
                        </span>
                        <span className="text-muted-foreground">→</span>
                        <span className="text-foreground">
                          {sample ? sample : t('templates.dynamicValueHint')}
                        </span>
                      </div>
                    );
                  })}
                  {dynamicButtons.map((b, i) => (
                    <div key={`btn-${i}`} className="flex items-center gap-2 text-[12px]">
                      <span className="truncate rounded-full border border-border bg-muted px-2 py-0.5 font-medium text-foreground">
                        {b.text}
                      </span>
                      <span className="text-muted-foreground">→</span>
                      <span className="text-foreground">
                        {t(URL_VARIABLE_KEYS[b.url_variable!])}
                        {' · '}
                        {t('templates.buttonLinkPerCustomer')}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
