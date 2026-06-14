'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import {
  Search,
  RefreshCw,
  ShoppingBag,
  Sparkles,
  AlertCircle,
  CheckCircle2,
  Boxes,
  ExternalLink,
  Loader2,
  Info,
  Wand2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { formatBundleApp, formatPrice } from '@/lib/products/format';

interface ProductRow {
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
  scrape_status: 'idle' | 'queued' | 'scraping' | 'done' | 'failed';
  scraped_at: string | null;
  ai_research_status: 'idle' | 'queued' | 'running' | 'done' | 'failed';
  ai_research_generated_at: string | null;
  synced_at: string;
  assigned_agent_count: number;
}

type Filter = 'all' | 'pending' | 'done' | 'failed' | 'bundle';

const FILTER_LABEL: Record<Filter, string> = {
  all: 'Todos',
  pending: 'Sin entrenar',
  done: 'Entrenados',
  failed: 'Con error',
  bundle: 'Bundles / combos',
};

export default function ProductosPage() {
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [shopifyConnected, setShopifyConnected] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [training, setTraining] = useState<{
    running: boolean;
    done: number;
    total: number;
    failed: number;
  } | null>(null);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');

  async function fetchProducts() {
    setLoading(true);
    try {
      const res = await fetch('/api/products');
      if (!res.ok) throw new Error('No se pudieron cargar los productos');
      const json = await res.json();
      setProducts(json.products ?? []);
      setShopifyConnected(!!json.shopify_connected);
    } catch (err) {
      console.error(err);
      toast.error('No se pudieron cargar los productos.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void fetchProducts();
  }, []);

  async function handleSync() {
    setSyncing(true);
    try {
      const res = await fetch('/api/products/sync', { method: 'POST' });
      const json = await res.json();
      if (!res.ok) {
        toast.error(json.error ?? 'No se pudo sincronizar');
        return;
      }
      const parts: string[] = [];
      if (json.synced > 0) parts.push(`${json.synced} sincronizados`);
      if (json.deleted > 0) parts.push(`${json.deleted} eliminados`);
      if (json.bundles_detected > 0)
        parts.push(`${json.bundles_detected} bundles detectados`);
      toast.success(parts.length ? parts.join(' · ') : 'Catálogo al día');
      await fetchProducts();
    } catch (err) {
      console.error(err);
      toast.error('No se pudo sincronizar el catálogo.');
    } finally {
      setSyncing(false);
    }
  }

  /**
   * Entrenar TODOS los productos que estén en estado "idle" o "failed".
   * Para cada uno corre scrape + ai-research en secuencia. Lanzamos las
   * llamadas con concurrencia limitada (default 4) para no quemarle el
   * rate limit a Firecrawl/Anthropic. El status se persiste en la DB
   * en cada paso, así que si el usuario cierra la pestaña, los
   * productos completados quedan en "done" y al volver puede retomar
   * los pendientes.
   */
  async function handleTrainAll() {
    const pendientes = products.filter(
      (p) =>
        p.scrape_status === 'idle' ||
        p.scrape_status === 'failed' ||
        p.ai_research_status === 'idle' ||
        p.ai_research_status === 'failed',
    );
    if (pendientes.length === 0) {
      toast.success('Todos los productos ya están entrenados.');
      return;
    }
    const ok = window.confirm(
      `Entrenar ${pendientes.length} producto${pendientes.length === 1 ? '' : 's'}? Esto puede tardar 1-3 segundos por producto. Podés cerrar la pestaña: el progreso se guarda.`,
    );
    if (!ok) return;

    setTraining({ running: true, done: 0, total: pendientes.length, failed: 0 });
    const CONCURRENCY = 4;
    let cursor = 0;
    let done = 0;
    let failed = 0;
    async function worker() {
      while (cursor < pendientes.length) {
        const idx = cursor++;
        const p = pendientes[idx];
        try {
          // scrape primero (so ai-research has more context), después
          // ai-research. Cada fetch espera al endpoint completo.
          if (p.scrape_status !== 'done') {
            await fetch(`/api/products/${p.id}/scrape`, { method: 'POST' });
          }
          await fetch(`/api/products/${p.id}/ai-research`, { method: 'POST' });
          done++;
        } catch {
          failed++;
        } finally {
          setTraining((cur) =>
            cur ? { ...cur, done, failed } : cur,
          );
        }
      }
    }
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    setTraining({ running: false, done, failed, total: pendientes.length });
    toast.success(
      `Entrenamiento listo · ${done} ok${failed > 0 ? ` · ${failed} fallaron` : ''}`,
    );
    await fetchProducts();
  }

  const filtered = useMemo(() => {
    let rows = products;
    if (filter === 'pending') {
      rows = rows.filter(
        (p) => p.scrape_status === 'idle' || p.scrape_status === 'queued',
      );
    } else if (filter === 'done') {
      rows = rows.filter((p) => p.scrape_status === 'done');
    } else if (filter === 'failed') {
      rows = rows.filter((p) => p.scrape_status === 'failed');
    } else if (filter === 'bundle') {
      rows = rows.filter((p) => p.is_bundle);
    }
    const q = query.trim().toLowerCase();
    if (q) {
      rows = rows.filter(
        (p) =>
          p.title.toLowerCase().includes(q) ||
          (p.vendor ?? '').toLowerCase().includes(q) ||
          p.tags.some((t) => t.toLowerCase().includes(q)),
      );
    }
    return rows;
  }, [products, filter, query]);

  const counts = useMemo(() => {
    return {
      total: products.length,
      done: products.filter((p) => p.scrape_status === 'done').length,
      pending: products.filter(
        (p) => p.scrape_status === 'idle' || p.scrape_status === 'queued',
      ).length,
      failed: products.filter((p) => p.scrape_status === 'failed').length,
      bundles: products.filter((p) => p.is_bundle).length,
      assigned: products.filter((p) => p.assigned_agent_count > 0).length,
    };
  }, [products]);

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <ShoppingBag className="size-3.5" />
            Catálogo
          </div>
          <h1 className="mt-1 text-2xl font-bold text-foreground">Productos</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Sincronizá tu catálogo de Shopify y asigná un asistente por
            producto. Cada producto se enriquece con la página pública
            (Firecrawl) y una investigación automática para responder mejor en
            WhatsApp.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {counts.pending + counts.failed > 0 && (
            <Button
              onClick={handleTrainAll}
              disabled={training?.running}
              variant="outline"
              className="h-9 border-border bg-card text-foreground hover:bg-muted"
            >
              {training?.running ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  {training.done}/{training.total} entrenando…
                </>
              ) : (
                <>
                  <Wand2 className="size-4" />
                  Entrenar pendientes ({counts.pending + counts.failed})
                </>
              )}
            </Button>
          )}
          <Button
            onClick={handleSync}
            disabled={syncing || shopifyConnected === false}
            title={
              shopifyConnected === false
                ? 'Conectá Shopify primero desde Integraciones'
                : undefined
            }
            className="h-9 bg-foreground text-background hover:bg-foreground/90 disabled:opacity-50"
          >
            {syncing ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <RefreshCw className="size-4" />
            )}
            {syncing ? 'Sincronizando…' : 'Sincronizar desde Shopify'}
          </Button>
        </div>
      </div>

      {/* Banner cuando Shopify no está conectado y ya hay productos (de
          una conexión vieja desconectada o de un seed) — guía hacia
          /integraciones. */}
      {shopifyConnected === false && products.length > 0 && (
        <div className="flex items-start gap-2.5 rounded-lg border border-amber-600/30 bg-amber-500/5 px-3.5 py-2.5">
          <AlertCircle className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-amber-900 dark:text-amber-200">
              Shopify no está conectado
            </p>
            <p className="mt-0.5 text-xs text-amber-700 dark:text-amber-300/80">
              Estos productos quedaron de una conexión vieja. Para
              sincronizar el catálogo actual, reconectá Shopify.
            </p>
          </div>
          <Link
            href="/integraciones"
            className="inline-flex shrink-0 items-center gap-1 rounded-md border border-amber-600/30 bg-card px-2.5 py-1 text-xs font-medium text-amber-900 hover:bg-amber-500/10 dark:text-amber-200"
          >
            Conectar Shopify
            <ExternalLink className="size-3" />
          </Link>
        </div>
      )}

      {/* Métricas */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
        <Metric label="Total" value={counts.total} emphasis />
        <Metric label="Entrenados" value={counts.done} />
        <Metric label="Sin entrenar" value={counts.pending} />
        <Metric label="Con error" value={counts.failed} />
        <Metric label="Bundles" value={counts.bundles} />
        <Metric label="Con agente" value={counts.assigned} />
      </div>

      {/* Toolbar */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full max-w-md">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar por nombre, marca o tag…"
            className="h-9 pl-8"
          />
        </div>
        <div className="flex flex-wrap items-center gap-1">
          {(Object.keys(FILTER_LABEL) as Filter[]).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className={cn(
                'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                filter === f
                  ? 'border-foreground bg-foreground text-background'
                  : 'border-border bg-card text-muted-foreground hover:bg-muted',
              )}
            >
              {FILTER_LABEL[f]}
            </button>
          ))}
        </div>
      </div>

      {/* Lista */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        </div>
      ) : products.length === 0 ? (
        <EmptyState onSync={handleSync} syncing={syncing} />
      ) : filtered.length === 0 ? (
        <div className="flex h-32 items-center justify-center rounded-lg border border-border bg-card">
          <p className="text-sm text-muted-foreground">
            Ningún producto coincide con el filtro.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((p) => (
            <ProductCard key={p.id} product={p} />
          ))}
        </div>
      )}
    </div>
  );
}

