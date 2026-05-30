'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import {
  ArrowLeft,
  Info,
  Loader2,
  Plus,
  X,
  MousePointerClick,
  ExternalLink,
  Phone,
  Reply,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { WhatsappPreview } from '@/components/templates/whatsapp-preview';
import {
  extractVariables,
  type TemplateButtonInput,
  type TemplateHeaderType,
} from '@/lib/whatsapp/template-components';
import { cn } from '@/lib/utils';

const CATEGORIES: {
  value: 'MARKETING' | 'UTILITY' | 'AUTHENTICATION';
  label: string;
  hint: string;
}[] = [
  {
    value: 'MARKETING',
    label: 'Marketing',
    hint: 'Promociones, novedades, ofertas y campañas. Requiere consentimiento del contacto.',
  },
  {
    value: 'UTILITY',
    label: 'Utilidad',
    hint: 'Mensajes operativos en respuesta a una acción: confirmaciones, envíos, recordatorios, recibos.',
  },
  {
    value: 'AUTHENTICATION',
    label: 'Autenticación',
    hint: 'Códigos de verificación de un solo uso (OTP) para iniciar sesión o validar la identidad.',
  },
];

const HEADER_TYPES: { value: TemplateHeaderType; label: string }[] = [
  { value: 'none', label: 'Sin encabezado' },
  { value: 'text', label: 'Texto' },
];

const LANGUAGES: { code: string; label: string }[] = [
  { code: 'es', label: 'Español' },
  { code: 'es_AR', label: 'Español (Argentina)' },
  { code: 'es_ES', label: 'Español (España)' },
  { code: 'es_MX', label: 'Español (México)' },
  { code: 'en', label: 'Inglés' },
  { code: 'en_US', label: 'Inglés (EE. UU.)' },
  { code: 'en_GB', label: 'Inglés (Reino Unido)' },
  { code: 'pt_BR', label: 'Portugués (Brasil)' },
  { code: 'pt_PT', label: 'Portugués (Portugal)' },
  { code: 'fr', label: 'Francés' },
  { code: 'de', label: 'Alemán' },
  { code: 'it', label: 'Italiano' },
];

const BUTTON_TYPES = [
  {
    value: 'QUICK_REPLY',
    label: 'Respuesta rápida',
    hint: 'Botón que envía un texto de vuelta cuando el contacto lo toca.',
    Icon: Reply,
  },
  {
    value: 'URL',
    label: 'Enlace (URL)',
    hint: 'Abre una página web al tocarlo.',
    Icon: ExternalLink,
  },
  {
    value: 'PHONE_NUMBER',
    label: 'Llamar por teléfono',
    hint: 'Inicia una llamada al número que indiques.',
    Icon: Phone,
  },
] as const;

const LANGUAGE_LABELS = Object.fromEntries(LANGUAGES.map((l) => [l.code, l.label]));
const CATEGORY_LABELS = Object.fromEntries(CATEGORIES.map((c) => [c.value, c.label]));
const HEADER_LABELS = Object.fromEntries(HEADER_TYPES.map((h) => [h.value, h.label]));
const BUTTON_TYPE_LABELS = Object.fromEntries(BUTTON_TYPES.map((b) => [b.value, b.label]));

