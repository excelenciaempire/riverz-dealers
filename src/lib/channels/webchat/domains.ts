import type { SupabaseClient } from '@supabase/supabase-js';
import { normalizeOrigin } from './config';

/**
 * Los dominios donde vive la tienda del comercio, deducidos de lo que Riverz
 * ya sabe.
 *
 * Existe porque la lista de dominios permitidos es el único paso manual de la
 * instalación y era el que la rompía en silencio: quien pega el código sin
 * cargar su dominio no ve el chat, y el widget —que falla callado a propósito,
 * para no mostrar un error en la tienda de nadie— no le dice por qué.
 *
 * De dónde salen, en orden de confianza:
 *   1. `store_url`, cuando la tienda declaró su dominio propio.
 *   2. El host de las URLs de sus productos, que es el dominio PÚBLICO real —
 *      el que ve el cliente— y por eso el que importa.
 *   3. `shop_domain`, el `*.myshopify.com` de siempre: sirve aunque tenga
 *      dominio propio, porque la vista previa del tema se sirve desde ahí.
 *
 * Sin llamadas a la API de la tienda: esto se ejecuta al abrir una pantalla de
 * configuración y no puede costar un viaje a Shopify.
 */
export async function detectStoreDomains(
  db: SupabaseClient,
  workspaceId: string,
): Promise<string[]> {
  const found: string[] = [];

  const { data: stores } = await db
    .from('shopify_connections')
    .select('shop_domain, store_url')
    .eq('workspace_id', workspaceId);

  for (const s of (stores ?? []) as Array<{ shop_domain?: string; store_url?: string }>) {
    if (s.store_url) found.push(s.store_url);
    if (s.shop_domain) found.push(s.shop_domain);
  }

  const { data: products } = await db
    .from('shopify_products')
    .select('url')
    .eq('workspace_id', workspaceId)
    .not('url', 'is', null)
    .limit(50);

  for (const p of (products ?? []) as Array<{ url?: string }>) {
    if (p.url) found.push(p.url);
  }

  const out: string[] = [];
  for (const raw of found) {
    const host = normalizeOrigin(raw);
    // Los marketplaces no son la tienda del comercio: un producto espejado de
    // Mercado Libre trae su URL, y autorizar ese dominio sería instalarle el
    // chat a Mercado Libre.
    if (!host || MARKETPLACES.some((m) => host === m || host.endsWith(`.${m}`))) continue;
    if (!out.includes(host)) out.push(host);
  }
  return out.slice(0, 5);
}

/**
 * Sitios donde el comercio VENDE pero que no son suyos: no se puede pegar un
 * script ahí, y autorizarlos sería abrirle el chat a la plataforma entera.
 *
 * Ojo con qué NO va acá: `mitiendanube.com` y `myshopify.com` sí son la tienda
 * del comercio —es el dominio que le dieron— y son justo donde tiene que
 * aparecer el chat.
 */
const MARKETPLACES = [
  'mercadolibre.com',
  'mercadolibre.com.ar',
  'mercadolibre.com.mx',
  'mercadolibre.com.co',
  'mercadolivre.com.br',
  'amazon.com',
  'amazon.com.mx',
  'ebay.com',
];
