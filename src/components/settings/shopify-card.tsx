'use client';

import Image from 'next/image';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { CheckCircle2, Loader2, Trash2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { useFetchWithCsrf } from '@/lib/api/fetch-with-csrf';
import { useT } from '@/hooks/use-locale';

interface ShopifyConnection {
  shop_domain: string;
  shop_name: string | null;
  status: string;
  connection_method?: 'oauth' | 'admin_token';
}

type Mode = 'idle' | 'oauth' | 'token';

/**
 * Settings → Canales card for Shopify. Matches the per-platform card
 * layout used in channels-panel.tsx (logo chip + label + description,
 * connection rows below, action button at the bottom) so the row of
 * cards reads as a single uniform grid no matter the provider.
 *
 * Two connect paths:
 *  - OAuth (global app): only when the server has SHOPIFY_API_KEY set.
 *  - Custom-app token: always available. The merchant creates a custom app
 *    in their own Shopify admin and pastes the Admin API token + API secret
 *    key — no App Store review, fully self-contained per workspace.
 */
export function ShopifyCard() {
  const fetchWithCsrf = useFetchWithCsrf();
  const t = useT();
  const [loading, setLoading] = useState(true);
  const [configured, setConfigured] = useState(false);
  const [connection, setConnection] = useState<ShopifyConnection | null>(null);
  const [shop, setShop] = useState('');
  const [disconnecting, setDisconnecting] = useState(false);
  const [mode, setMode] = useState<Mode>('idle');

  // Token (custom app) form
  const [tokenShop, setTokenShop] = useState('');
  const [tokenAccess, setTokenAccess] = useState('');
  const [tokenSecret, setTokenSecret] = useState('');
  const [connectingToken, setConnectingToken] = useState(false);

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

  async function handleTokenConnect() {
    if (!tokenShop.trim() || !tokenAccess.trim() || !tokenSecret.trim()) {
      toast.error(t('settings.shopifyTokenMissingFields'));
      return;
    }
    setConnectingToken(true);
    try {
      const res = await fetchWithCsrf('/api/shopify/connect-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shop: tokenShop.trim(),
          accessToken: tokenAccess.trim(),
          apiSecret: tokenSecret.trim(),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error ?? t('settings.shopifyConnectError', { reason: 'token' }));
        return;
      }
      toast.success(t('settings.shopifyConnected'));
      setConnection({
        shop_domain: data.shop_domain,
        shop_name: data.shop_name ?? null,
        status: 'active',
        connection_method: 'admin_token',
      });
      setMode('idle');
      setTokenShop('');
      setTokenAccess('');
      setTokenSecret('');
    } catch {
      toast.error(t('settings.shopifyConnectError', { reason: 'token' }));
    } finally {
      setConnectingToken(false);
    }
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
      ) : isConnected ? (
        <ul className="space-y-1">
          <li className="flex items-center gap-2 rounded-md bg-muted/60 px-2 py-1.5 ring-1 ring-border/50">
            <CheckCircle2 className="size-3.5 text-emerald-700 dark:text-emerald-400" />
            <span className="flex-1 truncate text-xs text-foreground">
              {connection?.shop_name || connection?.shop_domain}
              {connection?.connection_method === 'admin_token' && (
                <span className="ml-1 text-[10px] text-muted-foreground">
                  ({t('settings.shopifyConnectedViaToken')})
                </span>
              )}
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
                // Papelera, no flecha de recargar: el icono anterior decía
                // "sincronizar" y la acción desconecta la tienda.
                <Trash2 className="size-3.5" />
              )}
            </button>
          </li>
        </ul>
      ) : null}

      {!isConnected && (
        <div className="mt-auto space-y-2">
          {mode === 'oauth' && configured ? (
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
                  onClick={() => setMode('idle')}
                  className="rounded-lg border border-border px-3 py-2 text-sm text-foreground hover:bg-accent"
                >
                  {t('common.cancel')}
                </button>
              </div>
            </>
          ) : mode === 'token' ? (
            <>
              <p className="rounded-md bg-muted/50 px-2 py-1.5 text-[11px] leading-snug text-muted-foreground">
                {t('settings.shopifyTokenGuide')}
              </p>
              <Input
                placeholder={t('settings.shopifyDomainPlaceholder')}
                value={tokenShop}
                onChange={(e) => setTokenShop(e.target.value)}
                className="bg-background text-sm"
              />
              <Input
                type="password"
                placeholder={t('settings.shopifyTokenAccessPlaceholder')}
                value={tokenAccess}
                onChange={(e) => setTokenAccess(e.target.value)}
                className="bg-background text-sm"
              />
              <Input
                type="password"
                placeholder={t('settings.shopifyTokenSecretPlaceholder')}
                value={tokenSecret}
                onChange={(e) => setTokenSecret(e.target.value)}
                className="bg-background text-sm"
              />
              <div className="flex gap-2">
                <button
                  onClick={handleTokenConnect}
                  disabled={connectingToken}
                  className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
                >
                  {connectingToken && <Loader2 className="size-3.5 animate-spin" />}
                  {t('common.connect')}
                </button>
                <button
                  onClick={() => setMode('idle')}
                  className="rounded-lg border border-border px-3 py-2 text-sm text-foreground hover:bg-accent"
                >
                  {t('common.cancel')}
                </button>
              </div>
            </>
          ) : (
            <>
              {configured ? (
                <button
                  onClick={() => setMode('oauth')}
                  className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
                >
                  <Image src="/channels/shopify.svg" alt="" width={16} height={16} />
                  {t('common.connect')}
                </button>
              ) : null}
              <button
                onClick={() => setMode('token')}
                className={cn(
                  'flex w-full items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                  configured
                    ? 'text-[11px] text-muted-foreground hover:text-foreground'
                    : 'bg-primary text-primary-foreground hover:bg-primary/90',
                )}
              >
                {!configured && (
                  <Image src="/channels/shopify.svg" alt="" width={16} height={16} />
                )}
                {configured
                  ? t('settings.shopifyUseTokenLink')
                  : t('settings.shopifyConnectToken')}
              </button>
            </>
          )}
        </div>
      )}
    </li>
  );
}
