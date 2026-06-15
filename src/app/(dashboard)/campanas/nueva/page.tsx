'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { toast } from 'sonner';
import { ArrowLeft, CalendarClock, Loader2, Plus, Send } from 'lucide-react';
import type { CustomField, MessageTemplate, Tag } from '@/types';
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
import { cn } from '@/lib/utils';

type AudienceType = 'all' | 'tags' | 'segment';

const AUDIENCE_LABELS: Record<AudienceType, string> = {
  all: 'Todos los contactos',
  tags: 'Por etiquetas',
  segment: 'Por segmento guardado',
};

const BUILTIN_FIELD_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: 'Valor fijo' },
  { value: 'name', label: 'Nombre completo' },
  { value: 'first_name', label: 'Primer nombre' },
  { value: 'last_name', label: 'Apellido' },
  { value: 'phone', label: 'Teléfono' },
  { value: 'email', label: 'Correo' },
  { value: 'company', label: 'Empresa' },
];

function parseUsdRate(): number {
  const raw = process.env.NEXT_PUBLIC_META_MSG_COST_USD;
  const n = raw ? parseFloat(raw) : 0.02;
  return Number.isFinite(n) && n >= 0 ? n : 0.02;
}

function formatUsd(amount: number): string {
  return `USD ${amount.toFixed(2)}`;
}

/** Quick chips above the manual datetime picker. Keeps the common case
 *  ("Programar para mañana 9 am") one click away. */
const SCHEDULE_PRESETS: { label: string; minutesAhead: number }[] = [
  { label: 'En 1 hora', minutesAhead: 60 },
  { label: 'En 3 horas', minutesAhead: 180 },
  { label: 'Mañana 9 a. m.', minutesAhead: -1 }, // sentinel; computed below
  { label: 'En 1 semana', minutesAhead: 60 * 24 * 7 },
];

