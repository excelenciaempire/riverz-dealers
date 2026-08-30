import type { SupabaseClient } from "@supabase/supabase-js";
import type { ChannelConnection } from "@/types";
import type { InboundEvent } from "../types";
import { supabaseAdmin } from "../admin-client";
import { ingestInboundEvent } from "../inbox-writer";
import { listConnections } from "../connections";
import { buildPackEvents, getFreshMLToken } from "./adapter";
import { getLogger } from "@/lib/log/logger";

const ML = "https://api.mercadolibre.com";
const log = getLogger("channels.mercadolibre.messages-poll");

/**
 * Ventana de pedidos cuyos hilos vale la pena revisar.
 *
 * 48 h y no una semana: el frente de los NO LEÍDOS ya avisa de cualquier hilo
 * con novedad, sin importar la antigüedad del pedido. Esta ventana existe sólo
 * para el caso en que el vendedor haya leído el mensaje desde la app de Mercado
 * Libre antes que nosotros — y eso pasa dentro de las horas siguientes, no una
 * semana después.
 */
const WINDOW_MS = 48 * 60 * 60 * 1000;
/**
 * Cada cuánto se le vuelve a dar una oportunidad a un hilo que Mercado Libre
 * declaró cerrado. Puede reabrirse si el comprador escribe, pero eso ya llega
 * por los no leídos: esta relectura es sólo la red por si ese aviso se pierde.
 */
const QUIET_RECHECK_MS = 12 * 60 * 60 * 1000;
/** Tope de hilos recordados como cerrados. Impide que `config` crezca sin fin. */
const MAX_QUIET_TRACKED = 300;
/**
 * A partir de acá un mensaje rescatado entra como pendiente pero NO despierta al
 * agente. El sondeo corre cada 5 minutos, así que lo que acaba de llegar cae
 * holgadamente por debajo; lo que aparece más tarde es historia que no se había
 * podido leer, y contestarla en diferido es peor que no contestarla. Estos
 * hilos son reclamos de envío de hace días: una respuesta automática ahí llega
 * como un bot hablando del pasado.
 */
const LIVE_WINDOW_MS = 60 * 60_000;
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
 * Y lo que NO mira: los hilos que Mercado Libre declara cerrados. Medido el
 * 2026-08-05, 21 de 24 ventas devuelven `blocked` y vacío —la plataforma no
 * deja conversar salvo que el comprador escriba primero— y releerlas cada cinco
 * minutos era casi todo el costo. Importa porque la cuota es POR APLICACIÓN, no
 * por comercio: lo que gasta uno se lo saca a los demás.
 *
 * Todo pasa por `ingestInboundEvent`, que corta por id externo: sondeo y
 * notificación pueden convivir sin duplicar nada.
 */
