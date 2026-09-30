'use client';

import { SHOW_RIVERZ_IMPROVEMENTS } from '@/lib/ui/improvements-preview';
import { useMemo, useState } from 'react';
import { useLocalizedRouter } from '@/hooks/use-localized-router';
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
  Upload,
  Image as ImageIcon,
  Video,
  FileText,
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
import { TemplateAiDraft } from '@/components/templates/template-ai-draft';
import {
  extractVariables,
  normalizeTemplateName,
  type TemplateButtonInput,
  type TemplateHeaderType,
} from '@/lib/whatsapp/template-components';
import {
  BUTTON_URL_VARIABLES,
  type ButtonUrlVariable,
} from '@/lib/whatsapp/dynamic-links';
import {
  allTemplateDataPoints,
  sampleForTemplateVar,
} from '@/lib/automations/data-points';
import {
  validateTemplate,
  type TemplateIssue,
} from '@/lib/whatsapp/template-validate';
import { darFormaAlCuerpo } from '@/lib/templates/forma';
import { cn } from '@/lib/utils';
import { useFetchWithCsrf } from '@/lib/api/fetch-with-csrf';
import { useT } from '@/hooks/use-locale';

// Module-level option lists store i18n KEY strings; the visible label/hint
// are resolved with t() at render time.
const CATEGORIES: {
  value: 'MARKETING' | 'UTILITY' | 'AUTHENTICATION';
  labelKey: string;
  hintKey: string;
}[] = [
  {
    value: 'MARKETING',
    labelKey: 'templates.categoryMarketing',
    hintKey: 'templates.categoryMarketingHint',
  },
  {
    value: 'UTILITY',
    labelKey: 'templates.categoryUtility',
    hintKey: 'templates.categoryUtilityHint',
  },
  {
    value: 'AUTHENTICATION',
    labelKey: 'templates.categoryAuthentication',
    hintKey: 'templates.categoryAuthenticationHint',
  },
];

const HEADER_TYPES: { value: TemplateHeaderType; labelKey: string }[] = [
  { value: 'none', labelKey: 'templates.headerNone' },
  { value: 'text', labelKey: 'templates.headerTextOption' },
  { value: 'image', labelKey: 'templates.headerImage' },
  { value: 'video', labelKey: 'templates.headerVideo' },
  { value: 'document', labelKey: 'templates.headerDocument' },
];

const LANGUAGES: { code: string; labelKey: string }[] = [
  { code: 'es', labelKey: 'templates.languageEs' },
  { code: 'es_AR', labelKey: 'templates.languageEsAr' },
  { code: 'es_ES', labelKey: 'templates.languageEsEs' },
  { code: 'es_MX', labelKey: 'templates.languageEsMx' },
  { code: 'en', labelKey: 'templates.languageEn' },
  { code: 'en_US', labelKey: 'templates.languageEnUs' },
  { code: 'en_GB', labelKey: 'templates.languageEnGb' },
  { code: 'pt_BR', labelKey: 'templates.languagePtBr' },
  { code: 'pt_PT', labelKey: 'templates.languagePtPt' },
  { code: 'fr', labelKey: 'templates.languageFr' },
  { code: 'de', labelKey: 'templates.languageDe' },
  { code: 'it', labelKey: 'templates.languageIt' },
];

// Link variable de Shopify que puede llenar un botón URL (por cliente, al
// enviar). El valor 'custom' representa un enlace fijo escrito a mano.
const URL_VARIABLE_KEYS: Record<ButtonUrlVariable, string> = {
  abandoned_checkout: 'templates.linkVarAbandonedCheckout',
  order_status: 'templates.linkVarOrderStatus',
  tracking: 'templates.linkVarTracking',
  product: 'templates.linkVarProduct',
  payment: 'templates.linkVarPayment',
};

