'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { toast } from 'sonner';
import { ArrowLeft, Loader2 } from 'lucide-react';
import type { MessageTemplate, Tag } from '@/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useBroadcastSending } from '@/hooks/use-broadcast-sending';
import { WhatsappPreview } from '@/components/templates/whatsapp-preview';
import type {
  TemplateButtonInput,
  TemplateHeaderType,
} from '@/lib/whatsapp/template-components';
import type { ContactSegment } from '@/lib/segments/types';

type AudienceType = 'all' | 'tags' | 'segment';

export default function NewBroadcastPage() {
  const router = useRouter();
  const { createAndSendBroadcast, isProcessing } = useBroadcastSending();

  const [name, setName] = useState('');
  const [audienceType, setAudienceType] = useState<AudienceType>('all');
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
  const [segmentId, setSegmentId] = useState<string>('');
  const [segments, setSegments] = useState<ContactSegment[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [templates, setTemplates] = useState<MessageTemplate[]>([]);
  const [templateId, setTemplateId] = useState<string>('');
  const [variables, setVariables] = useState<Record<string, string>>({});
  const [sendMode, setSendMode] = useState<'now' | 'schedule'>('now');
  const [scheduledAt, setScheduledAt] = useState('');
  const [createConversations, setCreateConversations] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    supabase
      .from('message_templates')
      .select('*')
      .eq('status', 'Approved')
      .order('created_at', { ascending: false })
      .then(({ data }) => setTemplates((data ?? []) as MessageTemplate[]));
    supabase
      .from('tags')
      .select('*')
      .order('name')
      .then(({ data }) => setTags((data ?? []) as Tag[]));
    supabase
      .from('contact_segments')
      .select('*')
      .order('name')
      .then(({ data }) => setSegments((data ?? []) as ContactSegment[]));
  }, []);

  const template = useMemo(
    () => templates.find((t) => t.id === templateId) ?? null,
    [templates, templateId],
  );

  // Extract {{1}}, {{2}} variables from the template body so the form
  // shows one input per variable inline.
  const templateVars = useMemo(() => {
    if (!template?.body_text) return [] as string[];
    const out = new Set<string>();
    const re = /\{\{(\d+)\}\}/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(template.body_text)) !== null) out.add(m[1]);
    return [...out].sort((a, b) => Number(a) - Number(b));
  }, [template]);

  function toggleTag(id: string) {
    setSelectedTagIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  function validate(): string | null {
    if (!name.trim()) return 'Ponle un nombre a la campaña.';
    if (!template) return 'Elegí una plantilla.';
    if (audienceType === 'tags' && selectedTagIds.length === 0)
      return 'Seleccioná al menos una etiqueta.';
    if (audienceType === 'segment' && !segmentId)
      return 'Elegí un segmento.';
    if (sendMode === 'schedule' && !scheduledAt) return 'Elegí cuándo programarla.';
    return null;
  }

  async function handleSend() {
    const err = validate();
    if (err) return toast.error(err);
    if (!template) return;
    try {
      const broadcastId = await createAndSendBroadcast({
        name,
        template,
        audience: {
          type: audienceType,
          tagIds: audienceType === 'tags' ? selectedTagIds : undefined,
          segmentId: audienceType === 'segment' ? segmentId : undefined,
        },
        variables: Object.fromEntries(
          templateVars.map((v) => [v, { type: 'static', value: variables[v] ?? '' }]),
        ),
        scheduledAt: sendMode === 'schedule' ? scheduledAt : null,
        createConversations,
      });
      router.push(`/broadcasts/${broadcastId}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se pudo enviar la campaña');
    }
  }

  async function handleSaveDraft() {
    const err = validate();
    if (err) return toast.error(err);
    if (!template) return;
    const supabase = createClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const user = session?.user;
    if (!user) return toast.error('No has iniciado sesión.');
    const { error } = await supabase.from('broadcasts').insert({
      user_id: user.id,
      name: name.trim(),
      template_name: template.name,
      template_language: template.language ?? 'es',
      template_variables: variables,
      audience_filter: { type: audienceType, tagIds: selectedTagIds },
      status: 'draft',
      total_recipients: 0,
      sent_count: 0,
      delivered_count: 0,
      read_count: 0,
      replied_count: 0,
      failed_count: 0,
    });
    if (error) return toast.error(`No se pudo guardar: ${error.message}`);
    toast.success('Borrador guardado');
    router.push('/broadcasts');
  }

  // Render the template body with the user's variable values substituted so
  // the right-side phone preview reflects exactly what the recipient sees.
  const previewBody = useMemo(() => {
    if (!template?.body_text) {
      return 'Elegí una plantilla aprobada para ver cómo se verá el mensaje.';
    }
    return template.body_text.replace(/\{\{(\d+)\}\}/g, (_, n: string) => {
      const v = variables[n];
      return v && v.trim() ? v : `{{${n}}}`;
    });
  }, [template, variables]);

  const previewHeaderType: TemplateHeaderType =
    (template?.header_type as TemplateHeaderType | undefined) ?? 'none';
  const previewButtons = (template?.buttons ?? []) as unknown as TemplateButtonInput[];

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <div className="flex items-center gap-3">
        <Button
          variant="outline"
          size="icon"
          onClick={() => router.push('/broadcasts')}
          className="border-border"
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <h1 className="text-xl font-semibold text-foreground">Nueva campaña</h1>
      </div>

      <div className="grid gap-5 lg:grid-cols-[1fr_360px]">
      <div className="rounded-xl border border-border bg-card p-6 shadow-sm">
        <div className="space-y-5">
          <div className="space-y-1.5">
            <Label className="text-foreground">Nombre</Label>
            <Input
              placeholder="Reactivación oferta verano"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="bg-background"
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-foreground">Destinatarios</Label>
            <Select
              value={audienceType}
              onValueChange={(v) => setAudienceType(v as AudienceType)}
            >
              <SelectTrigger className="w-full bg-background">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos los contactos</SelectItem>
                <SelectItem value="tags">Por etiquetas</SelectItem>
                <SelectItem value="segment">Por segmento guardado</SelectItem>
              </SelectContent>
            </Select>
            {audienceType === 'segment' && (
              <div className="mt-2 space-y-1">
                <Select value={segmentId} onValueChange={(v) => setSegmentId(v ?? '')}>
                  <SelectTrigger className="w-full bg-background">
                    <SelectValue placeholder="Elegir un segmento" />
                  </SelectTrigger>
                  <SelectContent>
                    {segments.length === 0 && (
                      <div className="px-2 py-1.5 text-xs text-muted-foreground">
                        No tenés segmentos. Creá uno en Contactos → Segmentos.
                      </div>
                    )}
                    {segments.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-[11px] text-muted-foreground">
                  Los contactos se resuelven al enviar, así que el segmento se mantiene
                  actualizado.
                </p>
              </div>
            )}
            {audienceType === 'tags' && (
              <div className="mt-2 flex flex-wrap gap-1.5 rounded-lg border border-border bg-background p-2">
                {tags.length === 0 && (
                  <p className="text-xs text-muted-foreground">
                    No tenés etiquetas todavía. Creá una en Contactos.
                  </p>
                )}
                {tags.map((t) => {
                  const on = selectedTagIds.includes(t.id);
                  return (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => toggleTag(t.id)}
                      className={
                        'rounded-full px-2.5 py-0.5 text-xs transition-colors ' +
                        (on
                          ? 'bg-primary text-primary-foreground'
                          : 'bg-muted text-muted-foreground hover:bg-accent')
                      }
                    >
                      {t.name}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <div className="space-y-1.5">
            <Label className="text-foreground">Cuándo enviar</Label>
            <div className="flex items-center gap-4">
              <label className="flex items-center gap-2 text-sm text-foreground">
                <input
                  type="radio"
                  name="sendMode"
                  checked={sendMode === 'now'}
                  onChange={() => setSendMode('now')}
                  className="accent-primary"
                />
                Ahora mismo
              </label>
              <label className="flex items-center gap-2 text-sm text-foreground">
                <input
                  type="radio"
                  name="sendMode"
                  checked={sendMode === 'schedule'}
                  onChange={() => setSendMode('schedule')}
                  className="accent-primary"
                />
                Programar
              </label>
            </div>
            {sendMode === 'schedule' && (
              <Input
                type="datetime-local"
                value={scheduledAt}
                onChange={(e) => setScheduledAt(e.target.value)}
                className="mt-2 bg-background"
              />
            )}
          </div>

          <div className="space-y-1.5">
            <Label className="text-foreground">Plantilla</Label>
            <Select value={templateId} onValueChange={(v) => setTemplateId(v ?? '')}>
              <SelectTrigger className="w-full bg-background">
                <SelectValue placeholder="Elegir una plantilla aprobada" />
              </SelectTrigger>
              <SelectContent>
                {templates.length === 0 && (
                  <div className="px-2 py-1.5 text-xs text-muted-foreground">
                    No hay plantillas aprobadas todavía.
                  </div>
                )}
                {templates.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.name} ({t.language ?? 'es'})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {templateVars.length > 0 && (
            <div className="space-y-2 rounded-lg border border-border bg-muted/40 p-3">
              <p className="text-xs font-medium text-foreground">Valores de las variables</p>
              {templateVars.map((v) => (
                <div key={v} className="flex items-center gap-2">
                  <span className="w-12 shrink-0 text-xs text-muted-foreground tabular-nums">
                    {`{{${v}}}`}
                  </span>
                  <Input
                    placeholder="Valor que reemplaza la variable"
                    value={variables[v] ?? ''}
                    onChange={(e) =>
                      setVariables((prev) => ({ ...prev, [v]: e.target.value }))
                    }
                    className="bg-background"
                  />
                </div>
              ))}
            </div>
          )}

          <label className="flex items-start gap-2 text-sm text-foreground">
            <input
              type="checkbox"
              checked={createConversations}
              onChange={(e) => setCreateConversations(e.target.checked)}
              className="mt-0.5 accent-primary"
            />
            <span>
              Abrir una conversación en la bandeja por cada destinatario para hacer
              seguimiento de respuestas.
            </span>
          </label>
        </div>

        <div className="mt-6 flex items-center justify-end gap-2 border-t border-border pt-4">
          <button
            type="button"
            onClick={handleSaveDraft}
            className="text-sm font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
          >
            Guardar borrador
          </button>
          <Button
            variant="outline"
            onClick={() => router.push('/broadcasts')}
            className="border-border text-foreground hover:bg-accent"
          >
            Cancelar
          </Button>
          <Button
            onClick={handleSend}
            disabled={isProcessing}
            className="bg-primary hover:bg-primary/90 text-primary-foreground"
          >
            {isProcessing ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Enviando…
              </>
            ) : sendMode === 'schedule' ? (
              'Programar'
            ) : (
              'Enviar ahora'
            )}
          </Button>
        </div>
      </div>

        <aside className="lg:sticky lg:top-4 lg:self-start">
          <WhatsappPreview
            headerType={previewHeaderType}
            headerText={template?.header_content}
            bodyText={previewBody}
            footerText={template?.footer_text}
            buttons={previewButtons}
          />
        </aside>
      </div>
    </div>
  );
}