function Metric({
  label,
  value,
  emphasis = false,
}: {
  label: string;
  value: number;
  emphasis?: boolean;
}) {
  return (
    <div
      className={cn(
        'rounded-lg border bg-card p-3',
        emphasis ? 'border-border' : 'border-border/60',
      )}
    >
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 text-xl font-semibold tabular-nums text-foreground">
        {value.toLocaleString('es-ES')}
      </p>
    </div>
  );
}

function ProductCard({ product }: { product: ProductRow }) {
  const price =
    product.price_min == null
      ? null
      : product.price_min === product.price_max
        ? formatPrice(product.price_min, product.currency)
        : `${formatPrice(product.price_min, product.currency)} – ${formatPrice(product.price_max ?? 0, product.currency)}`;

  return (
    <Link
      href={`/productos/${product.id}`}
      className="group flex flex-col overflow-hidden rounded-lg border border-border bg-card transition-colors hover:border-foreground/30"
    >
      {/* Imagen */}
      <div className="relative aspect-[16/10] w-full bg-muted">
        {product.image_url ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={product.image_url}
            alt={product.title}
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full items-center justify-center text-muted-foreground/40">
            <ShoppingBag className="size-8" />
          </div>
        )}
        {product.is_bundle && (
          <span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-full border border-border bg-card/95 px-2 py-0.5 text-[10px] font-medium text-foreground backdrop-blur">
            <Boxes className="size-3" />
            {formatBundleApp(product.bundle_app)}
          </span>
        )}
      </div>
      {/* Body */}
      <div className="flex flex-1 flex-col gap-2 p-3">
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-medium text-foreground">
            {product.title}
          </h3>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {product.vendor ?? product.product_type ?? '—'}
          </p>
        </div>
        <div className="flex items-center justify-between text-xs">
          {price ? (
            <span className="tabular-nums text-foreground">{price}</span>
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
          <StatusChips
            scrape={product.scrape_status}
            research={product.ai_research_status}
            assignedCount={product.assigned_agent_count}
          />
        </div>
      </div>
    </Link>
  );
}

function StatusChips({
  scrape,
  research,
  assignedCount,
}: {
  scrape: ProductRow['scrape_status'];
  research: ProductRow['ai_research_status'];
  assignedCount: number;
}) {
  return (
    <div className="flex items-center gap-1">
      {scrape === 'done' && research === 'done' ? (
        <span
          className="inline-flex items-center gap-0.5 rounded-full border border-emerald-600/30 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-300"
          title="Entrenado"
        >
          <CheckCircle2 className="size-3" />
        </span>
      ) : scrape === 'failed' || research === 'failed' ? (
        <span
          className="inline-flex items-center rounded-full border border-red-600/30 bg-red-500/10 px-1.5 py-0.5 text-[10px] font-medium text-red-700 dark:text-red-400"
          title="Error de entrenamiento"
        >
          <AlertCircle className="size-3" />
        </span>
      ) : scrape === 'scraping' || research === 'running' ? (
        <span
          className="inline-flex items-center rounded-full border border-amber-600/25 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-300"
          title="Entrenando…"
        >
          <Loader2 className="size-3 animate-spin" />
        </span>
      ) : null}
      {assignedCount > 0 && (
        <span
          className="inline-flex items-center gap-0.5 rounded-full border border-border bg-muted px-1.5 py-0.5 text-[10px] font-medium text-foreground"
          title={`${assignedCount} agente${assignedCount === 1 ? '' : 's'} asignado${assignedCount === 1 ? '' : 's'}`}
        >
          <Sparkles className="size-3" />
          {assignedCount}
        </span>
      )}
    </div>
  );
}

function EmptyState({
  onSync,
  syncing,
}: {
  onSync: () => void;
  syncing: boolean;
}) {
  return (
    <div className="rounded-lg border border-dashed border-border bg-muted/30 p-8 text-center">
      <ShoppingBag className="mx-auto size-8 text-muted-foreground" />
      <h2 className="mt-3 text-base font-medium text-foreground">
        Conectá tu catálogo
      </h2>
      <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
        Si ya conectaste Shopify, tocá &quot;Sincronizar&quot;. Si no, primero{' '}
        <Link
          href="/integraciones"
          className="text-foreground underline underline-offset-2 hover:text-accent-ink"
        >
          conectá Shopify
        </Link>{' '}
        en Integraciones.
      </p>
      <div className="mt-4 flex items-center justify-center gap-2">
        <Button
          onClick={onSync}
          disabled={syncing}
          className="bg-foreground text-background hover:bg-foreground/90"
        >
          {syncing ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <RefreshCw className="size-4" />
          )}
          {syncing ? 'Sincronizando…' : 'Sincronizar Shopify'}
        </Button>
        <Link
          href="/integraciones"
          className="inline-flex h-9 items-center gap-1 rounded-md border border-border bg-card px-3 text-sm font-medium text-foreground transition-colors hover:bg-muted"
        >
          <ExternalLink className="size-3.5" />
          Integraciones
        </Link>
      </div>
      <p className="mx-auto mt-6 flex max-w-md items-start gap-1.5 rounded-md border border-border bg-card/60 px-3 py-2 text-left text-[11px] text-muted-foreground">
        <Info className="mt-0.5 size-3 shrink-0" />
        <span>
          Si tu tienda tiene Kaching Bundles, ReConvert, Bold Bundles, FBT o
          Rebuy, los detectamos automáticamente y marcamos esos productos como
          bundles.
        </span>
      </p>
    </div>
  );
}

