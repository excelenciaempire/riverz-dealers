'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { ArrowLeft, Loader2, Plus, Sparkles, Trash2, X } from 'lucide-react';
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
import { WhatsappPreview } from '@/components/templates/whatsapp-preview';
import {
  extractVariables,
  type TemplateButtonInput,
  type TemplateHeaderType,
} from '@/lib/whatsapp/template-components';

const CATEGORIES = [
  { value: 'MARKETING', label: 'Marketing' },
  { value: 'UTILITY', label: 'Utilidad' },
  { value: 'AUTHENTICATION', label: 'Autenticación' },
] as const;

// Header support is limited to text/none for the official submit path —
// media headers (image/video/document) require uploading a sample via Meta's
// resumable upload API, which is a follow-up.
const HEADER_TYPES: { value: TemplateHeaderType; label: string }[] = [
  { value: 'none', label: 'Sin encabezado' },
  { value: 'text', label: 'Texto' },
];

const LANGUAGES = [
  'es',
  'es_ES',
  'es_MX',
  'es_AR',
  'en_US',
  'en_GB',
  'en',
  'pt_BR',
  'pt_PT',
  'fr',
  'de',
  'it',
];

const BUTTON_TYPES = [
  { value: 'QUICK_REPLY', label: 'Respuesta rápida' },
  { value: 'URL', label: 'Enlace (URL)' },
  { value: 'PHONE_NUMBER', label: 'Llamar (teléfono)' },
] as const;

