'use client';

import { useEffect, useState } from 'react';
import Link from '@/components/i18n/locale-link';
import { useLocalizedRouter } from '@/hooks/use-localized-router';
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
  Trash2,
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
import { useT, useLocale } from '@/hooks/use-locale';
import { useRecordado } from '@/hooks/use-recordado';
import { localizePath, canonicalizePath } from '@/lib/i18n/routes';

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
  shop_domain: string | null;
  is_bundle: boolean;
  bundle_app: string | null;
  scrape_status: 'idle' | 'queued' | 'scraping' | 'done' | 'failed';
  ai_research_status: 'idle' | 'queued' | 'running' | 'done' | 'failed';
  assigned_agent_count: number;
}

export default function ProductosPage() {
  const t = useT();
  const { locale } = useLocale();
  const router = useLocalizedRouter();
  const fetchWithCsrf = useFetchWithCsrf();
  // La sección se acuerda de lo último que mostró: volver es instantáneo y la
  // consulta sale igual, en silencio, para reemplazarlo.
  const [products, setProducts, habia] = useRecordado<ProductRow[]>('productos', []);
  const [shopifyConnected, setShopifyConnected] = useState<boolean | null>(null);
  // Divisa del workspace (detectada) — fallback para mostrar precios de
  // productos sin divisa propia.
  const [workspaceCurrency, setWorkspaceCurrency] = useState<string | null>(null);
  const [loading, setLoading] = useState(!habia);
  const [syncing, setSyncing] = useState(false);

  // Crear producto desde cero — solo pedimos el nombre; el resto se edita
  // en el editor (a donde redirigimos tras crear).
  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');

  // Eliminar producto — confirmación antes de borrarlo del sistema.
  const [pendingDelete, setPendingDelete] = useState<ProductRow | null>(null);
  const [deleting, setDeleting] = useState(false);

  async function fetchProducts() {
    // Sin `setLoading(true)` acá: si la sección se acordaba del catálogo, ya
    // está en pantalla, y encender el esqueleto lo taparía para volver a
    // mostrar lo mismo. La primera vez el estado ya arranca en `true`.
    try {
      const res = await fetch('/api/products');
      if (!res.ok) throw new Error('No se pudieron cargar los productos');
      const json = await res.json();
      setProducts(json.products ?? []);
      setShopifyConnected(!!json.shopify_connected);
      setWorkspaceCurrency(json.workspace_currency ?? null);
    } catch (err) {
      console.error(err);
      toast.error(t('products.loadError'));
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
      window.history.replaceState(
        null,
        '',
        localizePath(canonicalizePath('/productos'), locale),
      );
    }
  }, [locale]);

  async function handleSync() {
    setSyncing(true);
    try {
      const res = await fetchWithCsrf('/api/products/sync', { method: 'POST' });
      const json = await res.json();
      if (!res.ok) {
        toast.error(json.error ?? t('products.syncError'));
        return;
      }
      const parts: string[] = [];
      if (json.synced > 0) parts.push(t('products.syncedCount', { n: json.synced }));
      if (json.deleted > 0) parts.push(t('products.deletedCount', { n: json.deleted }));
      toast.success(parts.length ? parts.join(' · ') : t('products.catalogUpToDate'));
      await fetchProducts();
    } catch (err) {
      console.error(err);
      toast.error(t('products.syncCatalogError'));
    } finally {
      setSyncing(false);
    }
  }

  async function handleCreate() {
    if (!name.trim()) {
      toast.error(t('products.nameRequired'));
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
        toast.error(json.error ?? t('products.createError'));
        return;
      }
      // Vamos directo al editor a completar la info.
      router.push(`/productos/${json.id}`);
    } catch {
      toast.error(t('products.createError'));
    } finally {
      setCreating(false);
    }
  }

  async function handleDelete() {
    const target = pendingDelete;
    if (!target) return;
    setDeleting(true);
    try {
      const res = await fetchWithCsrf(`/api/products/${target.id}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        toast.error(json.error ?? t('products.deleteError'));
        return;
      }
      setProducts((prev) => prev.filter((p) => p.id !== target.id));
      setPendingDelete(null);
      toast.success(t('products.deleted'));
    } catch {
      toast.error(t('products.deleteError'));
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Header — solo el título + sincronizar (sutil) */}
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-bold tracking-tight text-foreground">{t('products.title')}</h1>
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
            {t('products.sync')}
          </Button>
        )}
      </div>

      {/* Crear producto desde cero — solo el nombre */}
      <Dialog open={createOpen} onOpenChange={(o) => !creating && setCreateOpen(o)}>
        <DialogContent className="bg-card text-foreground sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('products.newProduct')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label>{t('products.productName')}</Label>
            <Input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
              placeholder={t('products.productNamePlaceholder')}
            />
            <p className="text-xs text-muted-foreground">
              {t('products.createHint')}
            </p>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setCreateOpen(false)}
              disabled={creating}
              className="border-border"
            >
              {t('products.cancel')}
            </Button>
            <Button onClick={handleCreate} disabled={creating}>
              {creating ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
              {t('products.createAndEdit')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirmación de borrado */}
      <Dialog
        open={!!pendingDelete}
        onOpenChange={(o) => !deleting && !o && setPendingDelete(null)}
      >
        <DialogContent className="bg-card text-foreground sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('products.deleteTitle')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-1.5 text-sm text-muted-foreground">
            <p>{t('products.deleteBody', { name: pendingDelete?.title ?? '' })}</p>
            {(pendingDelete?.assigned_agent_count ?? 0) > 0 && (
              <p>
                {t('products.deleteAgentsWarning', {
                  n: pendingDelete?.assigned_agent_count ?? 0,
                })}
              </p>
            )}
            {pendingDelete?.shop_domain && pendingDelete.shop_domain !== 'manual' && (
              <p>{t('products.deleteSyncedWarning')}</p>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setPendingDelete(null)}
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
              {deleting ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
              {t('products.delete')}
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
              {t('products.shopifyNotConnected')}
            </p>
            <p className="mt-0.5 text-xs text-amber-700 dark:text-amber-300/80">
              {t('products.shopifyReconnectHint')}
            </p>
          </div>
          <Link
            href="/integraciones"
            className="inline-flex shrink-0 items-center gap-1 rounded-md border border-amber-600/30 bg-card px-2.5 py-1 text-xs font-medium text-amber-900 hover:bg-amber-500/10 dark:text-amber-200"
          >
            {t('products.connect')}
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
            <ProductCard
              key={p.id}
              product={p}
              fallbackCurrency={workspaceCurrency}
              onDelete={() => setPendingDelete(p)}
            />
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
            <span className="text-sm font-medium">{t('products.newProduct')}</span>
          </button>
        </div>
      )}
    </div>
  );
}

function ProductCard({
  product,
  fallbackCurrency,
  onDelete,
}: {
  product: ProductRow;
  fallbackCurrency: string | null;
  onDelete: () => void;
}) {
  const t = useT();
  const completeness = productCompleteness(product);
  const price =
    product.price_min == null
      ? null
      : product.price_min === product.price_max
        ? formatPrice(product.price_min, product.currency, fallbackCurrency)
        : `${formatPrice(product.price_min, product.currency, fallbackCurrency)} – ${formatPrice(product.price_max ?? 0, product.currency, fallbackCurrency)}`;

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
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onDelete();
          }}
          className="absolute right-2 top-2 rounded-full border border-border bg-card/95 p-1.5 text-muted-foreground opacity-0 backdrop-blur transition hover:text-red-500 focus-visible:opacity-100 group-hover:opacity-100"
          aria-label={t('products.delete')}
        >
          <Trash2 className="size-3.5" />
        </button>
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
            title={t('products.fieldsComplete', {
              done: completeness.done,
              total: completeness.total,
            })}
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
  const t = useT();
  return (
    <div className="flex items-center gap-1">
      {scrape === 'done' && research === 'done' ? (
        <span
          className="inline-flex items-center rounded-full border border-emerald-600/30 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-300"
          title={t('products.trained')}
        >
          <CheckCircle2 className="size-3" />
        </span>
      ) : scrape === 'failed' || research === 'failed' ? (
        <span
          className="inline-flex items-center rounded-full border border-red-600/30 bg-red-500/10 px-1.5 py-0.5 text-[10px] font-medium text-red-700 dark:text-red-400"
          title={t('products.trainingError')}
        >
          <AlertCircle className="size-3" />
        </span>
      ) : null}
      {assignedCount > 0 && (
        <span
          className="inline-flex items-center gap-0.5 rounded-full border border-border bg-muted px-1.5 py-0.5 text-[10px] font-medium text-foreground"
          title={t('products.agentsAssigned', { n: assignedCount })}
        >
          <Sparkles className="size-3" />
          {assignedCount}
        </span>
      )}
    </div>
  );
}
