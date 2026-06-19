'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import {
  RefreshCw,
  ShoppingBag,
  Sparkles,
  AlertCircle,
  CheckCircle2,
  Boxes,
  ExternalLink,
  Loader2,
  Plus,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { formatBundleApp, formatPrice } from '@/lib/products/format';
import { useFetchWithCsrf } from '@/lib/api/fetch-with-csrf';

interface ProductRow {
  id: string;
  handle: string | null;
  title: string;
  description: string | null;
  product_type: string | null;
  vendor: string | null;
  price_min: number | null;
  price_max: number | null;
  currency: string | null;
  image_url: string | null;
  url: string | null;
  is_bundle: boolean;
  bundle_app: string | null;
  scrape_status: 'idle' | 'queued' | 'scraping' | 'done' | 'failed';
  ai_research_status: 'idle' | 'queued' | 'running' | 'done' | 'failed';
  assigned_agent_count: number;
}

export default function ProductosPage() {
  const router = useRouter();
  const fetchWithCsrf = useFetchWithCsrf();
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [shopifyConnected, setShopifyConnected] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);

  // Crear producto desde cero — solo pedimos el nombre; el resto se edita
  // en el editor (a donde redirigimos tras crear).
  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');

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

  // El editor de asistentes redirige aquí con ?new=1 cuando el usuario no
  // tiene el producto que busca. Abrimos el diálogo de creación al instante
  // y limpiamos el query param para que un refresh no lo reabra.
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    if (sp.get('new') === '1') {
      setName('');
      setCreateOpen(true);
      window.history.replaceState(null, '', '/productos');
    }
  }, []);

  async function handleSync() {
    setSyncing(true);
    try {
      const res = await fetchWithCsrf('/api/products/sync', { method: 'POST' });
      const json = await res.json();
      if (!res.ok) {
        toast.error(json.error ?? 'No se pudo sincronizar');
        return;
      }
      const parts: string[] = [];
      if (json.synced > 0) parts.push(`${json.synced} sincronizados`);
      if (json.deleted > 0) parts.push(`${json.deleted} eliminados`);
      toast.success(parts.length ? parts.join(' · ') : 'Catálogo al día');
      await fetchProducts();
    } catch (err) {
      console.error(err);
      toast.error('No se pudo sincronizar el catálogo.');
    } finally {
      setSyncing(false);
    }
  }

  async function handleCreate() {
    if (!name.trim()) {
      toast.error('Ponle un nombre al producto.');
      return;
    }
    setCreating(true);
    try {
      const res = await fetchWithCsrf('/api/products', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: name.trim() }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(json.error ?? 'No se pudo crear el producto.');
        return;
      }
      // Vamos directo al editor a completar la info.
      router.push(`/productos/${json.id}`);
    } catch {
      toast.error('No se pudo crear el producto.');
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Header — solo el título + sincronizar (sutil) */}
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Productos</h1>
        {shopifyConnected && (
          <Button
            onClick={handleSync}
            disabled={syncing}
            variant="outline"
            className="h-9 border-border bg-transparent text-foreground hover:bg-muted"
          >
            {syncing ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <RefreshCw className="size-4" />
            )}
            Sincronizar
          </Button>
        )}
      </div>

      {/* Crear producto desde cero — solo el nombre */}
      <Dialog open={createOpen} onOpenChange={(o) => !creating && setCreateOpen(o)}>
        <DialogContent className="bg-card text-foreground sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Nuevo producto</DialogTitle>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label>Nombre del producto</Label>
            <Input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
              placeholder="Ej: Sérum facial 30ml"
            />
            <p className="text-xs text-muted-foreground">
              Lo demás (fotos, precios, beneficios, sitios) lo completas en el editor.
            </p>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setCreateOpen(false)}
              disabled={creating}
              className="border-border"
            >
              Cancelar
            </Button>
            <Button onClick={handleCreate} disabled={creating}>
              {creating ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
              Crear y editar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Banner cuando Shopify quedó desconectado pero hay productos viejos. */}
      {shopifyConnected === false && products.length > 0 && (
        <div className="flex items-start gap-2.5 rounded-lg border border-amber-600/30 bg-amber-500/5 px-3.5 py-2.5">
          <AlertCircle className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-amber-900 dark:text-amber-200">
              Shopify no está conectado
            </p>
            <p className="mt-0.5 text-xs text-amber-700 dark:text-amber-300/80">
              Para sincronizar tu catálogo actual, reconecta Shopify.
            </p>
          </div>
          <Link
            href="/integraciones"
            className="inline-flex shrink-0 items-center gap-1 rounded-md border border-amber-600/30 bg-card px-2.5 py-1 text-xs font-medium text-amber-900 hover:bg-amber-500/10 dark:text-amber-200"
          >
            Conectar
            <ExternalLink className="size-3" />
          </Link>
        </div>
      )}

      {/* Grid */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {products.map((p) => (
            <ProductCard key={p.id} product={p} />
          ))}
          {/* Tile "Nuevo producto" — al estilo de la referencia */}
          <button
            type="button"
            onClick={() => {
              setName('');
              setCreateOpen(true);
            }}
            className="flex min-h-[200px] flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border text-muted-foreground transition-colors hover:border-foreground/40 hover:text-foreground"
          >
            <span className="flex size-10 items-center justify-center rounded-full bg-primary/15 text-primary">
              <Plus className="size-5" />
            </span>
            <span className="text-sm font-medium">Nuevo producto</span>
          </button>
        </div>
      )}
    </div>
  );
}