// URL primero: en comercio el enlace (carrito, pedido, tracking) es lo más
// usado. "Respuesta rápida" va al final: su tap ahora se enruta (el webhook lo
// recibe como type:'button' y dispara automatizaciones por palabra clave /
// flujos), pero requiere que el comercio arme esa reacción, por eso no es lo
// primero.
const BUTTON_TYPES = [
  {
    value: 'URL',
    labelKey: 'templates.buttonUrl',
    hintKey: 'templates.buttonUrlHint',
    Icon: ExternalLink,
  },
  {
    value: 'PHONE_NUMBER',
    labelKey: 'templates.buttonPhone',
    hintKey: 'templates.buttonPhoneHint',
    Icon: Phone,
  },
  {
    value: 'QUICK_REPLY',
    labelKey: 'templates.buttonQuickReply',
    hintKey: 'templates.buttonQuickReplyHint',
    Icon: Reply,
  },
] as const;

export function TemplateBuilder() {
  const router = useLocalizedRouter();
  const fetchWithCsrf = useFetchWithCsrf();
  const t = useT();

  const languageLabels = useMemo(
    () => Object.fromEntries(LANGUAGES.map((l) => [l.code, t(l.labelKey)])),
    [t],
  );
  const categoryLabels = useMemo(
    () => Object.fromEntries(CATEGORIES.map((c) => [c.value, t(c.labelKey)])),
    [t],
  );
  const headerLabels = useMemo(
    () => Object.fromEntries(HEADER_TYPES.map((h) => [h.value, t(h.labelKey)])),
    [t],
  );
  const buttonTypeLabels = useMemo(
    () => Object.fromEntries(BUTTON_TYPES.map((b) => [b.value, t(b.labelKey)])),
    [t],
  );

  const [name, setName] = useState('');
  const [language, setLanguage] = useState('es');
  const [category, setCategory] =
    useState<'MARKETING' | 'UTILITY' | 'AUTHENTICATION'>('MARKETING');
  const [headerType, setHeaderType] = useState<TemplateHeaderType>('none');
  const [headerText, setHeaderText] = useState('');
  const [headerHandle, setHeaderHandle] = useState('');
  const [headerFileName, setHeaderFileName] = useState('');
  const [uploadingHeader, setUploadingHeader] = useState(false);
  const [bodyText, setBodyText] = useState('');
  const [footerText, setFooterText] = useState('');
  const [buttonsOn, setButtonsOn] = useState(false);
  const [buttons, setButtons] = useState<TemplateButtonInput[]>([]);
  const [samples, setSamples] = useState<Record<number, string>>({});
  // Campo dinámico elegido por cada variable {{n}} (p. ej. "customer_name").
  // Vacío = valor personalizado (se escribe el ejemplo a mano).
  const [fields, setFields] = useState<Record<number, string>>({});
  const [submitting, setSubmitting] = useState(false);

  const dataPoints = useMemo(() => allTemplateDataPoints(), []);
  const fieldLabels = useMemo(
    () => ({
      custom: t('templates.variableCustom'),
      ...Object.fromEntries(
        dataPoints.map((dp) => [dp.templateVarKey as string, t(dp.labelKey)]),
      ),
    }),
    [dataPoints, t],
  );
  // Validation only surfaces AFTER the user tries to save — never on a
  // pristine/empty form.
  const [attempted, setAttempted] = useState(false);

  const variables = useMemo(() => extractVariables(bodyText), [bodyText]);

  /**
   * Validación en vivo contra las reglas de Meta. Se recomputa con
   * cada cambio en el form y se muestra como panel debajo del botón
   * de enviar. Bloquea el submit si hay errores; warnings dejan
   * pasar pero los señala.
   */
  const issues: TemplateIssue[] = useMemo(
    () =>
      validateTemplate({
        name,
        language,
        category,
        headerType,
        headerText,
        headerHandle,
        bodyText,
        footerText,
        buttons: buttonsOn ? buttons : [],
        bodySamples: variables.map((v) => samples[v] ?? ''),
      }, t),
    [
      name,
      language,
      category,
      headerType,
      headerText,
      bodyText,
      footerText,
      buttonsOn,
      buttons,
      samples,
      variables,
      t,
    ],
  );
  const blockers = issues.filter((i) => i.severity === 'error');

  function insertVariable() {
    const next = variables.length > 0 ? Math.max(...variables) + 1 : 1;
    setBodyText((prev) => `${prev}{{${next}}}`);
  }

  async function uploadHeader(file: File) {
    setUploadingHeader(true);
    setHeaderHandle('');
    try {
      const form = new FormData();
      form.set('file', file);
      form.set('type', headerType);
      const res = await fetchWithCsrf('/api/whatsapp/templates/header-media', {
        method: 'POST', body: form,
      });
      const data = await res.json();
      if (!res.ok || !data.handle) throw new Error(data.error || t('templates.headerUploadFailed'));
      setHeaderHandle(data.handle);
      setHeaderFileName(data.name || file.name);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('templates.headerUploadFailed'));
    } finally {
      setUploadingHeader(false);
    }
  }

  function toggleButtons(on: boolean) {
    setButtonsOn(on);
    if (on && buttons.length === 0) {
      setButtons([{ type: 'URL', text: '' }]);
    }
    if (!on) setButtons([]);
  }
  function addButton() {
    if (buttons.length >= 10) return;
    setButtons((prev) => [...prev, { type: 'URL', text: '' }]);
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
    setAttempted(true);
    if (blockers.length > 0) {
      toast.error(
        t('templates.fixErrorsBeforeSending', {
          count: blockers.length,
          errorWord: t(
            blockers.length === 1 ? 'templates.errorSingular' : 'templates.errorPlural',
          ),
        }),
      );
      return;
    }
    if (!name.trim()) {
      toast.error(t('templates.missingName'));
      return;
    }
    if (!bodyText.trim()) {
      toast.error(t('templates.missingMessage'));
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetchWithCsrf('/api/whatsapp/templates/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          language,
          category,
          headerType,
          headerText: headerType === 'text' ? headerText : undefined,
          headerHandle: headerType === 'text' || headerType === 'none' ? undefined : headerHandle,
          bodyText,
          footerText,
          buttons: buttonsOn ? normalizeButtons(buttons) : [],
          bodySamples: variables.map((v) =>
            fields[v] ? sampleForTemplateVar(fields[v]) : samples[v] ?? '',
          ),
          // Campo dinámico declarado por variable (índice → clave). Las
          // automatizaciones lo usan para pre-mapear sin configurar a mano.
          variableFields: Object.fromEntries(
            variables
              .filter((v) => fields[v])
              .map((v) => [String(v), fields[v]]),
          ),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || t('templates.createFailed'));
      toast.success(t('templates.templateSent'));
      router.push('/plantillas');
    } catch (err) {
      // Mostrar el motivo REAL (Meta suele explicar por qué rechaza: nombre
      // duplicado, variable inválida, botón mal formado). Tragarlo con un
      // genérico dejaba al comerciante sin saber qué corregir.
      const msg = err instanceof Error && err.message ? err.message : t('templates.createFailed');
      toast.error(msg, { duration: 10000 });
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
          onClick={() => router.push('/plantillas')}
          className="size-10 border-border sm:size-8"
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <h1 className="text-xl font-semibold text-foreground">{t('templates.newTemplate')}</h1>
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_400px]">
        {/* Form card */}
        <div className="rounded-2xl border border-border bg-card shadow-sm">
          <div className="space-y-6 p-6">
            <Field label={t('templates.fieldName')}>
              <Input
                placeholder={t('templates.namePlaceholder')}
                value={name}
                onChange={(e) => setName(normalizeTemplateName(e.target.value))}
                className="bg-background"
              />
            </Field>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label={t('templates.fieldLanguage')}>
                <Select value={language} onValueChange={(v) => setLanguage(v ?? 'es')}>
                  <SelectTrigger className="w-full bg-background">
                    <SelectValue labels={languageLabels} />
                  </SelectTrigger>
                  <SelectContent>
                    {LANGUAGES.map((l) => (
                      <SelectItem key={l.code} value={l.code}>
                        {t(l.labelKey)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>

              <Field
                label={
                  <span className="inline-flex items-center gap-1.5">
                    {t('templates.fieldCategory')}
                    <TooltipProvider delay={150}>
                      <Tooltip>
                        <TooltipTrigger
                          type="button"
                          aria-label={t('templates.categoryTooltip')}
                          className="text-muted-foreground hover:text-foreground"
                        >
                          <Info className="size-3.5" />
                        </TooltipTrigger>
                        <TooltipContent className="max-w-xs space-y-1.5 text-xs">
                          {CATEGORIES.map((c) => (
                            <div key={c.value}>
                              <span className="font-semibold">{t(c.labelKey)}:</span> {t(c.hintKey)}
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
                    <SelectValue labels={categoryLabels} />
                  </SelectTrigger>
                  <SelectContent>
                    {CATEGORIES.map((c) => (
                      <SelectItem key={c.value} value={c.value}>
                        {t(c.labelKey)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </div>

            <Field label={t('templates.fieldHeader')}>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                {[
                  { type: 'none' as const, Icon: X },
                  { type: 'text' as const, Icon: Info },
                  { type: 'image' as const, Icon: ImageIcon },
                  { type: 'video' as const, Icon: Video },
                  { type: 'document' as const, Icon: FileText },
                ].map(({ type, Icon }) => {
                  const selected = headerType === type;
                  return (
                    <button
                      key={type}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => {
                        if (type !== headerType) {
                          setHeaderType(type);
                          setHeaderHandle('');
                          setHeaderFileName('');
                        }
                      }}
                      className={cn(
                        'flex min-h-16 flex-col items-center justify-center gap-1 rounded-lg border px-2 text-xs font-medium transition-colors',
                        selected
                          ? 'border-primary bg-primary/10 text-accent-ink'
                          : 'border-border bg-muted/30 text-muted-foreground hover:border-primary/50 hover:bg-muted hover:text-foreground',
                      )}
                    >
                      <Icon className="size-4" />
                      <span>{headerLabels[type]}</span>
                    </button>
                  );
                })}
              </div>
              {headerType === 'text' && (
                <Input
                  value={headerText}
                  maxLength={60}
                  onChange={(e) => setHeaderText(e.target.value)}
                  className="mt-2 bg-background"
                />
              )}
              {(headerType === 'image' || headerType === 'video' || headerType === 'document') && (
                <div className="mt-2 rounded-lg border border-dashed border-border bg-muted/30 p-3">
                  <label className="flex cursor-pointer items-center justify-between gap-3 text-sm">
                    <span className="truncate text-muted-foreground">
                      {headerFileName || t('templates.headerUploadPrompt')}
                    </span>
                    <span className="inline-flex shrink-0 items-center gap-1.5 font-medium text-accent-ink">
                      {uploadingHeader ? <Loader2 className="size-3.5 animate-spin" /> : <Upload className="size-3.5" />}
                      {uploadingHeader ? t('templates.headerUploading') : t('templates.headerChooseFile')}
                    </span>
                    <input
                      type="file"
                      className="sr-only"
                      accept={headerType === 'image' ? 'image/jpeg,image/png' : headerType === 'video' ? 'video/mp4' : 'application/pdf'}
                      disabled={uploadingHeader}
                      onChange={(e) => { const file = e.target.files?.[0]; if (file) void uploadHeader(file); e.currentTarget.value = ''; }}
                    />
                  </label>
                </div>
              )}
            </Field>

            {/* Message */}
            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Label className="text-foreground">{t('templates.fieldMessage')}</Label>
                {SHOW_RIVERZ_IMPROVEMENTS && <TemplateAiDraft language={language} category={category} onApply={(draft) => {
                  setBodyText(draft);
                  setSamples({});
                  setFields({});
                }} />}
                <button
                  type="button"
                  onClick={insertVariable}
                  className="inline-flex items-center gap-1 text-xs font-medium text-accent-ink hover:underline"
                >
                  <Plus className="size-3" />
                  {t('templates.addVariable')}
                </button>
              </div>
              <Textarea
                placeholder={t('templates.messagePlaceholder')}
                value={bodyText}
                rows={10}
                maxLength={1024}
                onChange={(e) => setBodyText(e.target.value)}
                // Al salir del campo, un párrafo compacto queda en bloques: es
                // la forma que se lee en un chat. Se ve en el propio cuadro y
                // en la vista previa, así que sigue siendo editable; y no se
                // toca lo que ya trae saltos de línea.
                onBlur={(e) => setBodyText(darFormaAlCuerpo(e.target.value))}
                className="min-h-[220px] resize-y bg-background text-sm leading-relaxed"
              />
            </div>

            {variables.length > 0 && (
              <div className="rounded-xl border border-border bg-muted/30 p-4">
                <div className="space-y-2">
                  {variables.map((v) => (
                    <div
                      key={v}
                      className="flex flex-col gap-2 rounded-lg border border-border bg-background px-2 py-2 sm:flex-row sm:items-center"
                    >
                      <span className="w-fit rounded-md bg-primary/15 px-2 py-0.5 font-mono text-[11px] font-semibold text-accent-ink">
                        {`{{${v}}}`}
                      </span>
                      <Select
                        value={fields[v] ?? 'custom'}
                        onValueChange={(val) => {
                          if (!val || val === 'custom') {
                            setFields((prev) => {
                              const next = { ...prev };
                              delete next[v];
                              return next;
                            });
                          } else {
                            setFields((prev) => ({ ...prev, [v]: val }));
                            // Rellenar el ejemplo con un valor realista del campo.
                            setSamples((prev) => ({
                              ...prev,
                              [v]: sampleForTemplateVar(val),
                            }));
                          }
                        }}
                      >
                        <SelectTrigger className="h-8 w-full bg-background sm:flex-1">
                          <SelectValue labels={fieldLabels} />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="custom">
                            {t('templates.variableCustom')}
                          </SelectItem>
                          {dataPoints.map((dp) => (
                            <SelectItem
                              key={dp.templateVarKey}
                              value={dp.templateVarKey as string}
                            >
                              {t(dp.labelKey)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {!fields[v] && (
                        <Input
                          placeholder={t('templates.variableSamplePlaceholder')}
                          value={samples[v] ?? ''}
                          onChange={(e) =>
                            setSamples((prev) => ({ ...prev, [v]: e.target.value }))
                          }
                          className="h-8 w-full bg-background text-sm sm:flex-1"
                        />
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            <Field label={t('templates.fieldFooter')}>
              <Input
                placeholder={t('templates.footerPlaceholder')}
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
                    <p className="text-sm font-semibold text-foreground">{t('templates.buttonsLabel')}</p>
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
                      {t('templates.addButton')}
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Validación en vivo contra las reglas de Meta. Aparece
              solo cuando hay issues; cuando todo está limpio, la
              tarjeta no se muestra. */}
          {attempted && issues.length > 0 && <TemplateIssuesPanel issues={issues} />}

          {/* Footer actions */}
          <div className="flex flex-col gap-2 border-t border-border bg-card/60 px-4 py-4 sm:flex-row sm:items-center sm:justify-end sm:px-6">
            <Button
              variant="outline"
              onClick={() => router.push('/plantillas')}
              className="w-full border-border text-foreground hover:bg-accent sm:w-auto"
            >
              {t('templates.cancel')}
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={submitting}
              className="w-full bg-primary text-primary-foreground hover:bg-primary/90 sm:w-auto"
            >
              {submitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> {t('templates.sending')}
                </>
              ) : (
                t('templates.sendToMeta')
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

/** Prepend https:// when the user typed a bare domain, so they never have to
 *  type the scheme and Meta's https-only rule still passes. Empty stays empty
 *  (a URL button with no URL still surfaces its own "missing URL" error). */
function withHttps(url?: string): string {
  const u = (url ?? '').trim();
  if (!u) return '';
  return /^https?:\/\//i.test(u) ? u : `https://${u}`;
}

function normalizeButtons(buttons: TemplateButtonInput[]): TemplateButtonInput[] {
  return buttons.map((b) => (b.type === 'URL' ? { ...b, url: withHttps(b.url) } : b));
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
  const t = useT();
  const buttonTypeLabels = Object.fromEntries(
    BUTTON_TYPES.map((b) => [b.value, t(b.labelKey)]),
  );
  const urlModeLabels: Record<string, string> = {
    custom: t('templates.buttonUrlModeCustom'),
    ...Object.fromEntries(
      BUTTON_URL_VARIABLES.map((v) => [v, t(URL_VARIABLE_KEYS[v])]),
    ),
  };
  return (
    <div className="rounded-lg border border-border bg-background p-3">
      <div className="grid gap-2 sm:grid-cols-[180px_1fr_auto]">
        <Select
          value={button.type}
          onValueChange={(v) => onChange({ type: v as TemplateButtonInput['type'] })}
        >
          <SelectTrigger className="w-full bg-background">
            <SelectValue labels={buttonTypeLabels} />
          </SelectTrigger>
          <SelectContent>
            {BUTTON_TYPES.map((bt) => (
              <SelectItem key={bt.value} value={bt.value}>
                <span className="inline-flex items-center gap-2">
                  <bt.Icon className="size-3.5 text-muted-foreground" />
                  {t(bt.labelKey)}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          placeholder={t('templates.buttonTextPlaceholder')}
          value={button.text}
          maxLength={25}
          onChange={(e) => onChange({ text: e.target.value })}
          className="bg-background"
        />
        <Button
          variant="ghost"
          size="icon"
          onClick={onRemove}
          aria-label={t('templates.removeButton')}
          className="text-muted-foreground hover:text-red-700 dark:hover:text-red-400"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
      {button.type === 'URL' && (
        <div className="mt-2 space-y-2">
          <Select
            value={button.url_variable ?? 'custom'}
            onValueChange={(v) =>
              v === 'custom'
                ? onChange({ url_variable: undefined })
                : onChange({ url_variable: v as ButtonUrlVariable, url: '' })
            }
          >
            <SelectTrigger className="w-full bg-background">
              <SelectValue labels={urlModeLabels} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="custom">{t('templates.buttonUrlModeCustom')}</SelectItem>
              {BUTTON_URL_VARIABLES.map((v) => (
                <SelectItem key={v} value={v}>
                  {t(URL_VARIABLE_KEYS[v])}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {button.url_variable ? (
            <p className="text-xs text-muted-foreground">
              {t('templates.buttonUrlVariableHint')}
            </p>
          ) : (
            <Input
              placeholder={t('templates.urlPlaceholder')}
              value={button.url ?? ''}
              onChange={(e) => onChange({ url: e.target.value })}
              // Auto-add https:// so the user never has to type the scheme.
              onBlur={() => button.url && onChange({ url: withHttps(button.url) })}
              className="bg-background"
            />
          )}
        </div>
      )}
      {button.type === 'PHONE_NUMBER' && (
        <Input
          placeholder={t('templates.phonePlaceholder')}
          value={button.phone_number ?? ''}
          onChange={(e) => onChange({ phone_number: e.target.value })}
          className="mt-2 bg-background"
        />
      )}
    </div>
  );
}

function TemplateIssuesPanel({ issues }: { issues: TemplateIssue[] }) {
  const t = useT();
  const errors = issues.filter((i) => i.severity === 'error');
  const warnings = issues.filter((i) => i.severity === 'warning');
  return (
    <div
      className={cn(
        'border-t px-6 py-4',
        errors.length > 0
          ? 'border-red-500/30 bg-red-500/5'
          : 'border-amber-500/30 bg-amber-500/5',
      )}
    >
      <div className="mb-2 flex items-center gap-2 text-xs">
        <Info
          className={cn(
            'size-4',
            errors.length > 0
              ? 'text-red-600 dark:text-red-400'
              : 'text-amber-600 dark:text-amber-400',
          )}
        />
        <span className="font-medium text-foreground">
          {errors.length > 0
            ? t(
                errors.length === 1
                  ? 'templates.errorsBlockSendingSingular'
                  : 'templates.errorsBlockSendingPlural',
                { count: errors.length },
              )
            : t(
                warnings.length === 1
                  ? 'templates.suggestionsBeforeSendingSingular'
                  : 'templates.suggestionsBeforeSendingPlural',
                { count: warnings.length },
              )}
        </span>
        <span className="text-muted-foreground">
          {warnings.length > 0 && errors.length > 0 &&
            t(
              warnings.length === 1
                ? 'templates.andWarningsSingular'
                : 'templates.andWarningsPlural',
              { count: warnings.length },
            )}
        </span>
      </div>
      <ul className="space-y-1">
        {issues.map((it, i) => (
          <li
            key={i}
            className={cn(
              'flex items-start gap-2 text-xs',
              it.severity === 'error'
                ? 'text-red-700 dark:text-red-300'
                : 'text-amber-700 dark:text-amber-300',
            )}
          >
            <span className="mt-0.5 size-1.5 shrink-0 rounded-full bg-current opacity-70" />
            <span>{it.message}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
