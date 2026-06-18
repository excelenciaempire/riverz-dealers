'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { toast } from 'sonner';
import {
  ArrowLeft,
  ExternalLink,
  Loader2,
  RefreshCw,
  Sparkles,
  Save,
  Plus,
  X,
  AlertCircle,
  CheckCircle2,
  Boxes,
  Wand2,
  FileText,
  MessageSquareQuote,
  Bot,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { formatBundleApp, formatPrice } from '@/lib/products/format';
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
  url: string | null;
  is_bundle: boolean;
  bundle_app: string | null;
  bundle_metadata: Record<string, unknown> | null;
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
}

interface AgentSummary {
  id: string;
  name: string;
  persona: string | null;
  tone: string | null;
  is_active: boolean;
  model: string | null;
}

export default function ProductDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const fetchWithCsrf = useFetchWithCsrf();

  const [product, setProduct] = useState<Product | null>(null);
  const [agents, setAgents] = useState<AgentSummary[]>([]);
  const [allAgents, setAllAgents] = useState<AgentSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [scraping, setScraping] = useState(false);
  const [researching, setResearching] = useState(false);

  // Form state (mirror del producto pero editable).
  const [notes, setNotes] = useState('');
  const [faqs, setFaqs] = useState<Array<{ q: string; a: string }>>([]);

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
      setProduct(prodJson.product);
      setAgents(prodJson.agents ?? []);
      setNotes(prodJson.product.custom_notes ?? '');
      setFaqs(prodJson.product.custom_faqs ?? []);
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

  async function handleSave() {
    if (!product) return;
    setSaving(true);
    try {
      const res = await fetchWithCsrf(`/api/products/${product.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          custom_notes: notes || null,
          custom_faqs: faqs.filter((f) => f.q.trim() && f.a.trim()),
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'No se pudo guardar');
      setProduct(json.product);
      toast.success('Cambios guardados.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al guardar.');
    } finally {
      setSaving(false);
    }
  }

  async function handleScrape() {
    if (!product) return;
    setScraping(true);
    try {
      const res = await fetchWithCsrf(`/api/products/${product.id}/scrape`, {
        method: 'POST',
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Error al scrapear');
      toast.success(`Página leída (${json.chars} caracteres).`);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al scrapear.');
    } finally {
      setScraping(false);
    }
  }

  async function handleResearch() {
    if (!product) return;
    setResearching(true);
    try {
      const res = await fetchWithCsrf(`/api/products/${product.id}/ai-research`, {
        method: 'POST',
      });
      const json = await res.json();
      if (!res.ok)
        throw new Error(json.error ?? 'Error al generar investigación');
      toast.success(`Investigación lista (${json.faqs_count} FAQs).`);
      await load();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Error al generar investigación.',
      );
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

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <Button
            variant="outline"
            size="icon"
            onClick={() => router.push('/productos')}
            className="h-8 w-8 border-border"
            aria-label="Volver"
          >
            <ArrowLeft className="size-4" />
          </Button>
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground">
              {product.vendor ?? product.product_type ?? 'Producto'}
            </p>
            <h1 className="text-xl font-semibold tracking-tight text-foreground">
              {product.title}
            </h1>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              {product.url && (
                <a
                  href={product.url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-0.5 hover:text-foreground"
                >
                  Ver en la tienda
                  <ExternalLink className="size-3" />
                </a>
              )}
              {product.is_bundle && (
                <span className="inline-flex items-center gap-1 rounded-full border border-border bg-card px-2 py-0.5">
                  <Boxes className="size-3" />
                  {formatBundleApp(product.bundle_app)}
                </span>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={handleScrape}
            disabled={scraping}
            className="h-9 border-border bg-transparent text-foreground hover:bg-muted"
          >
            {scraping ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <RefreshCw className="size-4" />
            )}
            Leer página
          </Button>
          <Button
            variant="outline"
            onClick={handleResearch}
            disabled={researching}
            className="h-9 border-border bg-transparent text-foreground hover:bg-muted"
          >
            {researching ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Wand2 className="size-4" />
            )}
            Generar investigación
          </Button>
          <Button
            onClick={handleSave}
            disabled={saving}
            className="h-9 bg-foreground text-background hover:bg-foreground/90"
          >
            {saving ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Save className="size-4" />
            )}
            Guardar
          </Button>
        </div>
      </div>

      {/* Top metrics + image */}
      <div className="grid gap-3 lg:grid-cols-[280px_1fr]">
        <div className="overflow-hidden rounded-lg border border-border bg-card">
          {product.image_url ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={product.image_url}
              alt={product.title}
              className="aspect-square w-full object-cover"
            />
          ) : (
            <div className="flex aspect-square items-center justify-center bg-muted text-muted-foreground/40">
              <FileText className="size-12" />
            </div>
          )}
          <div className="space-y-2 p-3">
            <div className="flex items-baseline justify-between">
              <span className="text-xs uppercase tracking-wide text-muted-foreground">
                Precio
              </span>
              <span className="text-sm tabular-nums text-foreground">
                {product.price_min == null
                  ? '—'
                  : product.price_min === product.price_max
                    ? formatPrice(product.price_min, product.currency)
                    : `${formatPrice(product.price_min, product.currency)} – ${formatPrice(product.price_max ?? 0, product.currency)}`}
              </span>
            </div>
            {product.tags.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {product.tags.slice(0, 8).map((t) => (
                  <span
                    key={t}
                    className="rounded-full border border-border bg-muted px-2 py-0.5 text-[10px] text-muted-foreground"
                  >
                    {t}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Estado del entrenamiento */}
        <div className="space-y-3">
          <TrainingStatusBlock
            scrapeStatus={product.scrape_status}
            scrapedAt={product.scraped_at}
            scrapeError={product.scrape_error}
            researchStatus={product.ai_research_status}
            researchAt={product.ai_research_generated_at}
            researchError={product.ai_research_error}
          />

          {/* Descripción del catálogo (read-only) */}
          {product.description && (
            <div className="rounded-lg border border-border bg-card p-4">
              <h3 className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">
                Descripción del catálogo
              </h3>
              <p className="line-clamp-4 text-sm text-foreground">
                {product.description}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Notas del merchant */}
      <div className="rounded-lg border border-border bg-card p-4">
        <h2 className="flex items-center gap-2 text-sm font-medium text-foreground">
          <FileText className="size-4" />
          Notas para el asistente
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Información que no está en la página del producto pero el bot debería
          saber: política de envío específica, restricciones, datos de uso.
        </p>
        <Textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Ej: Solo enviamos dentro de Bogotá. Fuera de la ciudad, envío por DHL con cargo adicional."
          className="mt-3 min-h-[120px] bg-muted/30"
        />
      </div>

      {/* FAQs editables */}
      <div className="rounded-lg border border-border bg-card p-4">
        <div className="flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-sm font-medium text-foreground">
            <MessageSquareQuote className="size-4" />
            Preguntas frecuentes
          </h2>
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
        <p className="mt-1 text-xs text-muted-foreground">
          Las tuyas tienen prioridad sobre las generadas por la IA.
        </p>

        {faqs.length === 0 && product.ai_generated_faqs.length === 0 && (
          <p className="mt-3 text-xs italic text-muted-foreground">
            Todavía no hay FAQs. Genera investigación o agrega una a mano.
          </p>
        )}

        {/* Custom FAQs (editable) */}
        {faqs.length > 0 && (
          <div className="mt-3 space-y-2">
            {faqs.map((f, idx) => (
              <div
                key={idx}
                className="space-y-1.5 rounded-md border border-border bg-muted/30 p-2.5"
              >
                <div className="flex items-center gap-2">
                  <Input
                    value={f.q}
                    onChange={(e) =>
                      setFaqs((cur) =>
                        cur.map((x, i) => (i === idx ? { ...x, q: e.target.value } : x)),
                      )
                    }
                    placeholder="Pregunta…"
                    className="h-8 bg-card"
                  />
                  <button
                    type="button"
                    onClick={() =>
                      setFaqs((cur) => cur.filter((_, i) => i !== idx))
                    }
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
                  className="min-h-[60px] bg-card text-sm"
                />
              </div>
            ))}
          </div>
        )}

        {/* AI-generated FAQs (read-only, ofrecemos botón para copiar a las custom) */}
        {product.ai_generated_faqs.length > 0 && (
          <div className="mt-4 space-y-2 border-t border-border pt-3">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
              Generadas por IA
            </p>
            {product.ai_generated_faqs.map((f, idx) => {
              const alreadyAdopted = faqs.some(
                (x) => x.q.trim() === f.q.trim() && x.a.trim() === f.a.trim(),
              );
              return (
                <div
                  key={idx}
                  className="rounded-md border border-border bg-muted/20 p-2.5"
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-medium text-foreground">{f.q}</p>
                    <button
                      type="button"
                      onClick={() => {
                        if (alreadyAdopted) return;
                        setFaqs((cur) => [...cur, { q: f.q, a: f.a }]);
                      }}
                      disabled={alreadyAdopted}
                      className={cn(
                        'text-[10px] transition-colors',
                        alreadyAdopted
                          ? 'cursor-default text-emerald-600 dark:text-emerald-400'
                          : 'text-muted-foreground hover:text-foreground',
                      )}
                    >
                      {alreadyAdopted ? 'Adoptada ✓' : 'Adoptar'}
                    </button>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">{f.a}</p>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Asignación de agentes */}
      <div className="rounded-lg border border-border bg-card p-4">
        <h2 className="flex items-center gap-2 text-sm font-medium text-foreground">
          <Bot className="size-4" />
          Asistentes que conocen este producto
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Estos asistentes ven este producto en su catálogo y pueden
          responder dudas sobre él.
        </p>

        {allAgents.length === 0 ? (
          <p className="mt-3 text-xs italic text-muted-foreground">
            Todavía no tienes asistentes.{' '}
            <Link
              href="/asistente"
              className="text-foreground underline hover:text-accent-ink"
            >
              Crea uno en Servicio al cliente.
            </Link>
          </p>
        ) : (
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
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
                      : 'border-border bg-muted/30 hover:bg-muted/60',
                  )}
                >
                  <div
                    className={cn(
                      'mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2',
                      assigned
                        ? 'border-emerald-600 bg-emerald-600 text-white'
                        : 'border-border bg-card',
                    )}
                  >
                    {assigned && <CheckCircle2 className="size-3" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-foreground">
                      {a.name}
                    </p>
                    <p className="truncate text-[11px] text-muted-foreground">
                      {a.tone ?? '—'} · {a.is_active ? 'Activo' : 'Inactivo'}
                    </p>
                  </div>
                  <Sparkles className="size-3.5 shrink-0 text-muted-foreground" />
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Contenido scrapeado (read-only, para que el merchant vea qué encontró Firecrawl) */}
      {product.scraped_content && (
        <details className="rounded-lg border border-border bg-card p-4">
          <summary className="cursor-pointer text-sm font-medium text-foreground">
            Contenido leído de la página ({product.scraped_content.length} caracteres)
          </summary>
          <pre className="mt-3 max-h-96 overflow-auto whitespace-pre-wrap rounded-md border border-border bg-muted/30 p-3 text-xs text-foreground">
            {product.scraped_content}
          </pre>
        </details>
      )}
    </div>
  );
}

function TrainingStatusBlock({
  scrapeStatus,
  scrapedAt,
  scrapeError,
  researchStatus,
  researchAt,
  researchError,
}: {
  scrapeStatus: Product['scrape_status'];
  scrapedAt: string | null;
  scrapeError: string | null;
  researchStatus: Product['ai_research_status'];
  researchAt: string | null;
  researchError: string | null;
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <h3 className="text-xs uppercase tracking-wide text-muted-foreground">
        Entrenamiento del asistente
      </h3>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <Step
          icon={RefreshCw}
          label="Lectura de la página"
          status={scrapeStatus}
          at={scrapedAt}
          error={scrapeError}
        />
        <Step
          icon={Wand2}
          label="Investigación + FAQs"
          status={researchStatus}
          at={researchAt}
          error={researchError}
        />
      </div>
    </div>
  );
}

function Step({
  icon: Icon,
  label,
  status,
  at,
  error,
}: {
  icon: typeof RefreshCw;
  label: string;
  status: string;
  at: string | null;
  error: string | null;
}) {
  const tone =
    status === 'done'
      ? 'border-emerald-600/30 bg-emerald-500/5 text-emerald-700 dark:text-emerald-300'
      : status === 'failed'
        ? 'border-red-600/30 bg-red-500/5 text-red-700 dark:text-red-400'
        : status === 'scraping' || status === 'running'
          ? 'border-amber-600/25 bg-amber-500/5 text-amber-700 dark:text-amber-300'
          : 'border-border bg-muted/30 text-muted-foreground';
  const labelStatus =
    status === 'done'
      ? 'Listo'
      : status === 'failed'
        ? 'Falló'
        : status === 'scraping' || status === 'running'
          ? 'En curso…'
          : 'Pendiente';
  return (
    <div className={cn('rounded-md border p-2.5', tone)}>
      <div className="flex items-center gap-2">
        <Icon className="size-3.5 shrink-0" />
        <span className="text-xs font-medium">{label}</span>
        {status === 'done' && <CheckCircle2 className="ml-auto size-3.5" />}
        {status === 'failed' && <AlertCircle className="ml-auto size-3.5" />}
      </div>
      <p className="mt-1 text-[11px]">{labelStatus}</p>
      {at && (
        <p className="text-[10px] opacity-75">
          {new Date(at).toLocaleString('es-ES', {
            day: '2-digit',
            month: 'short',
            hour: '2-digit',
            minute: '2-digit',
          })}
        </p>
      )}
      {error && <p className="mt-1 text-[10px] opacity-90">{error}</p>}
    </div>
  );
}

