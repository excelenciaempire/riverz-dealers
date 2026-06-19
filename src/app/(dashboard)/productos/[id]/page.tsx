'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { toast } from 'sonner';
import {
  ArrowLeft,
  ExternalLink,
  Loader2,
  RefreshCw,
  Sparkles,
  Plus,
  X,
  CheckCircle2,
  Bot,
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
    | Array<string | { label?: string; total?: number | string; conditions?: string }>
    | null;
  health_sensitive: boolean | null;
}

interface AgentSummary {
  id: string;
  name: string;
  persona: string | null;
  tone: string | null;
  is_active: boolean;
  model: string | null;
}

/** Una oferta de "Precios de venta" tal como se edita en el form. */
interface Offer {
  label: string;
  total: string;
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
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const fetchWithCsrf = useFetchWithCsrf();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [product, setProduct] = useState<Product | null>(null);
  const [agents, setAgents] = useState<AgentSummary[]>([]);
  const [allAgents, setAllAgents] = useState<AgentSummary[]>([]);
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
      const [prodRes, agentsRes] = await Promise.all([
        fetch(`/api/products/${params.id}`),
        fetch('/api/ai/agents'),
      ]);
      if (!prodRes.ok) throw new Error('Producto no encontrado');
      const prodJson = await prodRes.json();
      const pr = prodJson.product as Product;
      setProduct(pr);
      setAgents(prodJson.agents ?? []);

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
            ? { label: o, total: '' }
            : { label: o.label ?? '', total: o.total != null ? String(o.total) : '' },
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

