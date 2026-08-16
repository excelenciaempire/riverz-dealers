import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Enlaces REALES de la tienda para que el DM pueda cerrar la venta.
 *
 * Sin esto el modelo escribía marcadores — "puedes comprarlo en el siguiente
 * enlace [enlace de la tienda web]" — que llegaban tal cual al cliente. Le
 * damos la URL de la tienda y la de los productos a destacar, y el prompt
 * prohíbe inventar o dejar placeholders.
 */
export interface StoreLinks {
  storeUrl: string | null;
  products: Array<{ title: string; url: string }>;
}

export async function loadStoreLinks(
  db: SupabaseClient,
  workspaceId: string,
  productTitles: string[] = [],
): Promise<StoreLinks> {
  const [{ data: conn }, { data: products }] = await Promise.all([
    db
      // Cualquier tienda, no solo Shopify: los enlaces salen del dominio de
      // la tienda conectada y el catalogo ya vive sincronizado en Riverz, asi
      // que la plataforma da igual. Filtrar por 'shopify' dejaba al agente de
      // un comercio de Tiendanube sin ningun enlace que ofrecer.
      .from('shopify_connections')
      .select('shop_domain, store_url')
      .eq('workspace_id', workspaceId)
      .eq('status', 'active')
      .limit(1)
      .maybeSingle(),
    db
      .from('shopify_products')
      .select('title, url')
      .eq('workspace_id', workspaceId)
      .not('url', 'is', null)
      .limit(60),
  ]);

  const domain = (conn as { shop_domain?: string } | null)?.shop_domain ?? null;
  const rows = (products ?? []) as Array<{ title: string; url: string }>;

  // Los productos del plan primero; si el plan no nombra ninguno, los primeros
  // del catálogo sirven de respaldo para no quedarnos sin enlace que ofrecer.
  const wanted = productTitles.map((t) => t.toLowerCase().trim()).filter(Boolean);
  const picked = wanted.length
    ? rows.filter((p) => wanted.some((w) => p.title.toLowerCase().includes(w) || w.includes(p.title.toLowerCase())))
    : [];

  return {
    storeUrl: domain ? `https://${domain}` : null,
    products: (picked.length ? picked : rows).slice(0, 4),
  };
}

/** Bloque de enlaces para el prompt. Vacío si no hay ninguno. */
export function linksBrief(links: StoreLinks | null): string {
  if (!links) return '';
  const lines: string[] = [];
  for (const p of links.products) lines.push(`- ${p.title}: ${p.url}`);
  if (links.storeUrl) lines.push(`- Tienda: ${links.storeUrl}`);
  if (lines.length === 0) return '';
  return `ENLACES REALES (usa uno TAL CUAL si vas a compartir un link):\n${lines.join('\n')}`;
}