export function TemplateBuilder() {
  const router = useRouter();

  const [name, setName] = useState('');
  const [language, setLanguage] = useState('es');
  const [category, setCategory] =
    useState<'MARKETING' | 'UTILITY' | 'AUTHENTICATION'>('MARKETING');
  const [headerType, setHeaderType] = useState<TemplateHeaderType>('none');
  const [headerText, setHeaderText] = useState('');
  const [bodyText, setBodyText] = useState('');
  const [footerText, setFooterText] = useState('');
  const [buttonsOn, setButtonsOn] = useState(false);
  const [buttons, setButtons] = useState<TemplateButtonInput[]>([]);
  const [samples, setSamples] = useState<Record<number, string>>({});
  const [submitting, setSubmitting] = useState(false);

  const variables = useMemo(() => extractVariables(bodyText), [bodyText]);

  function insertVariable() {
    const next = variables.length > 0 ? Math.max(...variables) + 1 : 1;
    setBodyText((prev) => `${prev}{{${next}}}`);
  }

  function toggleButtons(on: boolean) {
    setButtonsOn(on);
    if (on && buttons.length === 0) {
      setButtons([{ type: 'QUICK_REPLY', text: '' }]);
    }
    if (!on) setButtons([]);
  }
  function addButton() {
    if (buttons.length >= 10) return;
    setButtons((prev) => [...prev, { type: 'QUICK_REPLY', text: '' }]);
  }
  function updateButton(i: number, patch: Partial<TemplateButtonInput>) {
    setButtons((prev) => prev.map((b, idx) => (idx === i ? { ...b, ...patch } : b)));
  }
  function removeButton(i: number) {
    setButtons((prev) => {
      const next = prev.filter((_, idx) => idx !== i);
      if (next.length === 0) setButtonsOn(false);
      return next;
    });
  }

  async function handleSubmit() {
    if (!name.trim()) {
      toast.error('Ponle un nombre a la plantilla.');
      return;
    }
    if (!bodyText.trim()) {
      toast.error('El cuerpo del mensaje es obligatorio.');
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch('/api/whatsapp/templates/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          language,
          category,
          headerType,
          headerText: headerType === 'text' ? headerText : undefined,
          bodyText,
          footerText,
          buttons: buttonsOn ? buttons : [],
          bodySamples: variables.map((v) => samples[v] ?? ''),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'No se pudo crear la plantilla');
      toast.success('Plantilla enviada a Meta para revisión.');
      router.push('/templates');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se pudo crear la plantilla');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button
          variant="outline"
          size="icon"
          onClick={() => router.push('/templates')}
          className="border-border"
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="text-xl font-semibold text-foreground">Nueva plantilla</h1>
        </div>
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_400px]">
        {/* Form card */}
        <div className="rounded-2xl border border-border bg-card shadow-sm">
          <div className="space-y-6 p-6">
            <Field label="Nombre">
              <Input
                placeholder="recordatorio_constancia"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="bg-background"
              />
            </Field>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Idioma">
                <Select value={language} onValueChange={(v) => setLanguage(v ?? 'es')}>
                  <SelectTrigger className="w-full bg-background">
                    <SelectValue labels={LANGUAGE_LABELS} />
                  </SelectTrigger>
                  <SelectContent>
                    {LANGUAGES.map((l) => (
                      <SelectItem key={l.code} value={l.code}>
                        {l.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>

              <Field
                label={
                  <span className="inline-flex items-center gap-1.5">
                    Categoría
                    <TooltipProvider delay={150}>
                      <Tooltip>
                        <TooltipTrigger
                          type="button"
                          aria-label="Qué significa cada categoría"
                          className="text-muted-foreground hover:text-foreground"
                        >
                          <Info className="size-3.5" />
                        </TooltipTrigger>
                        <TooltipContent className="max-w-xs space-y-1.5 text-xs">
                          {CATEGORIES.map((c) => (
                            <div key={c.value}>
                              <span className="font-semibold">{c.label}:</span> {c.hint}
                            </div>
                          ))}
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </span>
                }
              >
                <Select
                  value={category}
                  onValueChange={(v) =>
                    setCategory(v as 'MARKETING' | 'UTILITY' | 'AUTHENTICATION')
                  }
                >
                  <SelectTrigger className="w-full bg-background">
                    <SelectValue labels={CATEGORY_LABELS} />
                  </SelectTrigger>
                  <SelectContent>
                    {CATEGORIES.map((c) => (
                      <SelectItem key={c.value} value={c.value}>
                        {c.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </div>

            <Field label="Encabezado">
              <Select
                value={headerType}
                onValueChange={(v) => setHeaderType(v as TemplateHeaderType)}
              >
                <SelectTrigger className="w-full bg-background">
                  <SelectValue labels={HEADER_LABELS} />
                </SelectTrigger>
                <SelectContent>
                  {HEADER_TYPES.map((h) => (
                    <SelectItem key={h.value} value={h.value}>
                      {h.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {headerType === 'text' && (
                <Input
                  placeholder="Texto del encabezado"
                  value={headerText}
                  maxLength={60}
                  onChange={(e) => setHeaderText(e.target.value)}
                  className="mt-2 bg-background"
                />
              )}
            </Field>

            {/* Message */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-foreground">Mensaje</Label>
                <button
                  type="button"
                  onClick={insertVariable}
                  className="inline-flex items-center gap-1 text-xs font-medium text-accent-ink hover:underline"
                >
                  <Plus className="size-3" />
                  Añadir variable
                </button>
              </div>
              <div className="relative">
                <Textarea
                  placeholder="Escribí el mensaje. Usá {{1}}, {{2}} para datos variables."
                  value={bodyText}
                  rows={10}
                  maxLength={1024}
                  onChange={(e) => setBodyText(e.target.value)}
                  className="min-h-[220px] resize-y bg-background text-sm leading-relaxed"
                />
                <span className="pointer-events-none absolute bottom-2 right-3 text-[10px] text-muted-foreground tabular-nums">
                  {bodyText.length}/1024
                </span>
              </div>
            </div>

            {variables.length > 0 && (
              <div className="rounded-xl border border-border bg-muted/30 p-4">
                <div className="mb-3 flex items-center justify-between">
                  <p className="text-sm font-medium text-foreground">
                    Ejemplos para variables
                  </p>
                </div>
                <div className="space-y-2">
                  {variables.map((v) => (
                    <div
                      key={v}
                      className="flex items-center gap-2 rounded-lg border border-border bg-background px-2 py-1.5"
                    >
                      <span className="rounded-md bg-primary/15 px-2 py-0.5 font-mono text-[11px] font-semibold text-primary">
                        {`{{${v}}}`}
                      </span>
                      <Input
                        placeholder="Ej: María"
                        value={samples[v] ?? ''}
                        onChange={(e) =>
                          setSamples((prev) => ({ ...prev, [v]: e.target.value }))
                        }
                        className="h-8 flex-1 border-0 bg-transparent px-1 text-sm shadow-none focus-visible:ring-0"
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}

            <Field label="Pie (opcional)">
              <Input
                placeholder="Equipo Vitalú"
                value={footerText}
                maxLength={60}
                onChange={(e) => setFooterText(e.target.value)}
                className="bg-background"
              />
            </Field>

            {/* Buttons section — Clientify-style toggle card */}
            <div className="rounded-xl border border-border bg-muted/20">
              <div className="flex items-start gap-3 p-4">
                <Switch
                  checked={buttonsOn}
                  onCheckedChange={toggleButtons}
                />
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <MousePointerClick className="size-4 text-foreground" />
                    <p className="text-sm font-semibold text-foreground">Botones</p>
                  </div>
                </div>
              </div>
              {buttonsOn && (
                <div className="space-y-2 border-t border-border/70 px-4 py-3">
                  {buttons.map((b, i) => (
                    <ButtonRow
                      key={i}
                      button={b}
                      onChange={(patch) => updateButton(i, patch)}
                      onRemove={() => removeButton(i)}
                    />
                  ))}
                  {buttons.length < 10 && (
                    <button
                      type="button"
                      onClick={addButton}
                      className="inline-flex items-center gap-1 rounded-md border border-dashed border-border px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:border-foreground/40 hover:text-foreground"
                    >
                      <Plus className="size-3.5" />
                      Añadir otro botón
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Footer actions */}
          <div className="flex items-center justify-end gap-2 border-t border-border bg-card/60 px-6 py-4">
            <Button
              variant="outline"
              onClick={() => router.push('/templates')}
              className="border-border text-foreground hover:bg-accent"
            >
              Cancelar
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={submitting}
              className="bg-primary text-primary-foreground hover:bg-primary/90"
            >
              {submitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Enviando…
                </>
              ) : (
                'Enviar a Meta'
              )}
            </Button>
          </div>
        </div>

        {/* Preview */}
        <div className="lg:sticky lg:top-6 lg:self-start">
          <WhatsappPreview
            headerType={headerType}
            headerText={headerText}
            bodyText={bodyText}
            footerText={footerText}
            buttons={buttonsOn ? buttons : []}
          />
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  children,
  className,
}: {
  label: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('space-y-1.5', className)}>
      <Label className="text-foreground">{label}</Label>
      {children}
    </div>
  );
}

function ButtonRow({
  button,
  onChange,
  onRemove,
}: {
  button: TemplateButtonInput;
  onChange: (patch: Partial<TemplateButtonInput>) => void;
  onRemove: () => void;
}) {
  return (
    <div className="rounded-lg border border-border bg-background p-3">
      <div className="grid gap-2 sm:grid-cols-[180px_1fr_auto]">
        <Select
          value={button.type}
          onValueChange={(v) => onChange({ type: v as TemplateButtonInput['type'] })}
        >
          <SelectTrigger className="w-full bg-background">
            <SelectValue labels={BUTTON_TYPE_LABELS} />
          </SelectTrigger>
          <SelectContent>
            {BUTTON_TYPES.map((t) => (
              <SelectItem key={t.value} value={t.value}>
                <span className="inline-flex items-center gap-2">
                  <t.Icon className="size-3.5 text-muted-foreground" />
                  {t.label}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          placeholder="Texto del botón"
          value={button.text}
          maxLength={25}
          onChange={(e) => onChange({ text: e.target.value })}
          className="bg-background"
        />
        <Button
          variant="ghost"
          size="icon"
          onClick={onRemove}
          aria-label="Quitar botón"
          className="text-muted-foreground hover:text-red-400"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
      {button.type === 'URL' && (
        <Input
          placeholder="https://tu-pagina.com/oferta"
          value={button.url ?? ''}
          onChange={(e) => onChange({ url: e.target.value })}
          className="mt-2 bg-background"
        />
      )}
      {button.type === 'PHONE_NUMBER' && (
        <Input
          placeholder="+57 300 000 0000"
          value={button.phone_number ?? ''}
          onChange={(e) => onChange({ phone_number: e.target.value })}
          className="mt-2 bg-background"
        />
      )}
    </div>
  );
}