export function TemplateBuilder() {
  const router = useRouter();

  const [name, setName] = useState('');
  const [language, setLanguage] = useState('es');
  const [category, setCategory] = useState<
    'MARKETING' | 'UTILITY' | 'AUTHENTICATION'
  >('MARKETING');
  const [headerType, setHeaderType] = useState<TemplateHeaderType>('none');
  const [headerText, setHeaderText] = useState('');
  const [bodyText, setBodyText] = useState('');
  const [footerText, setFooterText] = useState('');
  const [buttons, setButtons] = useState<TemplateButtonInput[]>([]);
  const [samples, setSamples] = useState<Record<number, string>>({});

  const [aiOpen, setAiOpen] = useState(false);
  const [brief, setBrief] = useState('');
  const [generating, setGenerating] = useState(false);

  const [submitting, setSubmitting] = useState(false);

  const variables = useMemo(() => extractVariables(bodyText), [bodyText]);

  async function handleGenerate() {
    if (!brief.trim()) {
      toast.error('Describe brevemente el mensaje que quieres generar.');
      return;
    }
    setGenerating(true);
    try {
      const res = await fetch('/api/whatsapp/templates/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brief, language, category }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'No se pudo generar');
      setBodyText(data.body_text);
      toast.success('Mensaje generado. Revísalo y ajústalo antes de enviar.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se pudo generar');
    } finally {
      setGenerating(false);
    }
  }

  function insertVariable() {
    const next = variables.length > 0 ? Math.max(...variables) + 1 : 1;
    setBodyText((prev) => `${prev}{{${next}}}`);
  }

  function addButton() {
    if (buttons.length >= 10) return;
    setButtons((prev) => [...prev, { type: 'QUICK_REPLY', text: '' }]);
  }

  function updateButton(i: number, patch: Partial<TemplateButtonInput>) {
    setButtons((prev) =>
      prev.map((b, idx) => (idx === i ? { ...b, ...patch } : b)),
    );
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
      toast.success(
        'Plantilla enviada a Meta para revisión. Su estado aparecerá como «Pendiente».',
      );
      router.push('/templates');
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'No se pudo crear la plantilla',
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button
          variant="outline"
          size="icon"
          onClick={() => router.push('/templates')}
          className="border-border"
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="text-2xl font-bold text-foreground">Nueva plantilla</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Crea una plantilla oficial y envíala a Meta para su aprobación.
          </p>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        {/* Form */}
        <div className="space-y-5">
          <div className="space-y-2">
            <Label className="text-foreground">Nombre de la plantilla</Label>
            <Input
              placeholder="ej. recordatorio_constancia"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="bg-muted border-border text-foreground"
            />
            <p className="text-[11px] text-muted-foreground">
              Meta lo convertirá a minúsculas con guiones bajos (snake_case).
            </p>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label className="text-foreground">Idioma</Label>
              <Select value={language} onValueChange={(v) => setLanguage(v ?? 'es')}>
                <SelectTrigger className="w-full bg-muted border-border text-foreground">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-muted border-border">
                  {LANGUAGES.map((code) => (
                    <SelectItem
                      key={code}
                      value={code}
                      className="text-foreground focus:bg-accent focus:text-foreground"
                    >
                      {code}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label className="text-foreground">Categoría</Label>
              <Select
                value={category}
                onValueChange={(v) =>
                  setCategory(v as 'MARKETING' | 'UTILITY' | 'AUTHENTICATION')
                }
              >
                <SelectTrigger className="w-full bg-muted border-border text-foreground">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-muted border-border">
                  {CATEGORIES.map((c) => (
                    <SelectItem
                      key={c.value}
                      value={c.value}
                      className="text-foreground focus:bg-accent focus:text-foreground"
                    >
                      {c.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label className="text-foreground">Encabezado</Label>
            <Select
              value={headerType}
              onValueChange={(v) => setHeaderType(v as TemplateHeaderType)}
            >
              <SelectTrigger className="w-full bg-muted border-border text-foreground">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-muted border-border">
                {HEADER_TYPES.map((h) => (
                  <SelectItem
                    key={h.value}
                    value={h.value}
                    className="text-foreground focus:bg-accent focus:text-foreground"
                  >
                    {h.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {headerType === 'text' && (
              <Input
                placeholder="Texto del encabezado (máx. 60)"
                value={headerText}
                maxLength={60}
                onChange={(e) => setHeaderText(e.target.value)}
                className="mt-2 bg-muted border-border text-foreground"
              />
            )}
          </div>

          {/* AI generation */}
          <div className="rounded-lg border border-border bg-card p-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-accent-ink" />
                <span className="text-sm font-medium text-foreground">
                  Generar el mensaje con IA
                </span>
              </div>
              <Switch checked={aiOpen} onCheckedChange={setAiOpen} />
            </div>
            {aiOpen && (
              <div className="mt-3 space-y-2">
                <Textarea
                  placeholder="Describe el mensaje: objetivo, oferta, a quién va dirigido…"
                  value={brief}
                  rows={2}
                  onChange={(e) => setBrief(e.target.value)}
                  className="bg-muted border-border text-foreground resize-none"
                />
                <Button
                  type="button"
                  onClick={handleGenerate}
                  disabled={generating}
                  className="bg-primary hover:bg-primary/90 text-primary-foreground"
                >
                  {generating ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" /> Generando…
                    </>
                  ) : (
                    <>
                      <Sparkles className="h-4 w-4" /> Generar
                    </>
                  )}
                </Button>
              </div>
            )}
          </div>

          {/* Body */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-foreground">Cuerpo del mensaje</Label>
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
              className="bg-muted border-border text-foreground resize-none"
            />
            <p className="text-right text-[11px] text-muted-foreground">
              {bodyText.length}/1024
            </p>
          </div>

          {/* Variable samples */}
          {variables.length > 0 && (
            <div className="space-y-2 rounded-lg border border-border bg-card p-3">
              <p className="text-sm font-medium text-foreground">
                Valores de ejemplo
              </p>
              <p className="text-[11px] text-muted-foreground">
                Meta exige un ejemplo para cada variable.
              </p>
              {variables.map((v) => (
                <div key={v} className="flex items-center gap-2">
                  <span className="w-12 shrink-0 text-xs text-muted-foreground">
                    {`{{${v}}}`}
                  </span>
                  <Input
                    placeholder={`Ejemplo para {{${v}}}`}
                    value={samples[v] ?? ''}
                    onChange={(e) =>
                      setSamples((prev) => ({ ...prev, [v]: e.target.value }))
                    }
                    className="bg-muted border-border text-foreground"
                  />
                </div>
              ))}
            </div>
          )}

          {/* Footer */}
          <div className="space-y-2">
            <Label className="text-foreground">Pie (opcional)</Label>
            <Input
              placeholder="Texto del pie (máx. 60)"
              value={footerText}
              maxLength={60}
              onChange={(e) => setFooterText(e.target.value)}
              className="bg-muted border-border text-foreground"
            />
          </div>

          {/* Buttons */}
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
                className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card p-2"
              >
                <Select
                  value={b.type}
                  onValueChange={(v) =>
                    updateButton(i, {
                      type: v as TemplateButtonInput['type'],
                    })
                  }
                >
                  <SelectTrigger className="w-40 bg-muted border-border text-foreground">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-muted border-border">
                    {BUTTON_TYPES.map((t) => (
                      <SelectItem
                        key={t.value}
                        value={t.value}
                        className="text-foreground focus:bg-accent focus:text-foreground"
                      >
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
                  className="w-40 flex-1 bg-muted border-border text-foreground"
                />
                {b.type === 'URL' && (
                  <Input
                    placeholder="https://…"
                    value={b.url ?? ''}
                    onChange={(e) => updateButton(i, { url: e.target.value })}
                    className="w-full bg-muted border-border text-foreground"
                  />
                )}
                {b.type === 'PHONE_NUMBER' && (
                  <Input
                    placeholder="+57 300 000 0000"
                    value={b.phone_number ?? ''}
                    onChange={(e) =>
                      updateButton(i, { phone_number: e.target.value })
                    }
                    className="w-full bg-muted border-border text-foreground"
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

          <div className="flex items-center gap-2 pt-2">
            <Button
              onClick={handleSubmit}
              disabled={submitting}
              className="bg-primary hover:bg-primary/90 text-primary-foreground"
            >
              {submitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Enviando a Meta…
                </>
              ) : (
                'Enviar a Meta para aprobación'
              )}
            </Button>
            <Button
              variant="outline"
              onClick={() => router.push('/templates')}
              className="border-border text-foreground hover:bg-accent"
            >
              Cancelar
            </Button>
          </div>
        </div>

        {/* Live preview */}
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
