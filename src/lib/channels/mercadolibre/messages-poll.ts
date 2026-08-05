import type { SupabaseClient } from "@supabase/supabase-js";
import type { ChannelConnection } from "@/types";
import { supabaseAdmin } from "../admin-client";
import { ingestInboundEvent } from "../inbox-writer";
import { buildPackEvents, getFreshMLToken } from "./adapter";
import { getLogger } from "@/lib/log/logger";

const ML = "https://api.mercadolibre.com";
const log = getLogger("channels.mercadolibre.messages-poll");

/** Ventana de pedidos cuyos hilos vale la pena revisar. */
const WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
/** Tope de hilos por corrida. Con más pedidos, la corrida siguiente sigue. */
const MAX_PACKS_PER_RUN = 30;
/** Pedidos que se piden a Mercado Libre para sacar los ids de hilo. */
const ORDERS_PAGE = 50;

/**
 * Mensajes post-venta de Mercado Libre — lado sondeo.
 *
 * Las preguntas, los pedidos, el catálogo y las opiniones ya se sondean; los
 * mensajes eran lo único que dependía **por completo** de la notificación de
 * Mercado Libre. Y esa notificación es frágil de una forma que no se ve:
 * `notifications_callback_url` es UN SOLO campo por aplicación, se configura a
 * mano en el panel de Mercado Libre y quien lo cambie se lleva las
 * notificaciones de todos los comercios sin que nada falle en Riverz. Medido el
 * 2026-08-05: en toda la base no había un solo mensaje post-venta ingerido por
 * notificación.
 *
 * Qué hilos mira, en dos frentes que se complementan:
 *
 *   - Los NO LEÍDOS (`/messages/unread`) — una sola llamada, trae lo nuevo al
 *     instante y sin recorrer nada.
 *   - Los de los PEDIDOS RECIENTES — porque un mensaje que el vendedor abrió
 *     desde la app de Mercado Libre deja de estar no leído y el primer frente
 *     ya no lo ve nunca más. Sin esto, el hilo queda partido en Riverz.
 *
 * Todo pasa por `ingestInboundEvent`, que corta por id externo: sondeo y
 * notificación pueden convivir sin duplicar nada.
 */
export async function pollAllMercadoLibreMessages(): Promise<{
  sellers: number;
  packs: number;
  ingested: number;
}> {
  const db = supabaseAdmin();
  const { data } = await db
    .from("channel_connections")
    .select("*")
    .eq("channel", "mercadolibre")
    // error/expired incluidos: `getFreshMLToken` refresca y sana la fila, y son
    // justamente los vendedores con más chance de haber perdido un mensaje.
    .in("status", ["connected", "error", "expired"]);
  const conns = (data ?? []) as ChannelConnection[];

  let packs = 0;
  let ingested = 0;
  for (const conn of conns) {
    try {
      const r = await pollOneSeller(db, conn);
      packs += r.packs;
      ingested += r.ingested;
    } catch (err) {
      log.warn("ml messages poll failed", {
        connectionId: conn.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return { sellers: conns.length, packs, ingested };
}

async function pollOneSeller(
  db: SupabaseClient,
  conn: ChannelConnection,
): Promise<{ packs: number; ingested: number }> {
  const cfg = (conn.config ?? {}) as Record<string, unknown>;
  const sellerId = String(cfg.seller_id ?? "");
  if (!sellerId) return { packs: 0, ingested: 0 };

  const token = await getFreshMLToken(conn);
  const auth = { Authorization: `Bearer ${token}` };

  const packIds = new Set<string>();
  for (const id of await unreadPackIds(sellerId, auth)) packIds.add(id);
  for (const id of await recentOrderPackIds(sellerId, auth)) {
    if (packIds.size >= MAX_PACKS_PER_RUN) break;
    packIds.add(id);
  }
  if (packIds.size === 0) return { packs: 0, ingested: 0 };

  let ingested = 0;
  for (const packId of [...packIds].slice(0, MAX_PACKS_PER_RUN)) {
    const events = await buildPackEvents({
      connection: conn,
      packId,
      sellerId,
      token,
    });
    for (const event of events) {
      const written = await ingestInboundEvent(db, event);
      if (written) ingested++;
    }
  }
  return { packs: packIds.size, ingested };
}

/** Hilos con mensajes sin leer. Una llamada, y es lo que llega primero. */
async function unreadPackIds(
  sellerId: string,
  auth: Record<string, string>,
): Promise<string[]> {
  try {
    const r = await fetch(`${ML}/messages/unread?role=seller&tag=post_sale`, {
      headers: auth,
    });
    if (!r.ok) return [];
    const j = (await r.json()) as {
      results?: Array<{ pack_id?: unknown; resource?: unknown; id?: unknown }>;
    };
    const ids: string[] = [];
    for (const row of j.results ?? []) {
      // Mercado Libre no es consistente en cómo nombra el hilo según el
      // recurso; aceptamos las tres formas que devuelve en vez de asumir una.
      const id = row.pack_id ?? row.id ?? extractPackId(String(row.resource ?? ""));
      if (id) ids.push(String(id));
    }
    return ids;
  } catch {
    return [];
  }
}

/**
 * Hilos de los pedidos recientes. Sin `pack_id` el hilo se identifica con el id
 * del pedido: en una compra de un solo producto Mercado Libre no crea paquete.
 */
async function recentOrderPackIds(
  sellerId: string,
  auth: Record<string, string>,
): Promise<string[]> {
  const from = new Date(Date.now() - WINDOW_MS).toISOString().replace(/\.\d{3}Z$/, ".000-00:00");
  try {
    const r = await fetch(
      `${ML}/orders/search?seller=${sellerId}` +
        `&order.date_last_updated.from=${encodeURIComponent(from)}` +
        `&sort=date_desc&limit=${ORDERS_PAGE}`,
      { headers: auth },
    );
    if (!r.ok) return [];
    const j = (await r.json()) as {
      results?: Array<{ id?: unknown; pack_id?: unknown }>;
    };
    return (j.results ?? [])
      .map((o) => o.pack_id ?? o.id)
      .filter(Boolean)
      .map(String);
  } catch {
    return [];
  }
}

/** "/messages/packs/123/sellers/456" → "123". */
function extractPackId(resource: string): string | null {
  const m = resource.match(/packs\/(\d+)/);
  return m ? m[1] : null;
}
