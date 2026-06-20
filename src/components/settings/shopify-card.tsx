'use client';

import Image from 'next/image';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { AlertCircle, CheckCircle2, Loader2, RefreshCcw } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { useFetchWithCsrf } from '@/lib/api/fetch-with-csrf';
import { useT } from '@/hooks/use-locale';

interface ShopifyConnection {
  shop_domain: string;
  shop_name: string | null;
  status: string;
}

/**
 * Settings → Canales card for Shopify. Matches the per-platform card
 * layout used in channels-panel.tsx (logo chip + label + description,
 * connection rows below, action button at the bottom) so the row of
 * cards reads as a single uniform grid no matter the provider.
 */
export function ShopifyCard() {
  const fetchWithCsrf = useFetchWithCsrf();
  const t = useT();
  const [loading, setLoading] = useState(true);
  const [configured, setConfigured] = useState(false);
  const [connection, setConnection] = useState<ShopifyConnection | null>(null);
  const [shop, setShop] = useState('');
  const [disconnecting, setDisconnecting] = useState(false);
  const [showInput, setShowInput] = useState(false);

  useEffect(() => {
    void load();
    const params = new URLSearchParams(window.location.search);
    const result = params.get('shopify');
    if (result === 'connected') toast.success(t('settings.shopifyConnected'));
    else if (result === 'error')
      toast.error(t('settings.shopifyConnectError', { reason: params.get('reason') ?? 'error' }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function load() {
    try {
      setLoading(true);
      const res = await fetch('/api/shopify/status');
      const data = await res.json();
      setConfigured(Boolean(data.configured));
      setConnection(data.connection ?? null);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }

  function handleConnect() {
    const trimmed = shop.trim();
    if (!trimmed) {
      toast.error(t('settings.shopifyMissingDomain'));
      return;
    }
    window.location.href = `/api/shopify/install?shop=${encodeURIComponent(trimmed)}`;
  }

  async function handleDisconnect() {
    if (!confirm(t('settings.shopifyDisconnectConfirm'))) return;
    setDisconnecting(true);
    try {
      const res = await fetchWithCsrf('/api/shopify/status', { method: 'DELETE' });
      if (!res.ok) throw new Error('failed');
      toast.success(t('settings.shopifyDisconnected'));
      setConnection(null);
    } catch {
      toast.error(t('settings.disconnectError'));
    } finally {
      setDisconnecting(false);
    }
  }

  const isConnected = connection?.status === 'active';

  return (
    <li
      className={cn(
        'group flex flex-col gap-3 overflow-hidden rounded-xl border bg-card p-4 transition-all',
        isConnected
          ? 'border-emerald-500/40 shadow-[inset_0_0_0_1px_rgba(16,185,129,0.1)]'
          : 'border-border hover:border-foreground/30',
      )}
    >
      <div className="flex items-start gap-3">
        <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-card p-2 shadow-sm ring-1 ring-border">
          <Image src="/channels/shopify.svg" alt="Shopify" width={28} height={28} />
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-foreground">Shopify</p>
          <p className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-muted-foreground">
            {t('settings.shopifyDescription')}
          </p>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-3">
          <Loader2 className="size-4 animate-spin text-muted-foreground" />
        </div>
      ) : !configured ? (
        <p className="rounded-md bg-amber-500/10 px-2 py-1.5 text-[11px] text-amber-700 dark:text-amber-300">
          {t('settings.shopifyMissingCredentials')}
        </p>
      ) : isConnected ? (
        <ul className="space-y-1">
          <li className="flex items-center gap-2 rounded-md bg-muted/60 px-2 py-1.5 ring-1 ring-border/50">
            <CheckCircle2 className="size-3.5 text-emerald-700 dark:text-emerald-400" />
            <span className="flex-1 truncate text-xs text-foreground">
              {connection?.shop_name || connection?.shop_domain}
            </span>
            <button
              onClick={handleDisconnect}
              disabled={disconnecting}
              title={t('settings.disconnect')}
              className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-amber-400"
            >
              {disconnecting ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <RefreshCcw className="size-3.5" />
              )}
            </button>
          </li>
        </ul>
      ) : null}

      {configured && (!isConnected || showInput) && (
        <div className="mt-auto space-y-2">
          {showInput ? (
            <>
              <Input
                placeholder={t('settings.shopifyDomainPlaceholder')}
                value={shop}
                onChange={(e) => setShop(e.target.value)}
                className="bg-background text-sm"
              />
              <div className="flex gap-2">
                <button
                  onClick={handleConnect}
                  className="flex-1 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
                >
                  {t('common.connect')}
                </button>
                <button
                  onClick={() => setShowInput(false)}
                  className="rounded-lg border border-border px-3 py-2 text-sm text-foreground hover:bg-accent"
                >
                  {t('common.cancel')}
                </button>
              </div>
            </>
          ) : (
            <button
              onClick={() => setShowInput(true)}
              className={cn(
                'flex w-full items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                isConnected
                  ? 'border border-border bg-muted/50 text-foreground hover:bg-accent'
                  : 'bg-primary text-primary-foreground hover:bg-primary/90',
              )}
            >
              <Image src="/channels/shopify.svg" alt="" width={16} height={16} />
              {isConnected ? t('settings.addAnotherStore') : t('common.connect')}
            </button>
          )}
        </div>
      )}
      {!configured && (
        <div className="mt-auto inline-flex items-center justify-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
          <AlertCircle className="size-3.5" />
          {t('settings.missingCredentials')}
        </div>
      )}
    </li>
  );
}