export async function pollAllMercadoLibreMessages(): Promise<{
  sellers: number;
  packs: number;
  skipped: number;
  ingested: number;
}> {
  const db = supabaseAdmin();
  // error/expired incluidos: `getFreshMLToken` refresca y sana la fila, y son
  // justamente los vendedores con más chance de haber perdido un mensaje.
  const conns = await listConnections(db, { channel: "mercadolibre" });

  let packs = 0;
  let skipped = 0;
  let ingested = 0;
  for (const conn of conns) {
    try {
      const r = await pollOneSeller(db, conn);
      packs += r.packs;
      skipped += r.skipped;
      ingested += r.ingested;
    } catch (err) {
      log.warn("ml messages poll failed", {
        connectionId: conn.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return { sellers: conns.length, packs, skipped, ingested };
}

async function pollOneSeller(
  db: SupabaseClient,
  conn: ChannelConnection,
): Promise<{ packs: number; skipped: number; ingested: number }> {
  const cfg = (conn.config ?? {}) as Record<string, unknown>;
  const sellerId = String(cfg.seller_id ?? "");
  if (!sellerId) return { packs: 0, skipped: 0, ingested: 0 };

  const token = await getFreshMLToken(conn);
  const auth = { Authorization: `Bearer ${token}` };

  // Un hilo con novedad SIEMPRE se lee, esté o no en la lista de cerrados: los
  // no leídos son la señal de que Mercado Libre lo reabrió.
  const unread = new Set(await unreadPackIds(sellerId, auth));
  const quiet = readQuietPacks(cfg);
  const now = Date.now();

  const packIds = new Set(unread);
  let skipped = 0;
  for (const id of await recentOrderPackIds(sellerId, auth)) {
    if (packIds.size >= MAX_PACKS_PER_RUN) break;
    if (unread.has(id)) continue;
    const checkedAt = quiet[id];
    if (checkedAt && now - checkedAt < QUIET_RECHECK_MS) {
      skipped++;
      continue;
    }
    packIds.add(id);
  }
  if (packIds.size === 0) return { packs: 0, skipped, ingested: 0 };

  let ingested = 0;
  const read: string[] = [];
  const nowQuiet: string[] = [];
  for (const packId of [...packIds].slice(0, MAX_PACKS_PER_RUN)) {
    const pack = await buildPackEvents({ connection: conn, packId, sellerId, token });
    read.push(packId);
    if (pack.quiet) nowQuiet.push(packId);
    for (const event of markRescued(pack.events)) {
      const written = await ingestInboundEvent(db, event);
      if (written) ingested++;
    }
  }
  await rememberQuietPacks(db, conn, quiet, read, nowQuiet, now);
  return { packs: packIds.size, skipped, ingested };
}

/** Hilos que Mercado Libre declaró cerrados, con cuándo se comprobó. */
function readQuietPacks(cfg: Record<string, unknown>): Record<string, number> {
  const raw = cfg.quiet_packs;
  if (!raw || typeof raw !== "object") return {};
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const n = Number(v);
    if (Number.isFinite(n)) out[k] = n;
  }
  return out;
}

/**
 * Guarda la lista de hilos cerrados en la conexión.
 *
 * Vive en `config` y no en una tabla nueva porque es una caché descartable: si
 * se pierde, la peor consecuencia es una corrida cara. Se poda por antigüedad
 * para que no crezca sin límite con cada venta del comercio.
 */
async function rememberQuietPacks(
  db: SupabaseClient,
  conn: ChannelConnection,
  previous: Record<string, number>,
  read: string[],
  nowQuiet: string[],
  now: number,
): Promise<void> {
  const next = { ...previous };
  // Lo que acabamos de leer se reevalúa entero: un hilo que estaba cerrado y
  // ahora tiene mensajes sale de la lista y vuelve al sondeo de cada corrida.
  for (const id of read) delete next[id];
  for (const id of nowQuiet) next[id] = now;
  const entries = Object.entries(next)
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_QUIET_TRACKED);
  const trimmed = Object.fromEntries(entries);
  if (JSON.stringify(trimmed) === JSON.stringify(previous)) return;

  // Relectura antes de escribir: el refresco de token reescribe `config` y
  // pisar la fila con una copia vieja borraría el `refresh_token` recién
  // rotado.
  const { data } = await db
    .from("channel_connections")
    .select("config")
    .eq("id", conn.id)
    .maybeSingle();
  const fresh = ((data as { config?: Record<string, unknown> } | null)?.config ??
    {}) as Record<string, unknown>;
  await db
    .from("channel_connections")
    .update({ config: { ...fresh, quiet_packs: trimmed } })
    .eq("id", conn.id);
}

/**
 * Marca qué mensajes del hilo son "rescate": entran a la bandeja y cuentan como
 * pendientes, pero no despiertan al agente.
 *
 * Un hilo trae su historia entera, no sólo lo nuevo. Sin esto, la primera
 * corrida sobre un vendedor que nunca se había podido leer dispararía respuestas
 * automáticas sobre conversaciones de semanas atrás — y encima ya contestadas
 * por el vendedor desde la app de Mercado Libre.
 *
 * Dos criterios, los mismos que en comentarios: la antigüedad, y si el vendedor
 * ya respondió después.
 */
function markRescued(events: InboundEvent[]): InboundEvent[] {
  const lastSellerAt = events
    .filter((e) => e.outbound)
    .reduce((max, e) => Math.max(max, Date.parse(e.receivedAt) || 0), 0);
  return events.map((e) => {
    if (e.outbound) return e;
    const at = Date.parse(e.receivedAt) || 0;
    // El `!( … )` deja del lado seguro una fecha ilegible: mejor no contestar de
    // más que contestar tarde.
    const stale = !(Date.now() - at < LIVE_WINDOW_MS);
    return stale || at <= lastSellerAt ? { ...e, suppressAutoReply: true } : e;
  });
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