function formatLocalDateTimeInput(d: Date) {
  // datetime-local expects "YYYY-MM-DDTHH:mm" in *local* time, no Z.
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}`;
}

function applyPreset(preset: (typeof SCHEDULE_PRESETS)[number], now: Date) {
  if (preset.label === 'Mañana 9 a. m.') {
    const d = new Date(now);
    d.setDate(d.getDate() + 1);
    d.setHours(9, 0, 0, 0);
    return d;
  }
  const d = new Date(now.getTime() + preset.minutesAhead * 60_000);
  d.setSeconds(0, 0);
  return d;
}

function describeScheduledAt(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const now = new Date();
  const diffMs = d.getTime() - now.getTime();
  if (diffMs <= 0) return 'Ahora mismo';
  const mins = Math.round(diffMs / 60_000);
  if (mins < 60) return `En ${mins} ${mins === 1 ? 'minuto' : 'minutos'}`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `En ${hours} ${hours === 1 ? 'hora' : 'horas'}`;
  const days = Math.round(hours / 24);
  return `En ${days} ${days === 1 ? 'día' : 'días'}`;
}

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
  const [variableMapping, setVariableMapping] = useState<Record<string, string>>({});
  const [customFields, setCustomFields] = useState<CustomField[]>([]);
  const [sendMode, setSendMode] = useState<'now' | 'schedule'>('now');
  const [scheduledAt, setScheduledAt] = useState('');
  const [createConversations, setCreateConversations] = useState(false);
  const [recipientCount, setRecipientCount] = useState<number | null>(null);
  const [testPhone, setTestPhone] = useState('');
  const [sendingTest, setSendingTest] = useState(false);

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
    supabase
      .from('custom_fields')
      .select('*')
      .order('field_name')
      .then(({ data }) => setCustomFields((data ?? []) as CustomField[]));
  }, []);

  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;
    async function loadCount() {
      try {
        if (audienceType === 'all') {
          const { count } = await supabase
            .from('contacts')
            .select('id', { count: 'exact', head: true });
          if (!cancelled) setRecipientCount(count ?? 0);
          return;
        }
        if (audienceType === 'tags') {
          if (selectedTagIds.length === 0) {
            if (!cancelled) setRecipientCount(0);
            return;
          }
          const { data } = await supabase
            .from('contact_tags')
            .select('contact_id')
            .in('tag_id', selectedTagIds);
          const ids = new Set((data ?? []).map((r) => r.contact_id));
          if (!cancelled) setRecipientCount(ids.size);
          return;
        }
        if (audienceType === 'segment') {
          if (!segmentId) {
            if (!cancelled) setRecipientCount(0);
            return;
          }
          const res = await fetch('/api/broadcasts/audience-preview', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              audience: { type: 'all' },
              limit: 1,
            }),
          });
          if (res.ok) {
            const data = await res.json();
            if (!cancelled)
              setRecipientCount(Array.isArray(data.contacts) ? data.contacts.length : 0);
          }
        }
      } catch {
        if (!cancelled) setRecipientCount(null);
      }
    }
    void loadCount();
    return () => {
      cancelled = true;
    };
  }, [audienceType, selectedTagIds, segmentId]);

  const template = useMemo(
    () => templates.find((t) => t.id === templateId) ?? null,
    [templates, templateId],
  );

  const templateLabels = useMemo(
    () =>
      Object.fromEntries(
        templates.map((t) => [t.id, `${t.name} · ${t.language ?? 'es'}`]),
      ),
    [templates],
  );
  const segmentLabels = useMemo(
    () => Object.fromEntries(segments.map((s) => [s.id, s.name])),
    [segments],
  );

  const templateVars = useMemo(() => {
    if (!template?.body_text) return [] as string[];
    const out = new Set<string>();
    const re = /\{\{(\d+)\}\}/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(template.body_text)) !== null) out.add(m[1]);
    return [...out].sort((a, b) => Number(a) - Number(b));
  }, [template]);

  const usdRate = useMemo(() => parseUsdRate(), []);
  const estimatedCost = useMemo(() => {
    if (recipientCount === null) return null;
    return recipientCount * usdRate;
  }, [recipientCount, usdRate]);

  function toggleTag(id: string) {
    setSelectedTagIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  function validate(): string | null {
    if (!name.trim()) return 'Falta el nombre.';
    if (!template) return 'Elige una plantilla.';
    if (audienceType === 'tags' && selectedTagIds.length === 0)
      return 'Elige una etiqueta.';
    if (audienceType === 'segment' && !segmentId) return 'Elige un segmento.';
    if (sendMode === 'schedule') {
      if (!scheduledAt) return 'Elige cuándo programarla.';
      const t = new Date(scheduledAt).getTime();
      if (Number.isNaN(t)) return 'Fecha no válida.';
      if (t <= Date.now()) return 'La fecha debe ser futura.';
    }
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
          templateVars.map((v) => {
            const mapped = variableMapping[v];
            if (mapped) {
              if (BUILTIN_FIELD_OPTIONS.some((b) => b.value === mapped)) {
                return [v, { type: 'field' as const, value: mapped }];
              }
              return [v, { type: 'custom_field' as const, value: mapped }];
            }
            return [v, { type: 'static' as const, value: variables[v] ?? '' }];
          }),
        ),
        scheduledAt:
          sendMode === 'schedule' ? new Date(scheduledAt).toISOString() : null,
        createConversations,
      });

      const cleanMapping = Object.fromEntries(
        Object.entries(variableMapping).filter(([, v]) => v),
      );
      if (Object.keys(cleanMapping).length > 0) {
        await createClient()
          .from('broadcasts')
          .update({ variable_mapping: cleanMapping })
          .eq('id', broadcastId);
      }

      toast.success(
        sendMode === 'schedule' ? 'Campaña programada' : 'Campaña enviada',
      );
      router.push(`/campanas/${broadcastId}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se envió');
    }
  }

  async function handleSendTest() {
    if (!template) return toast.error('Elige una plantilla.');
    if (!testPhone.trim()) return toast.error('Falta el número de prueba.');
    setSendingTest(true);
    try {
      const res = await fetch('/api/broadcasts/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          templateId: template.id,
          phone: testPhone.trim(),
          variables,
        }),
      });
      const data = await res.json();
      if (data?.sent) {
        toast.success('Prueba enviada.');
      } else {
        toast.error(data?.error ?? 'No se envió la prueba.');
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se envió la prueba.');
    } finally {
      setSendingTest(false);
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
    if (!user) return toast.error('Sin sesión.');
    const cleanMapping = Object.fromEntries(
      Object.entries(variableMapping).filter(([, v]) => v),
    );
    const { error } = await supabase.from('broadcasts').insert({
      user_id: user.id,
      name: name.trim(),
      template_name: template.name,
      template_language: template.language ?? 'es',
      template_variables: variables,
      variable_mapping: Object.keys(cleanMapping).length > 0 ? cleanMapping : null,
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
    router.push('/campanas');
  }

  const previewBody = useMemo(() => {
    if (!template?.body_text) {
      return 'Elige una plantilla.';
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
    <div className="mx-auto w-full max-w-6xl space-y-6">
      <div className="flex items-center gap-3">
        <Button
          variant="outline"
          size="icon"
          onClick={() => router.push('/campanas')}
          className="border-border"
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="text-xl font-semibold text-foreground">Nueva campaña</h1>
        </div>
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_400px]">
        <div className="rounded-2xl border border-border bg-card shadow-sm">
          <div className="space-y-6 p-6">
            <Field label="Nombre de la campaña">
              <Input
                placeholder="Reactivación oferta verano"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="bg-background"
              />
            </Field>

            <Field label="Destinatarios">
              <Select
                value={audienceType}
                onValueChange={(v) => setAudienceType(v as AudienceType)}
              >
                <SelectTrigger className="w-full bg-background">
                  <SelectValue labels={AUDIENCE_LABELS} />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(AUDIENCE_LABELS) as AudienceType[]).map((k) => (
                    <SelectItem key={k} value={k}>
                      {AUDIENCE_LABELS[k]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {audienceType === 'segment' && (
                <div className="mt-2 space-y-2">
                  <div className="flex gap-2">
                    <Select
                      value={segmentId}
                      onValueChange={(v) => setSegmentId(v ?? '')}
                    >
                      <SelectTrigger className="flex-1 bg-background">
                        <SelectValue
                          labels={segmentLabels}
                          placeholder={
                            segments.length === 0 ? 'Todavía no hay segmentos' : ''
                          }
                        />
                      </SelectTrigger>
                      <SelectContent>
                        {segments.length === 0 && (
                          <div className="px-2 py-1.5 text-xs text-muted-foreground">
                            Sin segmentos.
                          </div>
                        )}
                        {segments.map((s) => (
                          <SelectItem key={s.id} value={s.id}>
                            {s.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => router.push('/contacts?tab=segments&new=1')}
                      className="border-border text-foreground hover:bg-accent"
                    >
                      <Plus className="size-4" />
                      Crear segmento
                    </Button>
                  </div>
                </div>
              )}
              {audienceType === 'tags' && (
                <div className="mt-2 flex flex-wrap gap-1.5 rounded-lg border border-border bg-background p-2">
                  {tags.length === 0 && (
                    <p className="text-xs text-muted-foreground">Sin etiquetas.</p>
                  )}
                  {tags.map((t) => {
                    const on = selectedTagIds.includes(t.id);
                    return (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => toggleTag(t.id)}
                        className={cn(
                          'rounded-full px-2.5 py-0.5 text-xs transition-colors',
                          on
                            ? 'bg-primary text-primary-foreground'
                            : 'bg-muted text-muted-foreground hover:bg-accent',
                        )}
                      >
                        {t.name}
                      </button>
                    );
                  })}
                </div>
              )}
            </Field>

            {/* Schedule */}
            <Field label="Cuándo enviar">
              <div className="grid grid-cols-2 gap-2">
                <ModeOption
                  active={sendMode === 'now'}
                  onClick={() => setSendMode('now')}
                  title="Ahora"
                  icon={<Send className="size-4" />}
                />
                <ModeOption
                  active={sendMode === 'schedule'}
                  onClick={() => setSendMode('schedule')}
                  title="Programar"
                  icon={<CalendarClock className="size-4" />}
                />
              </div>
              {sendMode === 'schedule' && (
                <SchedulePicker value={scheduledAt} onChange={setScheduledAt} />
              )}
            </Field>

            <Field label="Plantilla">
              <Select value={templateId} onValueChange={(v) => setTemplateId(v ?? '')}>
                <SelectTrigger className="w-full bg-background">
                  <SelectValue labels={templateLabels} placeholder="" />
                </SelectTrigger>
                <SelectContent>
                  {templates.length === 0 && (
                    <div className="px-2 py-1.5 text-xs text-muted-foreground">
                      Sin plantillas aprobadas.
                    </div>
                  )}
                  {templates.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.name} · {t.language ?? 'es'}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            {templateVars.length > 0 && (
              <div className="rounded-xl border border-border bg-muted/30 p-4">
                <p className="mb-2 text-xs text-muted-foreground">
                  Por cada variable, elige un campo del contacto o escribe un valor fijo.
                </p>
                <div className="space-y-2">
                  {templateVars.map((v) => {
                    const mapped = variableMapping[v] ?? '';
                    const isFixed = !mapped;
                    return (
                      <div
                        key={v}
                        className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-background px-2 py-1.5"
                      >
                        <span className="rounded-md bg-primary/15 px-2 py-0.5 font-mono text-[11px] font-semibold text-primary">
                          {`{{${v}}}`}
                        </span>
                        <select
                          value={mapped}
                          onChange={(e) =>
                            setVariableMapping((prev) => ({
                              ...prev,
                              [v]: e.target.value,
                            }))
                          }
                          className="h-8 rounded-md border border-border bg-background px-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                        >
                          {BUILTIN_FIELD_OPTIONS.map((opt) => (
                            <option key={opt.value} value={opt.value}>
                              {opt.label}
                            </option>
                          ))}
                          {customFields.length > 0 && (
                            <optgroup label="Campos personalizados">
                              {customFields.map((f) => (
                                <option key={f.id} value={f.id}>
                                  {f.field_name}
                                </option>
                              ))}
                            </optgroup>
                          )}
                        </select>
                        {isFixed && (
                          <Input
                            placeholder="Valor fijo"
                            value={variables[v] ?? ''}
                            onChange={(e) =>
                              setVariables((prev) => ({ ...prev, [v]: e.target.value }))
                            }
                            className="h-8 flex-1 border-0 bg-transparent px-1 text-sm shadow-none focus-visible:ring-0"
                          />
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="rounded-xl border border-border bg-muted/20 p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-foreground">Resumen</p>
                  <p className="text-xs text-muted-foreground">
                    {recipientCount === null
                      ? 'Calculando destinatarios…'
                      : `${recipientCount.toLocaleString('es')} destinatarios`}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-xs text-muted-foreground">Costo estimado</p>
                  <p className="text-sm font-semibold text-foreground">
                    {estimatedCost === null ? '—' : formatUsd(estimatedCost)}
                  </p>
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-border bg-muted/20 p-4">
              <p className="text-sm font-medium text-foreground">Envío de prueba</p>
              <p className="mb-2 text-xs text-muted-foreground">
                Envía esta plantilla a un número para verla en WhatsApp antes de lanzar la campaña.
              </p>
              <div className="flex flex-wrap gap-2">
                <Input
                  placeholder="+57 300 1234567"
                  value={testPhone}
                  onChange={(e) => setTestPhone(e.target.value)}
                  className="h-9 flex-1 min-w-[180px] bg-background"
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleSendTest}
                  disabled={sendingTest || !template}
                  className="border-border"
                >
                  {sendingTest ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Enviando…
                    </>
                  ) : (
                    'Enviar prueba'
                  )}
                </Button>
              </div>
            </div>

            <label className="flex items-start gap-2 rounded-lg border border-border bg-muted/20 px-3 py-2 text-sm text-foreground">
              <input
                type="checkbox"
                checked={createConversations}
                onChange={(e) => setCreateConversations(e.target.checked)}
                className="mt-0.5 accent-primary"
              />
              <span>Abrir una conversación en la bandeja por cada destinatario</span>
            </label>
          </div>

          <div className="flex items-center justify-end gap-2 border-t border-border bg-card/60 px-6 py-4">
            <button
              type="button"
              onClick={handleSaveDraft}
              className="text-sm font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
            >
              Guardar borrador
            </button>
            <Button
              variant="outline"
              onClick={() => router.push('/campanas')}
              className="border-border text-foreground hover:bg-accent"
            >
              Cancelar
            </Button>
            <Button
              onClick={handleSend}
              disabled={isProcessing}
              className="bg-primary text-primary-foreground hover:bg-primary/90"
            >
              {isProcessing ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Enviando…
                </>
              ) : sendMode === 'schedule' ? (
                'Programar'
              ) : (
                'Enviar'
              )}
            </Button>
          </div>
        </div>

        <aside className="lg:sticky lg:top-6 lg:self-start">
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

function Field({
  label,
  children,
}: {
  label: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-foreground">{label}</Label>
      {children}
    </div>
  );
}

function ModeOption({
  active,
  onClick,
  title,
  hint,
  icon,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  hint?: string;
  icon: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors',
        active
          ? 'border-primary/60 bg-primary/10'
          : 'border-border bg-background hover:border-foreground/30',
      )}
    >
      <span
        className={cn(
          'flex size-7 shrink-0 items-center justify-center rounded-md',
          active ? 'bg-primary text-primary-foreground' : 'bg-muted text-foreground',
        )}
      >
        {icon}
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-medium text-foreground">{title}</span>
        {hint && (
          <span className="block text-[11px] text-muted-foreground">{hint}</span>
        )}
      </span>
    </button>
  );
}

function SchedulePicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const summary = describeScheduledAt(value);
  const tz =
    typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().timeZone : '';
  return (
    <div className="mt-3 space-y-3 rounded-xl border border-border bg-muted/20 p-3">
      <div className="flex flex-wrap gap-1.5">
        {SCHEDULE_PRESETS.map((p) => (
          <button
            key={p.label}
            type="button"
            onClick={() => onChange(formatLocalDateTimeInput(applyPreset(p, new Date())))}
            className="rounded-full border border-border bg-background px-2.5 py-0.5 text-xs text-foreground transition-colors hover:bg-accent"
          >
            {p.label}
          </button>
        ))}
      </div>
      <Input
        type="datetime-local"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="bg-background"
      />
      {summary && (
        <p className="text-[11px] text-muted-foreground">
          <span className="font-medium text-foreground">{summary}</span>
          {tz ? ` · ${tz}` : ''}
        </p>
      )}
    </div>
  );
}
