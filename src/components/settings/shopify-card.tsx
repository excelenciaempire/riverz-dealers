'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, Store, Plug, Unplug } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';

interface ShopifyConnection {
  shop_domain: string;
  shop_name: string | null;
  status: string;
}

/**
 * Settings → Channels card for connecting a Shopify store. Connect kicks off
 * OAuth (server route sets the state cookies + redirects to Shopify). On
 * return, the callback bounces back with ?shopify=connected|error.
 */
export function ShopifyCard() {
  const [loading, setLoading] = useState(true);
  const [configured, setConfigured] = useState(false);
  const [connection, setConnection] = useState<ShopifyConnection | null>(null);
  const [shop, setShop] = useState('');
  const [disconnecting, setDisconnecting] = useState(false);

  useEffect(() => {
    void load();
    // Surface the callback result once.
    const params = new URLSearchParams(window.location.search);
    const result = params.get('shopify');
    if (result === 'connected') toast.success('Shopify conectado');
    else if (result === 'error')
      toast.error(`No se pudo conectar Shopify (${params.get('reason') ?? 'error'})`);
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
      toast.error('Escribe el dominio de tu tienda (tu-tienda.myshopify.com).');
      return;
    }
    window.location.href = `/api/shopify/install?shop=${encodeURIComponent(trimmed)}`;
  }

  async function handleDisconnect() {
    setDisconnecting(true);
    try {
      const res = await fetch('/api/shopify/status', { method: 'DELETE' });
      if (!res.ok) throw new Error('failed');
      toast.success('Shopify desconectado');
      setConnection(null);
    } catch {
      toast.error('No se pudo desconectar');
    } finally {
      setDisconnecting(false);
    }
  }

  const isConnected = connection?.status === 'active';

  return (
    <Card className="bg-card border-border ring-0">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-foreground">
          <Store className="size-5 text-accent-ink" />
          Shopify
        </CardTitle>
        <CardDescription className="text-muted-foreground">
          Conecta tu tienda para disparar automatizaciones de WhatsApp ante
          carritos abandonados.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex items-center py-4">
            <Loader2 className="size-5 animate-spin text-accent-ink" />
          </div>
        ) : !configured ? (
          <p className="text-sm text-muted-foreground">
            La integración con Shopify aún no está configurada en el servidor
            (faltan <code>SHOPIFY_API_KEY</code> / <code>SHOPIFY_API_SECRET</code>).
            Consulta <code>SHOPIFY_SETUP.md</code>.
          </p>
        ) : isConnected ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-foreground">
                {connection?.shop_name || connection?.shop_domain}
              </p>
              <p className="text-xs text-muted-foreground">
                {connection?.shop_domain} · conectada
              </p>
            </div>
            <Button
              variant="outline"
              onClick={handleDisconnect}
              disabled={disconnecting}
              className="border-red-500/30 bg-transparent text-red-400 hover:bg-red-500/10"
            >
              {disconnecting ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Unplug className="size-4" />
              )}
              Desconectar
            </Button>
          </div>
        ) : (
          <div className="flex flex-wrap items-end gap-2">
            <div className="flex-1 min-w-56 space-y-1.5">
              <label className="text-xs font-medium text-foreground">
                Dominio de la tienda
              </label>
              <Input
                placeholder="tu-tienda.myshopify.com"
                value={shop}
                onChange={(e) => setShop(e.target.value)}
                className="bg-muted border-border text-foreground"
              />
            </div>
            <Button
              onClick={handleConnect}
              className="bg-primary hover:bg-primary/90 text-primary-foreground"
            >
              <Plug className="size-4" />
              Conectar
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
