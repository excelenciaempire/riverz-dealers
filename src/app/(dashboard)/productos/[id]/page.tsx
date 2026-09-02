'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import { useLocalizedRouter } from '@/hooks/use-localized-router';
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
  Trash2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { createClient } from '@/lib/supabase/client';
import { useFetchWithCsrf } from '@/lib/api/fetch-with-csrf';
import { CURRENCY_OPTIONS } from '@/lib/products/currency';
import { useT, useLocale } from '@/hooks/use-locale';
import { useFormat } from '@/hooks/use-format';
import { localizePath, canonicalizePath } from '@/lib/i18n/routes';

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
  /** De dónde vino: 'shopify' | 'mercadolibre' | 'tiendanube' | 'woocommerce'. */
  platform: string | null;
  url: string | null;
  websites: string[] | null;
  prelanding_urls: string[] | null;
  /** Dónde más se vende lo mismo. Presente sólo si está unificado (mig. 183). */
  listings?: Array<{
    id: string;
    platform: string;
    title: string;
    price_min: number | null;
    currency: string | null;
    url: string | null;
    is_master: boolean;
  }>;
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
  allowed_offers: Array<
    | string
    | {
        label?: string;
        total?: number | string;
        conditions?: string;
        units?: number | string;
      }
  > | null;
  health_sensitive: boolean | null;
  /** True when allowed_offers was auto-populated by offer detection (migration 088). */
  offers_auto_detected: boolean | null;
}

/** El nombre de cada plataforma tal como se escribe. La columna guarda el
 *  identificador (`mercadolibre`), que no es lo que se le muestra a nadie. */
const PLATAFORMA: Record<string, string> = {
  shopify: 'Shopify',
  mercadolibre: 'Mercado Libre',
  tiendanube: 'Tiendanube',
  woocommerce: 'WooCommerce',
};

/** Una oferta de "Precios de venta" tal como se edita en el form.
 *  `units` = número de unidades del paquete; el webhook de pedidos lo usa
 *  para detectar qué oferta eligió el cliente (flujos de recompra). */
interface Offer {
  label: string;
  total: string;
  units: string;
}

const CURRENCIES: string[] = [...CURRENCY_OPTIONS];