      if (agentsRes.ok) {
        const aj = await agentsRes.json();
        setAllAgents(aj.agents ?? []);
      }
    } catch (err) {
      console.error(err);
      toast.error('No se pudo cargar el producto.');
    } finally {
      setLoading(false);
    }
  }, [params.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const buildPatch = useCallback(
    () => ({
      title: title.trim() || undefined,
      images,
      description: descriptionText.trim() || null,
      currency,
      allowed_offers: offers
        .map((o) => ({ label: o.label.trim(), total: o.total.trim() }))
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
    if (!res.ok) throw new Error(json.error ?? 'No se pudo guardar');
    setProduct(json.product);
    return true;
  }, [product, fetchWithCsrf, buildPatch]);

  async function handleSave() {
    setSaving(true);
    try {
      await saveProduct();
      toast.success('Cambios guardados.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al guardar.');
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
      if (!user) throw new Error('Sesión expirada');
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
      toast.error(err instanceof Error ? err.message : 'No se pudo subir la imagen.');
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
      if (!res.ok) throw new Error(json.error ?? 'Error al leer las páginas');
      toast.success(
        `Leídas ${json.sites ?? 1} página(s)${json.failed ? `, ${json.failed} fallaron` : ''}.`,
      );
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al leer las páginas.');
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
      if (!res.ok) throw new Error(json.error ?? 'Error al generar investigación');
      toast.success(`Investigación lista (${json.faqs_count} FAQs).`);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al generar investigación.');
    } finally {
      setResearching(false);
    }
  }

  async function toggleAgent(agentId: string) {
    if (!product) return;
    const assigned = agents.some((a) => a.id === agentId);
    try {
      if (assigned) {
        const res = await fetchWithCsrf(
          `/api/products/${product.id}/agents?agent_id=${agentId}`,
          { method: 'DELETE' },
        );
        if (!res.ok) throw new Error('No se pudo quitar el agente');
        setAgents((cur) => cur.filter((a) => a.id !== agentId));
      } else {
        const res = await fetchWithCsrf(`/api/products/${product.id}/agents`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ agent_id: agentId }),
        });
        if (!res.ok) throw new Error('No se pudo asignar el agente');
        const newAgent = allAgents.find((a) => a.id === agentId);
        if (newAgent) setAgents((cur) => [...cur, newAgent]);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error.');
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
        <p className="text-sm text-muted-foreground">Producto no encontrado.</p>
        <Button variant="outline" onClick={() => router.push('/productos')}>
          Volver
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
          aria-label="Volver"
        >
          <ArrowLeft className="size-4" />
        </Button>
        <p className="text-xs text-muted-foreground">
          {product.vendor ?? product.product_type ?? 'Producto'}
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
                aria-label="Quitar imagen"
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
            <span className="text-xs">Agregar</span>
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
        <Field label="Nombre del producto">
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Ej: Serum facial regenerador"
            className="h-11 bg-card text-base"
          />
        </Field>

        {/* Descripción */}
        <Field label="Descripción" hint="Qué es, para qué sirve y sus beneficios principales.">
          <Textarea
            value={descriptionText}
            onChange={(e) => setDescriptionText(e.target.value)}
            placeholder="Describe el producto como se lo contarías a un cliente."
            className="min-h-[96px] bg-card"
          />
        </Field>

        {/* Precios de venta */}
        <Field
          label="Precios de venta"
          hint="Agrega una o varias ofertas (nombre y precio). Útil si manejas packs o promos por cantidad."
          action={
            <select
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
              className="h-8 rounded-md border border-border bg-card px-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              aria-label="Moneda"
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
                  placeholder="Oferta (ej. 1 unidad)"
                  className="h-10 flex-1 bg-card"
                />
                <div className="relative w-40">
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
                    placeholder="0"
                    className="h-10 bg-card pl-7 tabular-nums"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => setOffers((cur) => cur.filter((_, i) => i !== idx))}
                  className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                  aria-label="Quitar oferta"
                >
                  <X className="size-4" />
                </button>
              </div>
            ))}
            <Button
              variant="outline"
              size="sm"
              onClick={() => setOffers((cur) => [...cur, { label: '', total: '' }])}
              className="h-8 border-border bg-transparent text-foreground hover:bg-muted"
            >
              <Plus className="size-3.5" />
              Agregar oferta
            </Button>
          </div>
        </Field>

        {/* Beneficios */}
        <Field
          label="Beneficios"
          hint="Por qué comprarlo — uno por línea. El agente los usa para vender mejor."
        >
          <Textarea
            value={benefits}
            onChange={(e) => setBenefits(e.target.value)}
            placeholder={'Sin alcohol, no reseca\nVegano y libre de crueldad\nResultados visibles en 2 semanas'}
            className="min-h-[96px] bg-card"
          />
        </Field>

        {/* Sitios web */}
        <Field
          label="Sitios web"
          hint="Hasta 5 páginas. El agente aprende del contenido para responder con precisión."
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
                    placeholder="https://tutienda.com/producto"
                    className="h-10 bg-card pl-9"
                  />
                </div>
                {/^https?:\/\//.test(w) && (
                  <a
                    href={w}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                    aria-label="Abrir"
                  >
                    <ExternalLink className="size-4" />
                  </a>
                )}
                <button
                  type="button"
                  onClick={() => setWebsites((cur) => cur.filter((_, i) => i !== idx))}
                  className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                  aria-label="Quitar sitio"
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
                Agregar otro sitio
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
                  Re-leer todos
                </Button>
              )}
            </div>
            {product.scraped_at && (
              <p className="text-[11px] text-muted-foreground">
                Última lectura:{' '}
                {new Date(product.scraped_at).toLocaleString('es-ES', {
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
          title="Contexto para vender"
          subtitle="Reglas y matices que afinan el copy del agente. Opcional."
          icon={<Sparkles className="size-4" />}
        >
          <div className="space-y-3">
            <Field label="Objeciones y respuesta" hint="Una por línea: objeción | respuesta" compact>
              <Textarea
                value={objections}
                onChange={(e) => setObjections(e.target.value)}
                placeholder={'es caro | rinde 3 meses, sale a ~1.000 por día\n¿funciona en piel grasa? | sí, está formulado para piel grasa'}
                className="min-h-[64px] bg-card"
              />
            </Field>
            <Field label="Qué enfatizar" compact>
              <Textarea
                value={sayGuidelines}
                onChange={(e) => setSayGuidelines(e.target.value)}
                placeholder="Ej: Resalta el envío gratis y la garantía de 30 días."
                className="min-h-[56px] bg-card"
              />
            </Field>
            <Field label="Notas para el asistente" hint="Lo que no está en la página pero debe saber." compact>
              <Textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Ej: Solo enviamos dentro de Bogotá. Fuera, envío por DHL con cargo."
                className="min-h-[56px] bg-card"
              />
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Nunca digas" hint="Una por línea" compact>
                <Textarea
                  value={neverSay}
                  onChange={(e) => setNeverSay(e.target.value)}
                  placeholder={'Cura el acné\nResultados garantizados'}
                  className="min-h-[56px] bg-card"
                />
              </Field>
              <Field label="Pasar a humano si menciona" hint="Una por línea" compact>
                <Textarea
                  value={escalation}
                  onChange={(e) => setEscalation(e.target.value)}
                  placeholder={'reembolso\nestá vencido\nreacción alérgica'}
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
              Producto sensible a temas de salud (el bot evita afirmaciones médicas)
            </label>
          </div>
        </Collapsible>

        {/* ---- FAQs ---- */}
        <Collapsible
          title="Preguntas frecuentes"
          subtitle="Las tuyas tienen prioridad sobre las de la IA."
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
              Agregar
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
                      placeholder="Pregunta…"
                      className="h-8 bg-background"
                    />
                    <button
                      type="button"
                      onClick={() => setFaqs((cur) => cur.filter((_, i) => i !== idx))}
                      className="rounded p-1 text-muted-foreground hover:bg-red-500/10 hover:text-red-500"
                      aria-label="Quitar FAQ"
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
                    placeholder="Respuesta…"
                    className="min-h-[56px] bg-background text-sm"
                  />
                </div>
              ))}
            </div>
          )}
          {product.ai_generated_faqs.length > 0 && (
            <div className="mt-4 space-y-2 border-t border-border pt-3">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                Generadas por IA
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
                        {adopted ? 'Adoptada ✓' : 'Adoptar'}
                      </button>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">{f.a}</p>
                  </div>
                );
              })}
            </div>
          )}
        </Collapsible>

        {/* ---- Asistentes ---- */}
        <Collapsible
          title="Asistentes que conocen este producto"
          icon={<Bot className="size-4" />}
          action={<span className="text-[11px] text-muted-foreground">{agents.length}</span>}
        >
          {allAgents.length === 0 ? (
            <p className="text-xs italic text-muted-foreground">
              Todavía no tienes asistentes.{' '}
              <Link href="/asistente" className="text-foreground underline hover:text-accent-ink">
                Crea uno en Servicio al cliente.
              </Link>
            </p>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2">
              {allAgents.map((a) => {
                const assigned = agents.some((x) => x.id === a.id);
                return (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => toggleAgent(a.id)}
                    className={cn(
                      'flex items-start gap-2 rounded-md border p-2.5 text-left transition-colors',
                      assigned
                        ? 'border-emerald-600/30 bg-emerald-500/5'
                        : 'border-border bg-card hover:bg-muted/60',
                    )}
                  >
                    <div
                      className={cn(
                        'mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2',
                        assigned
                          ? 'border-emerald-600 bg-emerald-600 text-white'
                          : 'border-border bg-background',
                      )}
                    >
                      {assigned && <CheckCircle2 className="size-3" />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-foreground">{a.name}</p>
                      <p className="truncate text-[11px] text-muted-foreground">
                        {a.tone ?? '—'} · {a.is_active ? 'Activo' : 'Inactivo'}
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </Collapsible>

        {/* ---- Contenido leído ---- */}
        {product.scraped_content && (
          <Collapsible
            title="Contenido leído de la página"
            subtitle={`${product.scraped_content.length} caracteres`}
            icon={<Globe className="size-4" />}
          >
            <pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded-md border border-border bg-card p-3 text-xs text-foreground">
              {product.scraped_content}
            </pre>
          </Collapsible>
        )}
      </div>

      {/* Sticky save bar */}
      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-background/85 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-4 py-3">
          <span className="truncate text-xs text-muted-foreground">
            {isShopify ? 'Sincronizado desde Shopify' : 'Producto manual'}
            {' · '}
            {product.title}
          </span>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              onClick={handleResearch}
              disabled={researching || saving}
              className="h-9 border-border bg-transparent text-foreground hover:bg-muted"
            >
              {researching ? <Loader2 className="size-4 animate-spin" /> : <Wand2 className="size-4" />}
              Generar investigación
            </Button>
            <Button
              onClick={handleSave}
              disabled={saving}
              className="h-9 bg-foreground text-background hover:bg-foreground/90"
            >
              {saving ? <Loader2 className="size-4 animate-spin" /> : null}
              Guardar cambios
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
          {subtitle && <span className="ml-2 text-xs text-muted-foreground">{subtitle}</span>}
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
