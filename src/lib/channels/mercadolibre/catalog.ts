import type { SupabaseClient } from "@supabase/supabase-js";
import { listConnections } from "../connections";
import type { ChannelConnection } from "@/types";
import { supabaseAdmin } from "../admin-client";
import { getFreshMLToken } from "./adapter";
import { upsertCatalog } from "@/lib/commerce/catalog";
import { normalizeMlItem } from "@/lib/commerce/providers/mercadolibre";
import { getLogger } from "@/lib/log/logger";
import { mercadoLibreFailure, type MercadoLibreSyncFailure } from "./sync-result";

const ML = "https://api.mercadolibre.com";
const log = getLogger("channels.mercadolibre.catalog");

/** Publicaciones por lote en `/items?ids=` (tope de Mercado Libre). */
const BATCH = 20;

/**
 * Trae las publicaciones del vendedor al catálogo común.
 *
 * Sin esto el agente no puede citar un precio ni saber si algo está agotado en
 * Mercado Libre: contestaría con el catálogo de otra tienda, o con nada.
 *
 * Escribe en la misma tabla que Shopify, Tiendanube y WooCommerce, así que la
 * página de Productos, los flujos y la búsqueda lo toman sin cambios. El
 * `shop_domain` sintético (`mercadolibre:<seller_id>`) mantiene el catálogo
 * acotado: `upsertCatalog` borra lo que sobra SÓLO dentro de ese dominio, de
 * modo que sincronizar Mercado Libre nunca toca los productos de la tienda.
 */
export async function syncAllMercadoLibreCatalogs(): Promise<{
  sellers: number;
  products: number;
  failures: MercadoLibreSyncFailure[];
}> {
  const db = supabaseAdmin();
  const conns = await listConnections(db, { channel: "mercadolibre" });

  let products = 0;
  const failures: MercadoLibreSyncFailure[] = [];
  for (const conn of conns) {
    try {
      products += await syncOne(db, conn);
    } catch (err) {
      log.warn("ml catalog sync failed", {
        connectionId: conn.id,
        error: err instanceof Error ? err.message : String(err),
      });
      failures.push(mercadoLibreFailure(conn.id, err));
    }
  }
  return { sellers: conns.length, products, failures };
}

async function syncOne(db: SupabaseClient, conn: ChannelConnection): Promise<number> {
  const cfg = (conn.config ?? {}) as Record<string, unknown>;
  const sellerId = String(cfg.seller_id ?? "");
  if (!sellerId) throw new Error("conexión sin seller_id");

  const token = await getFreshMLToken(conn);
  const auth = { Authorization: `Bearer ${token}` };

  // 1. Ids de las publicaciones del vendedor.
  const ids: string[] = [];
  let offset = 0;
  for (;;) {
    const r = await fetch(`${ML}/users/${sellerId}/items/search?limit=100&offset=${offset}`, { headers: auth });
    if (!r.ok) throw new Error(`items/search HTTP ${r.status}`);
    const j = (await r.json()) as {
      results?: string[];
      paging?: { total?: number };
    };
    const batch = j.results ?? [];
    if (batch.length === 0) break;
    ids.push(...batch);
    offset += batch.length;
    if (offset >= Math.min(j.paging?.total ?? 0, 1000)) break;
  }
  if (ids.length === 0) return 0;

  // 2. Detalle por lotes.
  const products = [];
  for (let i = 0; i < ids.length; i += BATCH) {
    const chunk = ids.slice(i, i + BATCH);
    const r = await fetch(`${ML}/items?ids=${chunk.join(",")}`, {
      headers: auth,
    });
    if (!r.ok) throw new Error(`items detail HTTP ${r.status}`);
    const rows = (await r.json()) as Array<{ code?: number; body?: unknown }>;
    for (const row of rows) {
      if (row?.code !== 200) {
        throw new Error(`item detail HTTP ${row?.code ?? "desconocido"}`);
      }
      const p = normalizeMlItem(row.body);
      if (p) products.push(p);
    }
  }
  if (products.length === 0) return 0;

  // 3. Dueño del workspace: `shopify_products.user_id` es NOT NULL y la
  //    conexión no lo lleva (es del canal, no de una persona).
  const { data: ws } = await db.from("workspaces").select("owner_id").eq("id", conn.workspace_id).maybeSingle();
  const userId = (ws as { owner_id?: string } | null)?.owner_id;
  if (!userId) {
    throw new Error(`workspace ${conn.workspace_id} sin owner_id`);
  }

  const currency = products.find((p) => p.raw?.currency_id)?.raw?.currency_id as string | undefined;

  const res = await upsertCatalog(db, {
    platform: "mercadolibre",
    userId,
    workspaceId: conn.workspace_id,
    shopDomain: `mercadolibre:${sellerId}`,
    currency: currency ?? null,
    products,
  });
  return res.synced;
}
