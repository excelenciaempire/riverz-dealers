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
  connection_method?: 'oauth' | 'admin_token' | 'client_credentials';
}

type Mode = 'idle' | 'oauth' | 'clientCredentials';

/**
 * Settings → Canales card for Shopify. Matches the per-platform card
 * layout used in channels-panel.tsx (logo chip + label + description,
 * connection rows below, action button at the bottom) so the row of
 * cards reads as a single uniform grid no matter the provider.
 *
 * Only the connect paths that work are shown:
 *  - Dev Dashboard app: the merchant creates an app in their store's
 *    organization, installs it and pastes its Client ID + Client secret.
 *  - OAuth (public app): only once the App Store approves it (`oauth` from
 *    /api/shopify/status). Before that Shopify won't install it on real
 *    stores.
 *
 * The custom-app token path is gone: Shopify stopped letting merchants
 * create those apps on 2026-01-01.
 */
export function ShopifyCard() {
  const fetchWithCsrf = useFetchWithCsrf();
  const t = useT();
  const [loading, setLoading] = useState(true);
  const [oauth, setOauth] = useState(false);
  const [scopes, setScopes] = useState('');
  const [connection, setConnection] = useState<ShopifyConnection | null>(null);
  const [shop, setShop] = useState('');
  const [disconnecting, setDisconnecting] = useState(false);
  const [mode, setMode] = useState<Mode>('idle');

  // Shopify Dev Dashboard app form
  const [clientShop, setClientShop] = useState('');
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [connectingClient, setConnectingClient] = useState(false);

  useEffect(() => {
    void load();
    const params = new URLSearchParams(window.location.search);
    const result = params.get('shopify');
    if (result === 'connected') toast.success(t('settings.shopifyConnected'));
    else if (result === 'error')
      toast.error(
        t('settings.shopifyConnectError', {
          reason: params.get('reason') ?? 'error',
        })
      );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function load() {
    try {
      setLoading(true);
      const res = await fetch('/api/shopify/status');
      const data = await res.json();
      setOauth(Boolean(data.oauth));
      setScopes(typeof data.scopes === 'string' ? data.scopes : '');
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

  async function copyScopes() {
    try {
      await navigator.clipboard.writeText(scopes);
      toast.success(t('settings.shopifyScopesCopied'));
    } catch {
      toast.error(t('settings.couldNotCopy'));
    }
  }

  async function handleClientCredentialsConnect() {
    if (!clientShop.trim() || !clientId.trim() || !clientSecret.trim()) {
      toast.error(t('settings.shopifyClientCredentialsMissingFields'));
      return;
    }
    setConnectingClient(true);
    try {
      const res = await fetchWithCsrf(
        '/api/shopify/connect-client-credentials',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            shop: clientShop.trim(),
            clientId: clientId.trim(),
            clientSecret: clientSecret.trim(),
          }),
        }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(
          data.error ??
            t('settings.shopifyConnectError', { reason: 'credentials' })
        );
        return;
      }
      toast.success(t('settings.shopifyConnected'));
      setConnection({
        shop_domain: data.shop_domain,
        shop_name: data.shop_name ?? null,
        status: 'active',
        connection_method: 'client_credentials',
      });
      setMode('idle');
      setClientShop('');
      setClientId('');
      setClientSecret('');
    } catch {
      toast.error(t('settings.shopifyConnectError', { reason: 'credentials' }));
    } finally {
      setConnectingClient(false);
    }
  }

  async function handleDisconnect() {
    if (!confirm(t('settings.shopifyDisconnectConfirm'))) return;
    setDisconnecting(true);
    try {
      const res = await fetchWithCsrf('/api/shopify/status', {
        method: 'DELETE',
      });
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
      id="canal-shopify"
      className={cn(
        'group bg-card flex flex-col gap-3 overflow-hidden rounded-xl border p-4 transition-all',
        isConnected
          ? 'border-emerald-500/40 shadow-[inset_0_0_0_1px_rgba(16,185,129,0.1)]'
          : 'border-border hover:border-foreground/30'
      )}
    >
      <div className="flex items-start gap-3">
        <div className="ring-border flex size-11 shrink-0 items-center justify-center rounded-xl bg-white p-2 shadow-sm ring-1">
          <Image
            src="/channels/shopify.svg"
            alt="Shopify"
            width={28}
            height={28}
          />
        </div>
        <div className="min-w-0">
          <p className="text-foreground truncate text-sm font-semibold">
            Shopify
          </p>
          <p className="text-muted-foreground mt-0.5 line-clamp-2 text-[11px] leading-snug">
            {t('settings.shopifyDescription')}
          </p>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-3">
          <Loader2 className="text-muted-foreground size-4 animate-spin" />
        </div>
      ) : isConnected ? (
        <ul className="space-y-1">
          <li className="bg-muted/60 ring-border/50 flex items-center gap-2 rounded-md px-2 py-1.5 ring-1">
            <CheckCircle2 className="size-3.5 text-emerald-700 dark:text-emerald-400" />
            <span className="text-foreground flex-1 truncate text-xs">
              {connection?.shop_name || connection?.shop_domain}
              {connection?.connection_method === 'client_credentials' && (
                <span className="text-muted-foreground ml-1 text-[10px]">
                  ({t('settings.shopifyConnectedViaClientCredentials')})
                </span>
              )}
            </span>
            <button
              onClick={handleDisconnect}
              disabled={disconnecting}
              title={t('settings.disconnect')}
              className="text-muted-foreground hover:bg-accent rounded p-1 hover:text-amber-700 dark:hover:text-amber-400"
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
          {mode === 'oauth' && oauth ? (
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
                  className="bg-primary text-primary-foreground hover:bg-primary/90 flex-1 rounded-lg px-3 py-2 text-sm font-medium"
                >
                  {t('common.connect')}
                </button>
                <button
                  onClick={() => setMode('idle')}
                  className="border-border text-foreground hover:bg-accent rounded-lg border px-3 py-2 text-sm"
                >
                  {t('common.cancel')}
                </button>
              </div>
            </>
          ) : mode === 'clientCredentials' ? (
            <>
              <p className="bg-muted/50 text-muted-foreground rounded-md px-2 py-1.5 text-[11px] leading-snug">
                {t('settings.shopifyClientCredentialsGuide')}
                {scopes && (
                  <>
                    {' '}
                    <button
                      type="button"
                      onClick={() => void copyScopes()}
                      className="text-foreground font-medium underline-offset-2 hover:underline"
                    >
                      {t('settings.shopifyCopyScopes')}
                    </button>
                  </>
                )}
              </p>
              <Input
                placeholder={t('settings.shopifyDomainPlaceholder')}
                value={clientShop}
                onChange={(e) => setClientShop(e.target.value)}
                className="bg-background text-sm"
              />
              <Input
                type="password"
                placeholder={t('settings.shopifyClientIdPlaceholder')}
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
                className="bg-background text-sm"
              />
              <Input
                type="password"
                placeholder={t('settings.shopifyClientSecretPlaceholder')}
                value={clientSecret}
                onChange={(e) => setClientSecret(e.target.value)}
                className="bg-background text-sm"
              />
              <div className="flex gap-2">
                <button
                  onClick={handleClientCredentialsConnect}
                  disabled={connectingClient}
                  className="bg-primary text-primary-foreground hover:bg-primary/90 flex flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium disabled:opacity-60"
                >
                  {connectingClient && (
                    <Loader2 className="size-3.5 animate-spin" />
                  )}
                  {t('common.connect')}
                </button>
                <button
                  onClick={() => setMode('idle')}
                  className="border-border text-foreground hover:bg-accent rounded-lg border px-3 py-2 text-sm"
                >
                  {t('common.cancel')}
                </button>
              </div>
            </>
          ) : (
            <>
              <button
                onClick={() => setMode(oauth ? 'oauth' : 'clientCredentials')}
                className="bg-primary text-primary-foreground hover:bg-primary/90 flex w-full items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium"
              >
                <Image
                  src="/channels/shopify.svg"
                  alt=""
                  width={16}
                  height={16}
                />
                {t('common.connect')}
              </button>
              {oauth && (
                <button
                  onClick={() => setMode('clientCredentials')}
                  className="text-muted-foreground hover:text-foreground flex w-full items-center justify-center text-[11px] font-medium"
                >
                  {t('settings.shopifyUseClientCredentialsLink')}
                </button>
              )}
            </>
          )}
        </div>
      )}
    </li>
  );
}
