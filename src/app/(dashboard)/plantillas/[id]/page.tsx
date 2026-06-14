'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { toast } from 'sonner';
import {
  ArrowLeft,
  Loader2,
  Trash2,
  ExternalLink,
  AlertCircle,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { MessageTemplate, Broadcast } from '@/types';
import { findPlaceholderTemplate } from '@/lib/templates/placeholder-data';

/**
 * Detail de una plantilla — preview del mensaje + datos de aprobación +
 * dónde se está usando (qué campañas la referencian).
 *
 * Acepta IDs demo-* y los rinde con la data de placeholder (no toca DB)
 * para que el usuario pueda explorar la UI antes de tener plantillas
 * reales aprobadas por Meta.
 */
const CATEGORY_LABELS: Record<string, string> = {
  Marketing: 'Marketing',
  Utility: 'Utilidad',
  Authentication: 'Autenticación',
};

const STATUS_LABELS: Record<string, string> = {
  Draft: 'Borrador',
  Pending: 'Pendiente',
  Approved: 'Aprobada',
  Rejected: 'Rechazada',
};

function StatusPill({ status }: { status: string }) {
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
      {STATUS_LABELS[status] ?? status}
    </span>
  );
}

export default function TemplateDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const templateId = params.id;

  const [template, setTemplate] = useState<MessageTemplate | null>(null);
  const [usedIn, setUsedIn] = useState<Broadcast[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const isPlaceholder = templateId?.startsWith('demo-') ?? false;

  useEffect(() => {
    async function load() {
      if (!templateId) return;
      if (isPlaceholder) {
        const ph = findPlaceholderTemplate(templateId);
        if (ph) setTemplate(ph);
        else setError('Plantilla de ejemplo no encontrada');
        setLoading(false);
        return;
      }
      try {
        const supabase = createClient();
        const { data, error: err } = await supabase
          .from('message_templates')
          .select('*')
          .eq('id', templateId)
          .maybeSingle();
        if (err) throw err;
        if (!data) {
          setError('Plantilla no encontrada');
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
        setError(err instanceof Error ? err.message : 'Error');
      } finally {
        setLoading(false);
      }
    }
    void load();
  }, [templateId, isPlaceholder]);

  async function handleDelete() {
    if (!template || isPlaceholder) {
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
      toast.success('Plantilla eliminada');
      router.push('/plantillas');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se pudo eliminar');
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
        <p className="text-sm text-red-500">{error ?? 'Plantilla no encontrada'}</p>
        <Button variant="outline" onClick={() => router.push('/plantillas')}>
          Volver
        </Button>
      </div>
    );
  }

  const variables = Array.from(
    (template.body_text ?? '').matchAll(/{{(\d+)}}/g),
  ).map((m) => `{{${m[1]}}}`);

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <Button
            variant="outline"
            size="icon"
            onClick={() => router.push('/plantillas')}
            className="h-8 w-8 border-border"
            aria-label="Volver"
          >
            <ArrowLeft className="size-4" />
          </Button>
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground">Plantilla de WhatsApp</p>
            <h1 className="truncate text-xl font-semibold tracking-tight text-foreground">
              {template.name}
            </h1>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span>
                {CATEGORY_LABELS[template.category] ?? template.category}
              </span>
              <span>·</span>
              <span className="uppercase">{template.language ?? 'es'}</span>
              <span>·</span>
              <StatusPill status={template.status || 'Draft'} />
              <span>·</span>
              <span>
                Creada el {new Date(template.created_at).toLocaleDateString('es-ES')}
              </span>
            </div>
          </div>
        </div>
        {!isPlaceholder && (
          <Button
            variant="outline"
            size="sm"
            onClick={handleDelete}
            disabled={deleting}
            className="h-8 border-border bg-transparent text-foreground hover:bg-muted"
          >
            <Trash2 className="size-3.5" />
            Eliminar
          </Button>
        )}
      </div>

      {/* Preview + datos */}
      <div className="grid gap-3 lg:grid-cols-[1fr_320px]">
        {/* Vista previa del mensaje */}
        <div className="rounded-lg border border-border bg-card p-4">
          <h2 className="text-sm font-medium text-foreground">
            Vista previa
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Así se verá en WhatsApp. Los {`{{n}}`} se reemplazan al enviar.
          </p>

          <div
            className="mt-4 rounded-lg p-3"
            style={{
              backgroundColor: '#e5ddd5',
              backgroundImage:
                'radial-gradient(rgba(0,0,0,0.04) 1px, transparent 1px)',
              backgroundSize: '10px 10px',
            }}
          >
            <div className="max-w-sm space-y-1.5 rounded-md rounded-tl-none bg-white p-3 shadow-sm">
              {template.header_content && (
                <p className="text-sm font-semibold text-[#111b21]">
                  {template.header_content}
                </p>
              )}
              <p className="whitespace-pre-wrap text-sm leading-snug text-[#111b21]">
                {template.body_text}
              </p>
              {template.footer_text && (
                <p className="text-[11px] italic text-[#667781]">
                  {template.footer_text}
                </p>
              )}
              <p className="text-right text-[10px] text-[#667781]">12:00 ✓✓</p>
            </div>
          </div>

          {variables.length > 0 && (
            <div className="mt-4">
              <p className="text-xs text-muted-foreground">
                Variables en el cuerpo:
              </p>
              <div className="mt-1 flex flex-wrap gap-1">
                {variables.map((v) => (
                  <span
                    key={v}
                    className="rounded-full border border-border bg-muted px-2 py-0.5 text-[11px] font-medium tabular-nums text-foreground"
                  >
                    {v}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Estado de aprobación + sync */}
        <div className="space-y-3">
          <div className="rounded-lg border border-border bg-card p-4">
            <h3 className="text-xs uppercase tracking-wide text-muted-foreground">
              Aprobación de Meta
            </h3>
            <p className="mt-2 text-sm text-foreground">
              {template.status === 'Approved' && (
                <>
                  Aprobada. Podés usarla en campañas masivas y mensajes
                  fuera de la ventana de 24h.
                </>
              )}
              {template.status === 'Pending' && (
                <>Pendiente de revisión por Meta. Suele tardar entre 5 min y 24h.</>
              )}
              {template.status === 'Rejected' && (
                <>
                  Rechazada por Meta. Revisá las reglas de plantillas
                  (no promesas exageradas, no contenido restringido) y volvé
                  a enviarla.
                </>
              )}
              {(!template.status || template.status === 'Draft') && (
                <>
                  Es un borrador. Mandala a aprobar desde Meta para poder
                  usarla en envíos masivos.
                </>
              )}
            </p>
            <a
              href="https://business.facebook.com/wa/manage/message-templates/"
              target="_blank"
              rel="noreferrer"
              className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-foreground hover:text-accent-ink"
            >
              Ver en Meta Business
              <ExternalLink className="size-3" />
            </a>
          </div>

          {usedIn.length > 0 && (
            <div className="rounded-lg border border-border bg-card p-4">
              <h3 className="text-xs uppercase tracking-wide text-muted-foreground">
                Usada en
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
                        {new Date(bc.created_at).toLocaleDateString('es-ES', {
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

          {isPlaceholder && (
            <div className="flex items-start gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2.5">
              <AlertCircle className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              <p className="text-xs text-muted-foreground">
                Plantilla de ejemplo. Cuando sincronices tus plantillas
                aprobadas en Meta, las vas a ver acá con su data real.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
