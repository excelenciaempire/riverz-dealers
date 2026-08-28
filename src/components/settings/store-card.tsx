'use client';

import Image from 'next/image';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { CheckCircle2, Download, Loader2, RefreshCcw, Trash2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { useFetchWithCsrf } from '@/lib/api/fetch-with-csrf';
import { useT } from '@/hooks/use-locale';
import { WooCommerceDialog } from '@/components/settings/woocommerce-dialog';

type StorePlatform = 'tiendanube' | 'woocommerce';

interface StoreConnection {
  shop_domain: string;
  shop_name: string | null;
  status: string;
}

interface Meta {
  label: string;
  logo: string;
  descriptionKey: string;
  connectedKey: string;
  disconnectedKey: string;
  disconnectConfirmKey: string;
  errorKey: string;
}

const META: Record<StorePlatform, Meta> = {
  tiendanube: {
    label: 'Tiendanube',
    logo: '/channels/tiendanube.svg',
    descriptionKey: 'settings.tiendanubeDescription',
    connectedKey: 'settings.tiendanubeConnected',
    disconnectedKey: 'settings.tiendanubeDisconnected',
    disconnectConfirmKey: 'settings.tiendanubeDisconnectConfirm',
    errorKey: 'settings.tiendanubeConnectError',
  },
  woocommerce: {
    label: 'WooCommerce',
    logo: '/channels/woocommerce.svg',
    descriptionKey: 'settings.woocommerceDescription',
    connectedKey: 'settings.woocommerceConnected',
    disconnectedKey: 'settings.woocommerceDisconnected',
    disconnectConfirmKey: 'settings.woocommerceDisconnectConfirm',
    errorKey: 'settings.woocommerceConnectError',
  },
};

/** 'keys' es el desvío para instalaciones donde la aprobación automática no prospera. */
type Mode = 'idle' | 'keys';

/**
 * Tarjeta de Ajustes → Canales para las tiendas Tiendanube y WooCommerce.
 * Comparte el layout con la de Shopify (chip de logo + descripción, fila
 * de conexión, acción abajo) para que la grilla se lea pareja.
 *
 * Las dos conectan distinto y la tarjeta lo refleja:
 *  - Tiendanube: un botón. La autorización es OAuth contra su portal.
 *  - WooCommerce: pide la dirección de la tienda, porque no hay servidor
 *    central al que apuntar — cada comercio aloja el suyo. Si el flujo de
 *    aprobación no prospera (WordPress detrás de proxy o login), queda la
 *    opción de pegar las claves de la API REST.
 */
export function StoreCard({ platform }: { platform: StorePlatform }) {
  const fetchWithCsrf = useFetchWithCsrf();
  const t = useT();
  const meta = META[platform];

  const [loading, setLoading] = useState(true);
  const [configured, setConfigured] = useState(false);
  const [connection, setConnection] = useState<StoreConnection | null>(null);
  const [mode, setMode] = useState<Mode>('idle');
  const [busy, setBusy] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);

  const [site, setSite] = useState('');
  const [key, setKey] = useState('');
  const [secret, setSecret] = useState('');
  const [showPlugin, setShowPlugin] = useState(false);
  /**
   * Chrome ignora `autocomplete="off"` y ofrece el correo de la sesión
   * sobre el campo de la dirección. Peor todavía: lo PINTA sin escribirlo
   * —`value` queda vacío— así que el campo se ve lleno y al conectar
   * falla. Un campo de solo lectura no lo autocompleta; se vuelve
   * editable al enfocarlo, que es cuando la persona va a escribir.
   */
  const [urlReadOnly, setUrlReadOnly] = useState(true);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch(`/api/${platform}/status`);
      const data = await res.json();
      setConfigured(Boolean(data.configured));
      setConnection(data.connection ?? null);
    } catch {
      // Silencioso: la tarjeta queda en "sin conectar", que es el estado
      // seguro. Un toast de error acá se dispararía en cada carga de
      // Ajustes ante un blip de red.
    } finally {
      setLoading(false);
    }
  }, [platform]);

  useEffect(() => {
    void load();
    const params = new URLSearchParams(window.location.search);
    const result = params.get(platform);
    if (result === 'connected') {
      const count = params.get('products');
      toast.success(t(meta.connectedKey));
      if (count && Number(count) > 0) {
        toast.success(t('settings.storeCatalogSynced', { count }));
      }
      // En WooCommerce la conexión no termina el trabajo: falta el plugin
      // de carritos. Es el único momento en que el comercio tiene el
      // contexto para entender para qué sirve, así que se le ofrece acá y
      // no escondido en un rincón de la tarjeta.
      if (platform === 'woocommerce') setShowPlugin(true);
    } else if (result === 'error') {
      toast.error(t(meta.errorKey, { reason: params.get('reason') ?? 'error' }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [platform]);

  function handleTiendanubeConnect() {
    window.location.href = '/api/tiendanube/oauth/start';
  }

  async function handleWooConnect() {
    if (!site.trim()) {
      toast.error(t('errStores.invalidSiteUrl'));
      return;
    }
    setBusy(true);
    try {
      const res = await fetchWithCsrf('/api/woocommerce/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ siteUrl: site.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.authorizeUrl) {
        toast.error(data.error ?? t(meta.errorKey, { reason: 'auth' }));
        return;
      }
      // Salimos a la pantalla de aprobación del propio WordPress del
      // comercio; la conexión se cierra cuando vuelve.
      window.location.href = data.authorizeUrl;
    } catch {
      toast.error(t(meta.errorKey, { reason: 'auth' }));
    } finally {
      setBusy(false);
    }
  }

  async function handleWooKeys() {
    if (!site.trim() || !key.trim() || !secret.trim()) {
      toast.error(t('settings.woocommerceKeysMissingFields'));
      return;
    }
    setBusy(true);
    try {
      const res = await fetchWithCsrf('/api/woocommerce/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          siteUrl: site.trim(),
          consumerKey: key.trim(),
          consumerSecret: secret.trim(),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error ?? t(meta.errorKey, { reason: 'keys' }));
        return;
      }
      toast.success(t(meta.connectedKey));
      if (data.products > 0) {
        toast.success(t('settings.storeCatalogSynced', { count: data.products }));
      }
      setConnection({
        shop_domain: data.shop_domain,
        shop_name: data.shop_name ?? null,
        status: 'active',
      });
      setMode('idle');
      setSite('');
      setKey('');
      setSecret('');
      // Mismo cierre que el camino automático: la conexión no termina el
      // trabajo hasta que el plugin de carritos está puesto.
      setShowPlugin(true);
    } catch {
      toast.error(t(meta.errorKey, { reason: 'keys' }));
    } finally {
      setBusy(false);
    }
  }

  async function handleSync() {
    setSyncing(true);
    try {
      const res = await fetchWithCsrf(`/api/${platform}/resync`, { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(t('settings.storeSyncError'));
        return;
      }
      toast.success(t('settings.storeCatalogSynced', { count: data.synced ?? 0 }));
    } catch {
      toast.error(t('settings.storeSyncError'));
    } finally {
      setSyncing(false);
    }
  }

  async function handleDisconnect() {
    if (!confirm(t(meta.disconnectConfirmKey))) return;
    setDisconnecting(true);
    try {
      const res = await fetchWithCsrf(`/api/${platform}/status`, { method: 'DELETE' });
      if (!res.ok) throw new Error('failed');
      toast.success(t(meta.disconnectedKey));
      setConnection(null);
    } catch {
      toast.error(t('settings.disconnectError'));
    } finally {
      setDisconnecting(false);
    }
  }

  const isConnected = connection?.status === 'active';
  // Tiendanube necesita una app registrada de nuestro lado; WooCommerce no
  // (las claves son del comercio contra su propio sitio), y su ruta de
  // estado siempre responde configured: true.
  const canConnect = platform === 'woocommerce' || configured;

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
        {/* El logo va sobre blanco en los dos modos: son marcas de colores
            sobre fondo transparente y en oscuro se pierden. */}
        <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-white p-2 shadow-sm ring-1 ring-border">
          <Image src={meta.logo} alt={meta.label} width={28} height={28} />
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-foreground">{meta.label}</p>
          <p className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-muted-foreground">
            {t(meta.descriptionKey)}
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
            </span>
            <button
              onClick={handleSync}
              disabled={syncing}
              title={t('settings.storeSyncCatalog')}
              className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              {syncing ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <RefreshCcw className="size-3.5" />
              )}
            </button>
            <button
              onClick={handleDisconnect}
              disabled={disconnecting}
              title={t('settings.disconnect')}
              className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-amber-700 dark:hover:text-amber-400"
            >
              {disconnecting ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Trash2 className="size-3.5" />
              )}
            </button>
          </li>
          {platform === 'woocommerce' && (
            <li className="rounded-md bg-muted/40 px-2 py-2 ring-1 ring-border/50">
              <p className="text-[11px] leading-snug text-muted-foreground">
                {t('settings.woocommerceCartPluginHint')}
              </p>
              <a
                href="/api/woocommerce/plugin"
                className="mt-1.5 inline-flex items-center gap-1.5 text-[11px] font-medium text-foreground hover:underline"
              >
                <Download className="size-3" />
                {t('settings.woocommerceDownloadPlugin')}
              </a>
            </li>
          )}
        </ul>
      ) : null}

      {!loading && !isConnected && (
        <div className="mt-auto space-y-2">
          {!canConnect ? (
            <p className="rounded-md bg-muted/50 px-2 py-1.5 text-[11px] leading-snug text-muted-foreground">
              {t('settings.missingCredentials')}
            </p>
          ) : platform === 'tiendanube' ? (
            <button
              onClick={handleTiendanubeConnect}
              // El título nombra la plataforma porque la página tiene una
              // docena de botones que dicen sólo "Conectar": sin esto no hay
              // manera de distinguirlos ni para un lector de pantalla ni
              // desde fuera.
              title={`${t('common.connect')} ${meta.label}`}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              <Image src={meta.logo} alt="" width={16} height={16} />
              {t('common.connect')}
            </button>
          ) : mode === 'keys' ? (
            <>
              <p className="rounded-md bg-muted/50 px-2 py-1.5 text-[11px] leading-snug text-muted-foreground">
                {t('settings.woocommerceKeysGuide')}
              </p>
              <Input
                type="url"
                name="riverz-store-url"
                autoComplete="off"
                inputMode="url"
                readOnly={urlReadOnly}
                onPointerDown={() => setUrlReadOnly(false)}
                onFocus={() => setUrlReadOnly(false)}
                placeholder={t('settings.woocommerceSitePlaceholder')}
                value={site}
                onChange={(e) => setSite(e.target.value)}
                className="bg-background text-sm"
              />
              <Input
                type="password"
                autoComplete="new-password"
                placeholder={t('settings.woocommerceKeyPlaceholder')}
                value={key}
                onChange={(e) => setKey(e.target.value)}
                className="bg-background text-sm"
              />
              <Input
                type="password"
                autoComplete="new-password"
                placeholder={t('settings.woocommerceSecretPlaceholder')}
                value={secret}
                onChange={(e) => setSecret(e.target.value)}
                className="bg-background text-sm"
              />
              <div className="flex gap-2">
                <button
                  onClick={handleWooKeys}
                  disabled={busy}
                  className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
                >
                  {busy && <Loader2 className="size-3.5 animate-spin" />}
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
            // WooCommerce no tiene un servidor central al que mandar al
            // comercio: hay que saber la dirección de SU tienda. El campo va
            // a la vista desde el principio — antes había que apretar
            // "Conectar" para que apareciera y volver a apretar "Conectar"
            // para conectar, dos botones idénticos en fila.
            <>
              <Input
                type="url"
                name="riverz-store-url"
                autoComplete="off"
                inputMode="url"
                readOnly={urlReadOnly}
                onPointerDown={() => setUrlReadOnly(false)}
                onFocus={() => setUrlReadOnly(false)}
                placeholder={t('settings.woocommerceSitePlaceholder')}
                value={site}
                onChange={(e) => setSite(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void handleWooConnect()
                }}
                className="bg-background text-sm"
              />
              {/* El desvío por claves va ARRIBA del botón: así el botón queda
                  último, alineado con el de las demás tarjetas de la grilla.
                  Se queda porque la aprobación automática no prospera en todo
                  WordPress (detrás de proxy o con login), y sin este camino esos
                  comercios no tienen forma de conectar. */}
              <button
                onClick={() => setMode('keys')}
                className="w-full px-3 py-1 text-[11px] text-muted-foreground hover:text-foreground"
              >
                {t('settings.woocommerceUseKeysLink')}
              </button>
              <button
                onClick={handleWooConnect}
                disabled={busy}
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
              >
                {busy ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Image src={meta.logo} alt="" width={16} height={16} />
                )}
                {t('common.connect')}
              </button>
            </>
          )}
        </div>
      )}

      {platform === 'woocommerce' && (
        <WooCommerceDialog
          open={showPlugin}
          onClose={() => setShowPlugin(false)}
        />
      )}
    </li>
  );
}
