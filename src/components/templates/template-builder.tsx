'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { ArrowLeft, Info, Loader2, Plus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
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
  { value: 'QUICK_REPLY', label: 'Respuesta rápida' },
  { value: 'URL', label: 'Enlace (URL)' },
  { value: 'PHONE_NUMBER', label: 'Llamar' },
] as const;

export function TemplateBuilder() {
  const router = useRouter();

  const [name, setName] = useState('');
  const [language, setLanguage] = useState('es');
  const [category, setCategory] = useState<'MARKETING' | 'UTILITY' | 'AUTHENTICATION'>('MARKETING');
  const [headerType, setHeaderType] = useState<TemplateHeaderType>('none');
  const [headerText, setHeaderText] = useState('');
  const [bodyText, setBodyText] = useState('');
  const [footerText, setFooterText] = useState('');
  const [buttons, setButtons] = useState<TemplateButtonInput[]>([]);
  const [samples, setSamples] = useState<Record<number, string>>({});
  const [submitting, setSubmitting] = useState(false);

  const variables = useMemo(() => extractVariables(bodyText), [bodyText]);

  function insertVariable() {
    const next = variables.length > 0 ? Math.max(...variables) + 1 : 1;
    setBodyText((prev) => `${prev}{{${next}}}`);
  }

  function addButton() {
    if (buttons.length >= 10) return;
    setButtons((prev) => [...prev, { type: 'QUICK_REPLY', text: '' }]);
  }
  function updateButton(i: number, patch: Partial<TemplateButtonInput>) {
    setButtons((prev) => prev.map((b, idx) => (idx === i ? { ...b, ...patch } : b)));
  }
  function removeButton(i: number) {
    setButtons((prev) => prev.filter((_, idx) => idx !== i));
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
          buttons,
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
    <div className="space-y-5">
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
        <h1 className="text-xl font-semibold text-foreground">Nueva plantilla</h1>
      </div>

      <div className="grid gap-5 lg:grid-cols-[1fr_360px]">
        {/* Form card */}
        <div className="rounded-xl border border-border bg-card p-6 shadow-sm">
          <div className="space-y-5">
            <div className="space-y-1.5">
              <Label className="text-foreground">Nombre</Label>
              <Input
                placeholder="recordatorio_constancia"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="bg-background"
              />
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label className="text-foreground">Idioma</Label>
                <Select value={language} onValueChange={(v) => setLanguage(v ?? 'es')}>
                  <SelectTrigger className="w-full bg-background">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {LANGUAGES.map((l) => (
                      <SelectItem key={l.code} value={l.code}>
                        {l.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <div className="flex items-center gap-1.5">
                  <Label className="text-foreground">Categoría</Label>
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
                </div>
                <Select
                  value={category}
                  onValueChange={(v) =>
                    setCategory(v as 'MARKETING' | 'UTILITY' | 'AUTHENTICATION')
                  }
                >
                  <SelectTrigger className="w-full bg-background">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CATEGORIES.map((c) => (
                      <SelectItem key={c.value} value={c.value}>
                        {c.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-foreground">Encabezado</Label>
              <Select
                value={headerType}
                onValueChange={(v) => setHeaderType(v as TemplateHeaderType)}
              >
                <SelectTrigger className="w-full bg-background">
                  <SelectValue />
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
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label className="text-foreground">Mensaje</Label>
                <button
                  type="button"
                  onClick={insertVariable}
                  className="text-xs font-medium text-accent-ink hover:underline"
                >
                  + Añadir variable
                </button>
              </div>
              <Textarea
                placeholder="Escribe el mensaje. Usa {{1}}, {{2}} para variables."
                value={bodyText}
                rows={6}
                maxLength={1024}
                onChange={(e) => setBodyText(e.target.value)}
                className="bg-background resize-none"
              />
              <p className="text-right text-[10px] text-muted-foreground">{bodyText.length}/1024</p>
            </div>

            {variables.length > 0 && (
              <div className="space-y-2 rounded-lg border border-border bg-muted/40 p-3">
                <p className="text-xs font-medium text-foreground">Ejemplos para variables</p>
                {variables.map((v) => (
                  <div key={v} className="flex items-center gap-2">
                    <span className="w-12 shrink-0 text-xs text-muted-foreground tabular-nums">
                      {`{{${v}}}`}
                    </span>
                    <Input
                      placeholder={`Ejemplo`}
                      value={samples[v] ?? ''}
                      onChange={(e) =>
                        setSamples((prev) => ({ ...prev, [v]: e.target.value }))
                      }
                      className="bg-background"
                    />
                  </div>
                ))}
              </div>
            )}

            <div className="space-y-1.5">
              <Label className="text-foreground">Pie (opcional)</Label>
              <Input
                placeholder=""
                value={footerText}
                maxLength={60}
                onChange={(e) => setFooterText(e.target.value)}
                className="bg-background"
              />
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-foreground">Botones (opcional)</Label>
                {buttons.length < 10 && (
                  <button
                    type="button"
                    onClick={addButton}
                    className="flex items-center gap-1 text-xs font-medium text-accent-ink hover:underline"
                  >
                    <Plus className="h-3 w-3" /> Añadir botón
                  </button>
                )}
              </div>
              {buttons.map((b, i) => (
                <div
                  key={i}
                  className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-background p-2"
                >
                  <Select
                    value={b.type}
                    onValueChange={(v) =>
                      updateButton(i, { type: v as TemplateButtonInput['type'] })
                    }
                  >
                    <SelectTrigger className="w-40 bg-background">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {BUTTON_TYPES.map((t) => (
                        <SelectItem key={t.value} value={t.value}>
                          {t.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Input
                    placeholder="Texto del botón"
                    value={b.text}
                    maxLength={25}
                    onChange={(e) => updateButton(i, { text: e.target.value })}
                    className="w-40 flex-1 bg-background"
                  />
                  {b.type === 'URL' && (
                    <Input
                      placeholder="https://…"
                      value={b.url ?? ''}
                      onChange={(e) => updateButton(i, { url: e.target.value })}
                      className="w-full bg-background"
                    />
                  )}
                  {b.type === 'PHONE_NUMBER' && (
                    <Input
                      placeholder="+57 300 000 0000"
                      value={b.phone_number ?? ''}
                      onChange={(e) => updateButton(i, { phone_number: e.target.value })}
                      className="w-full bg-background"
                    />
                  )}
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => removeButton(i)}
                    className="text-muted-foreground hover:text-red-400"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          </div>

          {/* Footer actions */}
          <div className="mt-6 flex items-center justify-end gap-2 border-t border-border pt-4">
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
              className="bg-primary hover:bg-primary/90 text-primary-foreground"
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
            buttons={buttons}
          />
        </div>
      </div>
    </div>
  );
}
