'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { toast } from 'sonner';
import {
  ArrowLeft,
  ExternalLink,
  Loader2,
  RefreshCw,
  Sparkles,
  Plus,
  X,
  MessageSquareQuote,
  Wand2,
  Globe,
  ImagePlus,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { createClient } from '@/lib/supabase/client';
import { useFetchWithCsrf } from '@/lib/api/fetch-with-csrf';
import { useT } from '@/hooks/use-locale';
import { useFormat } from '@/hooks/use-format';

interface Product {
  id: string;
  title: string;
  handle: string;
  description: string | null;
  product_type: string | null;
  vendor: string | null;
  tags: string[];
  price_min: number | null;
  price_max: number | null;
  currency: string | null;
  image_url: string | null;
  images: string[] | null;
  url: string | null;
  websites: string[] | null;
  is_bundle: boolean;
  bundle_app: string | null;
  shop_domain: string | null;
  scrape_status: 'idle' | 'queued' | 'scraping' | 'done' | 'failed';
  scraped_content: string | null;
  scraped_at: string | null;
  scrape_error: string | null;
  custom_notes: string | null;
  custom_faqs: Array<{ q: string; a: string }>;
  ai_generated_faqs: Array<{ q: string; a: string }>;
  ai_research: string | null;
  ai_research_generated_at: string | null;
  ai_research_status: 'idle' | 'queued' | 'running' | 'done' | 'failed';
  ai_research_error: string | null;
  structured_research: {
    differentiators?: string[];
    objections?: Array<{ objection?: string; rebuttal?: string }>;
    [k: string]: unknown;
  } | null;
  say_guidelines: string | null;
  never_say: string[] | null;
  escalation_triggers: string[] | null;
  allowed_offers:
    | Array<
        | string
        | {
            label?: string;
            total?: number | string;
            conditions?: string;
            units?: number | string;
          }
      >
    | null;
  health_sensitive: boolean | null;
}

/** Una oferta de "Precios de venta" tal como se edita en el form.
 *  `units` = número de unidades del paquete; el webhook de pedidos lo usa
 *  para detectar qué oferta eligió el cliente (flujos de recompra). */
interface Offer {
  label: string;
  total: string;
  units: string;
}

const CURRENCIES = ['COP', 'USD', 'ARS', 'MXN', 'CLP', 'PEN', 'EUR', 'BRL'];

/** Textarea (una entrada por línea) → array de strings sin vacíos. */
function linesToArray(text: string): string[] {
  return text
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Cada línea "objeción | respuesta" → { objection, rebuttal }. */
function parseObjections(text: string): Array<{ objection: string; rebuttal: string }> {
  return linesToArray(text).map((line) => {
    const [objection, ...rest] = line.split('|');
    return { objection: objection.trim(), rebuttal: rest.join('|').trim() };
  });
}

export default function ProductDetailPage() {
  const t = useT();
  const fmt = useFormat();
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const fetchWithCsrf = useFetchWithCsrf();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [product, setProduct] = useState<Product | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [scraping, setScraping] = useState(false);
  const [researching, setResearching] = useState(false);
  const [uploading, setUploading] = useState(false);

  // --- Core (siempre visible) ---
  const [title, setTitle] = useState('');
  const [images, setImages] = useState<string[]>([]);
  const [descriptionText, setDescriptionText] = useState('');
  const [offers, setOffers] = useState<Offer[]>([]);
  const [currency, setCurrency] = useState('COP');
  const [benefits, setBenefits] = useState('');
  const [websites, setWebsites] = useState<string[]>([]);

  // --- Contexto avanzado (colapsado) ---
  const [notes, setNotes] = useState('');
  const [faqs, setFaqs] = useState<Array<{ q: string; a: string }>>([]);
  const [objections, setObjections] = useState('');
  const [sayGuidelines, setSayGuidelines] = useState('');
  const [neverSay, setNeverSay] = useState('');
  const [escalation, setEscalation] = useState('');
  const [healthSensitive, setHealthSensitive] = useState(false);

  const load = useCallback(async () => {
    if (!params.id) return;
    setLoading(true);
    try {
      const prodRes = await fetch(`/api/products/${params.id}`);
      if (!prodRes.ok) throw new Error('Producto no encontrado');
      const prodJson = await prodRes.json();
      const pr = prodJson.product as Product;
      setProduct(pr);

      setTitle(pr.title ?? '');
      setImages(
        Array.isArray(pr.images) && pr.images.length
          ? pr.images
          : pr.image_url
            ? [pr.image_url]
            : [],
      );
      setDescriptionText(pr.description ?? '');
      setCurrency(pr.currency ?? 'COP');
      setOffers(
        (pr.allowed_offers ?? []).map((o) =>
          typeof o === 'string'
            ? { label: o, total: '', units: '' }
            : {
                label: o.label ?? '',
                total: o.total != null ? String(o.total) : '',
                units: o.units != null ? String(o.units) : '',
              },
        ),
      );
      setBenefits((pr.structured_research?.differentiators ?? []).join('\n'));
      setWebsites(
        Array.isArray(pr.websites) && pr.websites.length
          ? pr.websites
          : pr.url
            ? [pr.url]
            : [],
      );

      setNotes(pr.custom_notes ?? '');
      setFaqs(pr.custom_faqs ?? []);
      setObjections(
        (pr.structured_research?.objections ?? [])
          .map((o) => `${o.objection ?? ''}${o.rebuttal ? ` | ${o.rebuttal}` : ''}`.trim())
          .filter(Boolean)
          .join('\n'),
      );
      setSayGuidelines(pr.say_guidelines ?? '');
      setNeverSay((pr.never_say ?? []).join('\n'));
      setEscalation((pr.escalation_triggers ?? []).join('\n'));
      setHealthSensitive(!!pr.health_sensitive);
    } catch (err) {
      console.error(err);
      toast.error(t('products.loadProductError'));
    } finally {
      setLoading(false);
    }
  }, [params.id, t]);

  useEffect(() => {
    void load();
  }, [load]);

  // La URL del editor lleva el nombre legible (/productos/serum-pilar). Cuando
  // el producto carga —o cambia el nombre y se regenera el handle— reescribimos
  // la barra de direcciones sin recargar. El route resuelve por handle o id.
  useEffect(() => {
    if (!product?.handle) return;
    const desired = `/productos/${product.handle}`;
    if (window.location.pathname !== desired) {
      window.history.replaceState(null, '', desired);
    }
  }, [product?.handle]);

  const buildPatch = useCallback(
    () => ({
      title: title.trim() || undefined,
      images,
      description: descriptionText.trim() || null,
      currency,
      allowed_offers: offers
        .map((o) => {
          const units = parseInt(o.units, 10);
          return {
            label: o.label.trim(),
            total: o.total.trim(),
            ...(Number.isFinite(units) && units > 0 ? { units } : {}),
          };
        })
        .filter((o) => o.label || o.total),
      websites,
      structured_research: {
        ...(product?.structured_research ?? {}),
        differentiators: linesToArray(benefits),
        objections: parseObjections(objections),
      },
      custom_notes: notes || null,
      custom_faqs: faqs.filter((f) => f.q.trim() && f.a.trim()),
      say_guidelines: sayGuidelines.trim() || null,
      never_say: linesToArray(neverSay),
      escalation_triggers: linesToArray(escalation),
      health_sensitive: healthSensitive,
    }),
    [
      title, images, descriptionText, currency, offers, websites, benefits,
      objections, notes, faqs, sayGuidelines, neverSay, escalation,
      healthSensitive, product,
    ],
  );

  const saveProduct = useCallback(async () => {
    if (!product) return false;
    const res = await fetchWithCsrf(`/api/products/${product.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildPatch()),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error ?? t('products.saveFailed'));
    setProduct(json.product);
    return true;
  }, [product, fetchWithCsrf, buildPatch, t]);

  async function handleSave() {
    setSaving(true);
    try {
      await saveProduct();
      toast.success(t('products.saved'));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('products.saveError'));
    } finally {
      setSaving(false);
    }
  }

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setUploading(true);
    try {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error(t('products.sessionExpired'));
      const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
      const path = `${user.id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
      const { error } = await supabase.storage
        .from('product-media')
        .upload(path, file, { cacheControl: '3600', upsert: false });
      if (error) throw new Error(error.message);
      const {
        data: { publicUrl },
      } = supabase.storage.from('product-media').getPublicUrl(path);
      setImages((cur) => [...cur, publicUrl]);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('products.uploadImageError'));
    } finally {
      setUploading(false);
    }
  }

  async function handleRescrape() {
    if (!product) return;
    setScraping(true);
    try {
      // Guardamos primero para que el servidor lea las URLs actuales.
      await saveProduct();
      const res = await fetchWithCsrf(`/api/products/${product.id}/scrape`, {
        method: 'POST',
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? t('products.readPagesError'));
      toast.success(
        json.failed
          ? t('products.pagesReadWithFailures', { sites: json.sites ?? 1, failed: json.failed })
          : t('products.pagesRead', { sites: json.sites ?? 1 }),
      );
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('products.readPagesErrorDot'));
    } finally {
      setScraping(false);
    }
  }

  async function handleResearch() {
    if (!product) return;
    setResearching(true);
    try {
      await saveProduct();
      const res = await fetchWithCsrf(`/api/products/${product.id}/ai-research`, {
        method: 'POST',
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? t('products.researchError'));
      toast.success(t('products.researchReady', { count: json.faqs_count }));
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('products.researchErrorDot'));
    } finally {
      setResearching(false);
    }
  }

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (!product) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-2">
        <p className="text-sm text-muted-foreground">{t('products.productNotFoundDot')}</p>
        <Button variant="outline" onClick={() => router.push('/productos')}>
          {t('products.back')}
        </Button>
      </div>
    );
  }

  const isShopify = product.shop_domain && product.shop_domain !== 'manual';

  return (
    <div className="mx-auto max-w-3xl pb-24">
      {/* Slim header */}
      <div className="mb-6 flex items-center gap-3">
        <Button
          variant="outline"
          size="icon"
          onClick={() => router.push('/productos')}
          className="h-8 w-8 border-border"
          aria-label={t('products.back')}
        >
          <ArrowLeft className="size-4" />
        </Button>
        <p className="text-xs text-muted-foreground">
          {product.vendor ?? product.product_type ?? t('products.product')}
        </p>
      </div>

      {/* Media gallery */}
      <section className="mb-7">
        <div className="flex gap-3 overflow-x-auto pb-1">
          {images.map((src, idx) => (
            <div
              key={`${src}-${idx}`}
              className="group relative size-44 shrink-0 overflow-hidden rounded-xl border border-border bg-card"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={src} alt="" className="size-full object-cover" />
              <button
                type="button"
                onClick={() => setImages((cur) => cur.filter((_, i) => i !== idx))}
                className="absolute right-1.5 top-1.5 rounded-full bg-background/80 p-1 text-foreground opacity-0 backdrop-blur transition-opacity hover:bg-background group-hover:opacity-100"
                aria-label={t('products.removeImage')}
              >
                <X className="size-3.5" />
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="flex size-44 shrink-0 flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed border-border text-muted-foreground transition-colors hover:border-foreground/40 hover:text-foreground"
          >
            {uploading ? (
              <Loader2 className="size-5 animate-spin" />
            ) : (
              <ImagePlus className="size-5" />
            )}
            <span className="text-xs">{t('products.add')}</span>
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            className="hidden"
            onChange={handleUpload}
          />
        </div>
      </section>

      <div className="space-y-7">
        {/* Nombre */}
        <Field label={t('products.name')}>
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="h-11 bg-card text-base"
          />
        </Field>

        {/* Descripción */}
        <Field label={t('products.description')}>
          <Textarea
            value={descriptionText}
            onChange={(e) => setDescriptionText(e.target.value)}
            className="min-h-[96px] bg-card"
          />
        </Field>

        {/* Precios de venta */}
        <Field
          label={t('products.prices')}
          hint={t('products.pricesUnitsHint')}
          action={
            <select
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
              className="h-8 rounded-md border border-border bg-card px-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              aria-label={t('products.currency')}
            >
              {CURRENCIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          }
        >
          <div className="space-y-2">
            {offers.map((o, idx) => (
              <div key={idx} className="flex items-center gap-2">
                <Input
                  value={o.label}
                  onChange={(e) =>
                    setOffers((cur) =>
                      cur.map((x, i) => (i === idx ? { ...x, label: e.target.value } : x)),
                    )
                  }
                  className="h-10 flex-1 bg-card"
                />
                <div className="relative w-16 sm:w-20">
                  <Input
                    value={o.units}
                    onChange={(e) =>
                      setOffers((cur) =>
                        cur.map((x, i) =>
                          i === idx
                            ? { ...x, units: e.target.value.replace(/[^\d]/g, '') }
                            : x,
                        ),
                      )
                    }
                    inputMode="numeric"
                    placeholder={t('products.unitsPlaceholder')}
                    aria-label={t('products.units')}
                    className="h-10 bg-card pr-7 text-center tabular-nums"
                  />
                  <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                    {t('products.unitsSuffix')}
                  </span>
                </div>
                <div className="relative w-28 sm:w-40">
                  <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                    $
                  </span>
                  <Input
                    value={o.total}
                    onChange={(e) =>
                      setOffers((cur) =>
                        cur.map((x, i) => (i === idx ? { ...x, total: e.target.value } : x)),
                      )
                    }
                    inputMode="decimal"
                    className="h-10 bg-card pl-7 tabular-nums"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => setOffers((cur) => cur.filter((_, i) => i !== idx))}
                  className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                  aria-label={t('products.removeOffer')}
                >
                  <X className="size-4" />
                </button>
              </div>
            ))}
            <Button
              variant="outline"
              size="sm"
              onClick={() => setOffers((cur) => [...cur, { label: '', total: '', units: '' }])}
              className="h-8 border-border bg-transparent text-foreground hover:bg-muted"
            >
              <Plus className="size-3.5" />
              {t('products.addOffer')}
            </Button>
          </div>
        </Field>

        {/* Beneficios */}
        <Field label={t('products.benefits')} hint={t('products.onePerLine')}>
          <Textarea
            value={benefits}
            onChange={(e) => setBenefits(e.target.value)}
            className="min-h-[96px] bg-card"
          />
        </Field>

        {/* Sitios web */}
        <Field
          label={t('products.websites')}
          hint={t('products.websitesHint')}
          action={
            <span className="text-[11px] text-muted-foreground">{websites.length}/5</span>
          }
        >
          <div className="space-y-2">
            {websites.map((w, idx) => (
              <div key={idx} className="flex items-center gap-2">
                <div className="relative flex-1">
                  <Globe className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={w}
                    onChange={(e) =>
                      setWebsites((cur) =>
                        cur.map((x, i) => (i === idx ? e.target.value : x)),
                      )
                    }
                    className="h-10 bg-card pl-9"
                  />
                </div>
                {/^https?:\/\//.test(w) && (
                  <a
                    href={w}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                    aria-label={t('products.open')}
                  >
                    <ExternalLink className="size-4" />
                  </a>
                )}
                <button
                  type="button"
                  onClick={() => setWebsites((cur) => cur.filter((_, i) => i !== idx))}
                  className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                  aria-label={t('products.removeSite')}
                >
                  <X className="size-4" />
                </button>
              </div>
            ))}
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={websites.length >= 5}
                onClick={() => setWebsites((cur) => [...cur, ''])}
                className="h-8 border-border bg-transparent text-foreground hover:bg-muted"
              >
                <Plus className="size-3.5" />
                {t('products.addAnotherSite')}
              </Button>
              {websites.some((w) => w.trim()) && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleRescrape}
                  disabled={scraping}
                  className="h-8 border-border bg-transparent text-foreground hover:bg-muted"
                >
                  {scraping ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <RefreshCw className="size-3.5" />
                  )}
                  {t('products.rereadAll')}
                </Button>
              )}
            </div>
            {product.scraped_at && (
              <p className="text-[11px] text-muted-foreground">
                {t('products.lastRead')}{' '}
                {fmt.dateTime(product.scraped_at, {
                  day: '2-digit',
                  month: 'short',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
                {product.scrape_error ? ` · ${product.scrape_error}` : ''}
              </p>
            )}
          </div>
        </Field>

        {/* ---- Contexto avanzado para la IA (colapsado) ---- */}
        <Collapsible
          title={t('products.sellingContext')}
          subtitle={t('products.sellingContextSubtitle')}
          icon={<Sparkles className="size-4" />}
        >
          <div className="space-y-3">
            <Field label={t('products.objections')} hint={t('products.objectionsHint')} compact>
              <Textarea
                value={objections}
                onChange={(e) => setObjections(e.target.value)}
                className="min-h-[64px] bg-card"
              />
            </Field>
            <Field label={t('products.whatToEmphasize')} compact>
              <Textarea
                value={sayGuidelines}
                onChange={(e) => setSayGuidelines(e.target.value)}
                className="min-h-[56px] bg-card"
              />
            </Field>
            <Field label={t('products.assistantNotes')} hint={t('products.assistantNotesHint')} compact>
              <Textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="min-h-[56px] bg-card"
              />
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={t('products.neverSay')} hint={t('products.onePerLineShort')} compact>
                <Textarea
                  value={neverSay}
                  onChange={(e) => setNeverSay(e.target.value)}
                  className="min-h-[56px] bg-card"
                />
              </Field>
              <Field label={t('products.escalateIfMentions')} hint={t('products.onePerLineShort')} compact>
                <Textarea
                  value={escalation}
                  onChange={(e) => setEscalation(e.target.value)}
                  className="min-h-[56px] bg-card"
                />
              </Field>
            </div>
            <label className="flex items-center gap-2 text-xs text-foreground">
              <input
                type="checkbox"
                checked={healthSensitive}
                onChange={(e) => setHealthSensitive(e.target.checked)}
                className="accent-primary"
              />
              {t('products.healthSensitive')}
            </label>
          </div>
        </Collapsible>

        {/* ---- FAQs ---- */}
        <Collapsible
          title={t('products.faqs')}
          subtitle={t('products.faqsSubtitle')}
          icon={<MessageSquareQuote className="size-4" />}
          action={
            <span className="text-[11px] text-muted-foreground">
              {faqs.length + product.ai_generated_faqs.length || 0}
            </span>
          }
        >
          <div className="flex justify-end">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setFaqs((f) => [...f, { q: '', a: '' }])}
              className="h-7 border-border bg-transparent text-foreground hover:bg-muted"
            >
              <Plus className="size-3.5" />
              {t('products.add')}
            </Button>
          </div>
          {faqs.length > 0 && (
            <div className="mt-3 space-y-2">
              {faqs.map((f, idx) => (
                <div key={idx} className="space-y-1.5 rounded-md border border-border bg-card p-2.5">
                  <div className="flex items-center gap-2">
                    <Input
                      value={f.q}
                      onChange={(e) =>
                        setFaqs((cur) =>
                          cur.map((x, i) => (i === idx ? { ...x, q: e.target.value } : x)),
                        )
                      }
                      className="h-8 bg-background"
                    />
                    <button
                      type="button"
                      onClick={() => setFaqs((cur) => cur.filter((_, i) => i !== idx))}
                      className="rounded p-1 text-muted-foreground hover:bg-red-500/10 hover:text-red-500"
                      aria-label={t('products.removeFaq')}
                    >
                      <X className="size-3.5" />
                    </button>
                  </div>
                  <Textarea
                    value={f.a}
                    onChange={(e) =>
                      setFaqs((cur) =>
                        cur.map((x, i) => (i === idx ? { ...x, a: e.target.value } : x)),
                      )
                    }
                    className="min-h-[56px] bg-background text-sm"
                  />
                </div>
              ))}
            </div>
          )}
          {product.ai_generated_faqs.length > 0 && (
            <div className="mt-4 space-y-2 border-t border-border pt-3">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                {t('products.aiGenerated')}
              </p>
              {product.ai_generated_faqs.map((f, idx) => {
                const adopted = faqs.some(
                  (x) => x.q.trim() === f.q.trim() && x.a.trim() === f.a.trim(),
                );
                return (
                  <div key={idx} className="rounded-md border border-border bg-card/60 p-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-medium text-foreground">{f.q}</p>
                      <button
                        type="button"
                        onClick={() => !adopted && setFaqs((cur) => [...cur, { q: f.q, a: f.a }])}
                        disabled={adopted}
                        className={cn(
                          'text-[10px] transition-colors',
                          adopted
                            ? 'cursor-default text-emerald-600 dark:text-emerald-400'
                            : 'text-muted-foreground hover:text-foreground',
                        )}
                      >
                        {adopted ? t('products.adopted') : t('products.adopt')}
                      </button>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">{f.a}</p>
                  </div>
                );
              })}
            </div>
          )}
        </Collapsible>
      </div>

      {/* Sticky save bar */}
      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-background/85 backdrop-blur">
        <div className="mx-auto flex max-w-3xl flex-col gap-2 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:flex-row sm:items-center sm:justify-between">
          <span className="truncate text-xs text-muted-foreground">
            {isShopify ? t('products.syncedFromShopify') : t('products.manualProduct')}
            {' · '}
            {product.title}
          </span>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              onClick={handleResearch}
              disabled={researching || saving}
              className="h-9 border-border bg-transparent text-foreground hover:bg-muted"
            >
              {researching ? <Loader2 className="size-4 animate-spin" /> : <Wand2 className="size-4" />}
              {t('products.generateResearch')}
            </Button>
            <Button
              onClick={handleSave}
              disabled={saving}
              className="h-9 bg-foreground text-background hover:bg-foreground/90"
            >
              {saving ? <Loader2 className="size-4 animate-spin" /> : null}
              {t('products.saveChanges')}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Campo con label, hint y acción opcional a la derecha. */
function Field({
  label,
  hint,
  action,
  compact,
  children,
}: {
  label: string;
  hint?: string;
  action?: React.ReactNode;
  compact?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={compact ? 'space-y-1' : 'space-y-1.5'}>
      <div className="flex items-center justify-between gap-2">
        <label className="text-sm font-medium text-foreground">{label}</label>
        {action}
      </div>
      {hint && <p className="-mt-0.5 text-xs text-muted-foreground">{hint}</p>}
      {children}
    </div>
  );
}

/** Sección colapsable minimalista (default cerrado). */
function Collapsible({
  title,
  subtitle,
  icon,
  action,
  children,
}: {
  title: string;
  subtitle?: string;
  icon?: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <details className="group rounded-xl border border-border bg-card/40">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3">
        <span className="text-muted-foreground">{icon}</span>
        <span className="flex-1">
          <span className="text-sm font-medium text-foreground">{title}</span>
          {subtitle && <span className="ml-2 hidden text-xs text-muted-foreground sm:inline">{subtitle}</span>}
        </span>
        {action}
        <svg
          className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </summary>
      <div className="border-t border-border px-4 py-3">{children}</div>
    </details>
  );
}