function ProductCard({ product }: { product: ProductRow }) {
  const completeness = productCompleteness(product);
  const price =
    product.price_min == null
      ? null
      : product.price_min === product.price_max
        ? formatPrice(product.price_min, product.currency)
        : `${formatPrice(product.price_min, product.currency)} – ${formatPrice(product.price_max ?? 0, product.currency)}`;

  return (
    <Link
      href={`/productos/${product.handle || product.id}`}
      className="group flex flex-col overflow-hidden rounded-xl border border-border bg-card transition-colors hover:border-foreground/30"
    >
      <div className="relative aspect-square w-full bg-white">
        {product.image_url ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={product.image_url}
            alt={product.title}
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full items-center justify-center bg-muted text-muted-foreground/40">
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
      <div className="flex flex-1 flex-col gap-2 p-3">
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-medium text-foreground">{product.title}</h3>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {product.vendor ?? product.product_type ?? '—'}
            {price ? ` · ${price}` : ''}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div
            className="h-1 flex-1 overflow-hidden rounded-full bg-muted"
            title={`${completeness.done} de ${completeness.total} campos clave completos`}
          >
            <div
              className={cn(
                'h-full rounded-full transition-all',
                completeness.done === completeness.total ? 'bg-emerald-500' : 'bg-foreground',
              )}
              style={{ width: `${(completeness.done / completeness.total) * 100}%` }}
            />
          </div>
          <span className="text-[11px] tabular-nums text-muted-foreground">
            {completeness.done}/{completeness.total}
          </span>
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

/** Cuántos campos clave (de 4) tiene un producto, para la barra de progreso. */
function productCompleteness(p: ProductRow): { done: number; total: number } {
  const fields = [
    !!p.image_url,
    p.price_min != null,
    !!(p.description && p.description.trim()),
    !!p.url || p.scrape_status === 'done',
  ];
  return { done: fields.filter(Boolean).length, total: fields.length };
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
          className="inline-flex items-center rounded-full border border-emerald-600/30 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-300"
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
      ) : null}
      {assignedCount > 0 && (
        <span
          className="inline-flex items-center gap-0.5 rounded-full border border-border bg-muted px-1.5 py-0.5 text-[10px] font-medium text-foreground"
          title={`${assignedCount} agente(s) asignado(s)`}
        >
          <Sparkles className="size-3" />
          {assignedCount}
        </span>
      )}
    </div>
  );
}