/** Textarea (una entrada por línea) → array de strings sin vacíos. */
function linesToArray(text: string): string[] {
  return text
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Cada línea "objeción | respuesta" → { objection, rebuttal }. */
function parseObjections(
  text: string
): Array<{ objection: string; rebuttal: string }> {
  return linesToArray(text).map((line) => {
    const [objection, ...rest] = line.split('|');
    return { objection: objection.trim(), rebuttal: rest.join('|').trim() };
  });
}

export default function ProductDetailPage() {
  const t = useT();
  const { locale } = useLocale();
  const fmt = useFormat();
  const params = useParams<{ id: string }>();
  const router = useLocalizedRouter();
  const fetchWithCsrf = useFetchWithCsrf();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [product, setProduct] = useState<Product | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [scraping, setScraping] = useState(false);
  const [researching, setResearching] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [syncingImages, setSyncingImages] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  /** Cuántos asistentes tienen este producto asignado — lo avisamos antes de borrar. */
  const [assignedAgents, setAssignedAgents] = useState(0);

  // --- Core (siempre visible) ---
  const [title, setTitle] = useState('');
  const [images, setImages] = useState<string[]>([]);
  const [descriptionText, setDescriptionText] = useState('');
  const [offers, setOffers] = useState<Offer[]>([]);
  const [offersAutoDetected, setOffersAutoDetected] = useState(false);
  const [currency, setCurrency] = useState('COP');
  const [benefits, setBenefits] = useState('');
  const [websites, setWebsites] = useState<string[]>([]);
  // Las publicaciones del mismo producto en otras plataformas.
  const [canales, setCanales] = useState<NonNullable<Product['listings']>>([]);
  const [separando, setSeparando] = useState<string | null>(null);

  /** Vuelve a ser un producto por su cuenta. */
  const separar = async (id: string) => {
    setSeparando(id);
    try {
      const res = await fetchWithCsrf(
        `/api/products/unificar?id=${encodeURIComponent(id)}`,
        { method: 'DELETE' }
      );
      if (!res.ok) throw new Error();
      // Se saca de la lista en vez de recargar: la pantalla tiene un formulario
      // a medio editar y recargarla perderia lo que el comercio venia
      // escribiendo.
      setCanales((prev) => prev.filter((c) => c.id !== id));
      toast.success(t('unify.separated'));
    } catch {
      toast.error(t('unify.failed'));
    } finally {
      setSeparando(null);
    }
  };

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
      setAssignedAgents(
        Array.isArray(prodJson.agents) ? prodJson.agents.length : 0
      );

      setTitle(pr.title ?? '');
      setImages(
        Array.isArray(pr.images) && pr.images.length
          ? pr.images
          : pr.image_url
            ? [pr.image_url]
            : []
      );
      setDescriptionText(pr.description ?? '');
      // Divisa: la del producto, o la detectada del workspace en vez de 'COP'.
      setCurrency(pr.currency ?? prodJson.workspace_currency ?? 'COP');
      setOffers(
        (pr.allowed_offers ?? []).map((o) =>
          typeof o === 'string'
            ? { label: o, total: '', units: '' }
            : {
                label: o.label ?? '',
                total: o.total != null ? String(o.total) : '',
                units: o.units != null ? String(o.units) : '',
              }
        )
      );
      setOffersAutoDetected(pr.offers_auto_detected === true);
      setBenefits((pr.structured_research?.differentiators ?? []).join('\n'));
      setCanales(Array.isArray(pr.listings) ? pr.listings : []);
      // Las pre-landings son otra fuente del producto, no una sección aparte.
      // Se muestran junto a la página principal y a las URLs que agregó el
      // comercio, sin repetir una URL que esté persistida en dos columnas.
      setWebsites(
        [...[pr.url], ...(pr.prelanding_urls ?? []), ...(pr.websites ?? [])]
          .map((url) => (typeof url === 'string' ? url.trim() : ''))
          .filter(
            (url, index, urls) => Boolean(url) && urls.indexOf(url) === index
          )
      );

      setNotes(pr.custom_notes ?? '');
      setFaqs(pr.custom_faqs ?? []);
      setObjections(
        (pr.structured_research?.objections ?? [])
          .map((o) =>
            `${o.objection ?? ''}${o.rebuttal ? ` | ${o.rebuttal}` : ''}`.trim()
          )
          .filter(Boolean)
          .join('\n')
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
      window.history.replaceState(
        null,
        '',
        localizePath(canonicalizePath(desired), locale)
      );
    }
  }, [product?.handle, locale]);

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
      title,
      images,
      descriptionText,
      currency,
      offers,
      websites,
      benefits,
      objections,
      notes,
      faqs,
      sayGuidelines,
      neverSay,
      escalation,
      healthSensitive,
      product,
    ]
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
      toast.error(t('products.saveError'));
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
      toast.error(t('products.uploadImageError'));
    } finally {
      setUploading(false);
    }
  }

  /** Trae la galería completa de la(s) plataforma(s) donde vive el producto.
   *  Guarda primero, como el re-leer: el servidor escribe `images` y una
   *  recarga con el formulario sin guardar perdería lo editado. */
  async function handleSyncImages() {
    if (!product) return;
    setSyncingImages(true);
    try {
      await saveProduct();
      const res = await fetchWithCsrf(`/api/products/${product.id}/imagenes`, {
        method: 'POST',
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? t('products.syncImagesError'));
      if (Array.isArray(json.images)) setImages(json.images);
      toast.success(
        json.added > 0
          ? t('products.imagesSynced', { n: json.added })
          : t('products.imagesUpToDate')
      );
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : t('products.syncImagesError')
      );
    } finally {
      setSyncingImages(false);
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
          ? t('products.pagesReadWithFailures', {
              sites: json.sites ?? 1,
              failed: json.failed,
            })
          : t('products.pagesRead', { sites: json.sites ?? 1 })
      );
      await load();
    } catch (err) {
      toast.error(t('products.readPagesErrorDot'));
    } finally {
      setScraping(false);
    }
  }

  async function handleResearch() {
    if (!product) return;
    setResearching(true);
    try {
      await saveProduct();
      const res = await fetchWithCsrf(
        `/api/products/${product.id}/ai-research`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          // La intención explícita del botón es investigar las fuentes que el
          // merchant ve ahora, incluidas las pre-landings recién agregadas. No
          // reutilizamos una lectura anterior en ese caso.
          body: JSON.stringify({ refresh_sources: true }),
        }
      );
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? t('products.researchError'));
      toast.success(t('products.researchReady', { count: json.faqs_count }));
      await load();
    } catch (err) {
      toast.error(t('products.researchErrorDot'));
    } finally {
      setResearching(false);
    }
  }

  async function handleDelete() {
    if (!product) return;
    setDeleting(true);
    try {
      const res = await fetchWithCsrf(`/api/products/${product.id}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error ?? t('products.deleteError'));
      }
      toast.success(t('products.deleted'));
      router.push('/productos');
    } catch {
      toast.error(t('products.deleteError'));
      setDeleting(false);
    }
  }

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="text-muted-foreground size-5 animate-spin" />
      </div>
    );
  }
  if (!product) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-2">
        <p className="text-muted-foreground text-sm">
          {t('products.productNotFoundDot')}
        </p>
        <Button variant="outline" onClick={() => router.push('/productos')}>
          {t('products.back')}
        </Button>
      </div>
    );
  }

  const isShopify = product.shop_domain && product.shop_domain !== 'manual';
  // ¿Está publicado en alguna plataforma? Sólo entonces hay fotos que traer:
  // un producto cargado a mano no tiene de dónde.
  const sincronizado =
    Boolean(isShopify) || (product.listings?.length ?? 0) > 0;

  return (
    <div className="mx-auto max-w-3xl">
      {/* Slim header */}
      <div className="mb-6 flex items-center gap-3">
        <Button
          variant="outline"
          size="icon"
          onClick={() => router.push('/productos')}
          className="border-border h-8 w-8"
          aria-label={t('products.back')}
        >
          <ArrowLeft className="size-4" />
        </Button>
        <p className="text-muted-foreground text-xs">
          {product.vendor ?? product.product_type ?? t('products.product')}
        </p>
      </div>

      {/* Media gallery */}
      <section className="mb-7">
        {sincronizado && (
          <div className="mb-2 flex justify-end">
            <Button
              variant="outline"
              size="sm"
              onClick={handleSyncImages}
              disabled={syncingImages}
              title={t('products.syncImagesTitle')}
              className="border-border text-foreground hover:bg-muted h-8 bg-transparent"
            >
              {syncingImages ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <RefreshCw className="size-3.5" />
              )}
              {t('products.syncImages')}
            </Button>
          </div>
        )}
        <div className="flex gap-3 overflow-x-auto pb-1">
          {images.map((src, idx) => (
            <div
              key={`${src}-${idx}`}
              className="group border-border bg-card relative size-44 shrink-0 overflow-hidden rounded-xl border"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={src} alt="" className="size-full object-cover" />
              <button
                type="button"
                onClick={() =>
                  setImages((cur) => cur.filter((_, i) => i !== idx))
                }
                className="bg-background/80 text-foreground hover:bg-background absolute top-1.5 right-1.5 rounded-full p-1 opacity-0 backdrop-blur transition-opacity group-hover:opacity-100"
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
            className="border-border text-muted-foreground hover:border-foreground/40 hover:text-foreground flex size-44 shrink-0 flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed transition-colors"
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
            className="bg-card h-11 text-base"
          />
        </Field>

        {/* Descripción */}
        <Field label={t('products.description')}>
          <Textarea
            value={descriptionText}
            onChange={(e) => setDescriptionText(e.target.value)}
            className="bg-card min-h-[96px]"
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
              className="border-border bg-card text-foreground focus:ring-ring h-8 rounded-md border px-2 text-xs focus:ring-1 focus:outline-none"
              aria-label={t('products.currency')}
            >
              {(currency && !CURRENCIES.includes(currency)
                ? [currency, ...CURRENCIES]
                : CURRENCIES
              ).map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          }
        >
          <div className="space-y-2">
            {product.price_min != null && (
              <div className="border-border bg-muted/30 flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-sm">
                <span className="text-muted-foreground">
                  {t('products.catalogPrice')}
                </span>
                <span className="text-foreground font-medium tabular-nums">
                  {product.price_min === product.price_max
                    ? fmt.money(product.price_min, product.currency ?? currency)
                    : `${fmt.money(product.price_min, product.currency ?? currency)} – ${fmt.money(product.price_max ?? product.price_min, product.currency ?? currency)}`}
                </span>
              </div>
            )}
            {offersAutoDetected && offers.length > 0 && (
              <div className="border-primary/30 bg-primary/5 text-accent-ink flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-[11px]">
                <Sparkles className="size-3.5 shrink-0" />
                {t('products.offersAutoDetectedHint')}
              </div>
            )}
            {offers.length > 0 && (
              <div className="text-muted-foreground flex items-center gap-2 px-0.5 text-[11px] font-medium tracking-wide uppercase">
                <span className="flex-1">{t('products.offerName')}</span>
                <span className="w-16 text-center sm:w-20">
                  {t('products.units')}
                </span>
                <span className="w-28 sm:w-40">{t('products.offerPrice')}</span>
                <span className="w-7" />
              </div>
            )}
            {offers.map((o, idx) => (
              <div key={idx} className="flex items-center gap-2">
                <Input
                  value={o.label}
                  onChange={(e) =>
                    setOffers((cur) =>
                      cur.map((x, i) =>
                        i === idx ? { ...x, label: e.target.value } : x
                      )
                    )
                  }
                  placeholder={t('products.offerNamePlaceholder')}
                  aria-label={t('products.offerName')}
                  className="bg-card h-10 flex-1"
                />
                <div className="relative w-16 sm:w-20">
                  <Input
                    value={o.units}
                    onChange={(e) =>
                      setOffers((cur) =>
                        cur.map((x, i) =>
                          i === idx
                            ? {
                                ...x,
                                units: e.target.value.replace(/[^\d]/g, ''),
                              }
                            : x
                        )
                      )
                    }
                    inputMode="numeric"
                    placeholder={t('products.unitsPlaceholder')}
                    aria-label={t('products.units')}
                    className="bg-card h-10 pr-7 text-center tabular-nums"
                  />
                  <span className="text-muted-foreground pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 text-xs">
                    {t('products.unitsSuffix')}
                  </span>
                </div>
                <div className="relative w-28 sm:w-40">
                  <span className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-sm">
                    $
                  </span>
                  <Input
                    value={o.total}
                    onChange={(e) =>
                      setOffers((cur) =>
                        cur.map((x, i) =>
                          i === idx ? { ...x, total: e.target.value } : x
                        )
                      )
                    }
                    inputMode="decimal"
                    aria-label={t('products.offerPrice')}
                    className="bg-card h-10 pl-7 tabular-nums"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setOffers((cur) => cur.filter((_, i) => i !== idx));
                    setOffersAutoDetected(false);
                  }}
                  className="text-muted-foreground hover:bg-muted hover:text-foreground rounded p-1.5"
                  aria-label={t('products.removeOffer')}
                >
                  <X className="size-4" />
                </button>
              </div>
            ))}
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setOffers((cur) => [
                  ...cur,
                  { label: '', total: '', units: '' },
                ]);
                setOffersAutoDetected(false);
              }}
              className="border-border text-foreground hover:bg-muted h-8 bg-transparent"
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
            className="bg-card min-h-[96px]"
          />
        </Field>

        {/* Dónde más se vende.
            Sólo aparece si el producto está unificado. Es la contracara de
            unir: quien lo hizo mal necesita poder deshacerlo, y sin salida el
            comercio deja de animarse a usar el botón de unir. */}
        {canales.length > 1 ? (
          <Field label={t('unify.channels')}>
            <div className="space-y-1.5">
              {canales.map((c) => (
                <div
                  key={c.id}
                  className="border-border flex items-center justify-between gap-3 rounded-lg border px-3 py-2"
                >
                  <div className="min-w-0">
                    <p className="text-foreground truncate text-xs">
                      <span className="font-medium">
                        {PLATAFORMA[c.platform] ?? c.platform}
                      </span>
                      {c.price_min != null
                        ? ` · ${c.price_min} ${c.currency ?? ''}`
                        : ''}
                    </p>
                    <p className="text-muted-foreground truncate text-[11px]">
                      {c.title}
                    </p>
                  </div>
                  {/* La principal no se separa de sí misma: es la que manda el
                      conocimiento y las otras cuelgan de ella. */}
                  {c.is_master ? null : (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={separando === c.id}
                      onClick={() => separar(c.id)}
                    >
                      {t('unify.separate')}
                    </Button>
                  )}
                </div>
              ))}
            </div>
          </Field>
        ) : null}

        {/* Sitios web */}
        <Field
          label={t('products.websites')}
          hint={t('products.websitesHint')}
          action={
            <span className="text-muted-foreground text-[11px]">
              {websites.length}/5
            </span>
          }
        >
          <div className="space-y-2">
            {websites.map((w, idx) => (
              <div key={idx} className="flex items-center gap-2">
                <div className="relative flex-1">
                  <Globe className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2" />
                  <Input
                    value={w}
                    onChange={(e) =>
                      setWebsites((cur) =>
                        cur.map((x, i) => (i === idx ? e.target.value : x))
                      )
                    }
                    className="bg-card h-10 pl-9"
                  />
                </div>
                {/^https?:\/\//.test(w) && (
                  <a
                    href={w}
                    target="_blank"
                    rel="noreferrer"
                    className="text-muted-foreground hover:bg-muted hover:text-foreground rounded p-1.5"
                    aria-label={t('products.open')}
                  >
                    <ExternalLink className="size-4" />
                  </a>
                )}
                <button
                  type="button"
                  onClick={() =>
                    setWebsites((cur) => cur.filter((_, i) => i !== idx))
                  }
                  className="text-muted-foreground hover:bg-muted hover:text-foreground rounded p-1.5"
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
                className="border-border text-foreground hover:bg-muted h-8 bg-transparent"
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
                  className="border-border text-foreground hover:bg-muted h-8 bg-transparent"
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
              <p className="text-muted-foreground text-[11px]">
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
            <Field
              label={t('products.objections')}
              hint={t('products.objectionsHint')}
              compact
            >
              <Textarea
                value={objections}
                onChange={(e) => setObjections(e.target.value)}
                className="bg-card min-h-[64px]"
              />
            </Field>
            <Field label={t('products.whatToEmphasize')} compact>
              <Textarea
                value={sayGuidelines}
                onChange={(e) => setSayGuidelines(e.target.value)}
                className="bg-card min-h-[56px]"
              />
            </Field>
            <Field
              label={t('products.assistantNotes')}
              hint={t('products.assistantNotesHint')}
              compact
            >
              <Textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="bg-card min-h-[56px]"
              />
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field
                label={t('products.neverSay')}
                hint={t('products.onePerLineShort')}
                compact
              >
                <Textarea
                  value={neverSay}
                  onChange={(e) => setNeverSay(e.target.value)}
                  className="bg-card min-h-[56px]"
                />
              </Field>
              <Field
                label={t('products.escalateIfMentions')}
                hint={t('products.onePerLineShort')}
                compact
              >
                <Textarea
                  value={escalation}
                  onChange={(e) => setEscalation(e.target.value)}
                  className="bg-card min-h-[56px]"
                />
              </Field>
            </div>
            <label className="text-foreground flex items-center gap-2 text-xs">
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
            <span className="text-muted-foreground text-[11px]">
              {faqs.length + product.ai_generated_faqs.length || 0}
            </span>
          }
        >
          <div className="flex justify-end">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setFaqs((f) => [...f, { q: '', a: '' }])}
              className="border-border text-foreground hover:bg-muted h-7 bg-transparent"
            >
              <Plus className="size-3.5" />
              {t('products.add')}
            </Button>
          </div>
          {faqs.length > 0 && (
            <div className="mt-3 space-y-2">
              {faqs.map((f, idx) => (
                <div
                  key={idx}
                  className="border-border bg-card space-y-1.5 rounded-md border p-2.5"
                >
                  <div className="flex items-center gap-2">
                    <Input
                      value={f.q}
                      onChange={(e) =>
                        setFaqs((cur) =>
                          cur.map((x, i) =>
                            i === idx ? { ...x, q: e.target.value } : x
                          )
                        )
                      }
                      className="bg-background h-8"
                    />
                    <button
                      type="button"
                      onClick={() =>
                        setFaqs((cur) => cur.filter((_, i) => i !== idx))
                      }
                      className="text-muted-foreground rounded p-1 hover:bg-red-500/10 hover:text-red-500"
                      aria-label={t('products.removeFaq')}
                    >
                      <X className="size-3.5" />
                    </button>
                  </div>
                  <Textarea
                    value={f.a}
                    onChange={(e) =>
                      setFaqs((cur) =>
                        cur.map((x, i) =>
                          i === idx ? { ...x, a: e.target.value } : x
                        )
                      )
                    }
                    className="bg-background min-h-[56px] text-sm"
                  />
                </div>
              ))}
            </div>
          )}
          {product.ai_generated_faqs.length > 0 && (
            <div className="border-border mt-4 space-y-2 border-t pt-3">
              <p className="text-muted-foreground text-[10px] tracking-wide uppercase">
                {t('products.aiGenerated')}
              </p>
              {product.ai_generated_faqs.map((f, idx) => {
                const adopted = faqs.some(
                  (x) => x.q.trim() === f.q.trim() && x.a.trim() === f.a.trim()
                );
                return (
                  <div
                    key={idx}
                    className="border-border bg-card/60 rounded-md border p-2.5"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-foreground text-sm font-medium">
                        {f.q}
                      </p>
                      <button
                        type="button"
                        onClick={() =>
                          !adopted &&
                          setFaqs((cur) => [...cur, { q: f.q, a: f.a }])
                        }
                        disabled={adopted}
                        className={cn(
                          'text-[10px] transition-colors',
                          adopted
                            ? 'cursor-default text-emerald-600 dark:text-emerald-400'
                            : 'text-muted-foreground hover:text-foreground'
                        )}
                      >
                        {adopted ? t('products.adopted') : t('products.adopt')}
                      </button>
                    </div>
                    <p className="text-muted-foreground mt-1 text-xs">{f.a}</p>
                  </div>
                );
              })}
            </div>
          )}
        </Collapsible>
      </div>

      {/* Barra de acciones — sticky dentro de la columna para que quede
          alineada con el formulario (antes era fixed a la ventana y se
          descolgaba del contenido). */}
      <div className="border-border bg-background/85 sticky bottom-0 z-20 mt-8 border-t pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur">
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground hidden min-w-0 flex-1 truncate text-xs sm:block">
            {isShopify
              ? t('products.syncedFrom', {
                  platform:
                    PLATAFORMA[product.platform ?? 'shopify'] ??
                    (product.platform || 'Shopify'),
                })
              : t('products.manualProduct')}
            {' · '}
            {product.title}
          </span>
          <Button
            variant="ghost"
            onClick={() => setDeleteOpen(true)}
            disabled={saving || researching || deleting}
            className="text-muted-foreground h-9 hover:bg-red-500/10 hover:text-red-500"
            aria-label={t('products.delete')}
          >
            <Trash2 className="size-4" />
            <span className="hidden sm:inline">{t('products.delete')}</span>
          </Button>
          <Button
            variant="outline"
            onClick={handleResearch}
            disabled={researching || saving}
            className="border-border text-foreground hover:bg-muted h-9 bg-transparent"
          >
            {researching ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Wand2 className="size-4" />
            )}
            {t('products.generateResearch')}
          </Button>
          <Button
            onClick={handleSave}
            disabled={saving}
            className="bg-primary text-primary-foreground hover:bg-primary/90 h-9"
          >
            {saving ? <Loader2 className="size-4 animate-spin" /> : null}
            {t('products.saveChanges')}
          </Button>
        </div>
      </div>

      {/* Confirmación de borrado */}
      <Dialog
        open={deleteOpen}
        onOpenChange={(o) => !deleting && setDeleteOpen(o)}
      >
        <DialogContent className="bg-card text-foreground sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('products.deleteTitle')}</DialogTitle>
          </DialogHeader>
          <div className="text-muted-foreground space-y-1.5 text-sm">
            <p>{t('products.deleteBody', { name: product.title })}</p>
            {assignedAgents > 0 && (
              <p>{t('products.deleteAgentsWarning', { n: assignedAgents })}</p>
            )}
            {isShopify && <p>{t('products.deleteSyncedWarning')}</p>}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDeleteOpen(false)}
              disabled={deleting}
              className="border-border"
            >
              {t('products.cancel')}
            </Button>
            <Button
              onClick={handleDelete}
              disabled={deleting}
              className="bg-red-600 text-white hover:bg-red-600/90"
            >
              {deleting ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Trash2 className="size-4" />
              )}
              {t('products.delete')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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
        <label className="text-foreground text-sm font-medium">{label}</label>
        {action}
      </div>
      {hint && <p className="text-muted-foreground -mt-0.5 text-xs">{hint}</p>}
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
    <details className="group border-border bg-card/40 rounded-xl border">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3">
        <span className="text-muted-foreground">{icon}</span>
        <span className="flex-1">
          <span className="text-foreground text-sm font-medium">{title}</span>
          {subtitle && (
            <span className="text-muted-foreground ml-2 hidden text-xs sm:inline">
              {subtitle}
            </span>
          )}
        </span>
        {action}
        <svg
          className="text-muted-foreground size-4 shrink-0 transition-transform group-open:rotate-180"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </summary>
      <div className="border-border border-t px-4 py-3">{children}</div>
    </details>
  );
}
