import type { ChannelConnection } from "@/types";
import { supabaseAdmin } from "../admin-client";
import { ingestInboundEvent } from "../inbox-writer";
import { getFreshMLToken } from "../mercadolibre/adapter";
import { getLogger } from "@/lib/log/logger";

const ML = "https://api.mercadolibre.com";
const log = getLogger("channels.ml_review");

/** Cuántas publicaciones se revisan por corrida. */
const MAX_ITEMS = 60;
/** Página al recorrer las opiniones de una publicación que creció. */
const PAGE = 50;
/** Tope de opiniones recorridas por publicación, para no barrer un histórico
 *  de miles cuando el contador se dispara. */
const MAX_SCAN = 400;

/**
 * Estado por publicación: cuántas opiniones tenía la última vez y cuándo se
 * miró. Vive en `channel_connections.config.reviews_state`.
 */
interface ItemState {
  total: number;
  checkedAt: string;
}

/**
 * Trae las opiniones NUEVAS de las publicaciones de cada vendedor conectado.
 *
 * Cómo se detecta lo nuevo, y por qué así:
 *   `/reviews/item/{id}` devuelve SIEMPRE por relevancia — probé `sort`,
 *   `order`, `date_desc`, `-date_created` y `recent`: los cinco devuelven el
 *   mismo orden. Así que no hay forma de pedir "las últimas", y en una
 *   publicación con 492 opiniones la nueva puede caer en cualquier página.
 *
 *   Lo que sí es barato es CONTAR: con `limit=1` la respuesta trae
 *   `paging.total`. Una petición por publicación y por corrida basta para
 *   saber si pasó algo. Sólo cuando el contador sube se recorren las páginas
 *   buscando las opiniones posteriores a la última revisión.
 *
 * La primera vez que se ve una publicación se guarda el conteo y NO se importa
 * nada: volcar cientos de opiniones viejas en la bandeja no es "recibir las
 * opiniones", es enterrar todo lo demás. Desde ahí en adelante entra lo nuevo.
 *
 * La deduplicación real la hace `ingestInboundEvent` con `externalMessageId`
 * (`rev:<id>`), así que un conteo mal guardado nunca duplica un mensaje.
 */
export async function pollAllMercadoLibreReviews(): Promise<{
  sellers: number;
  items: number;
  ingested: number;
}> {
  const db = supabaseAdmin();
  const { data } = await db
    .from("channel_connections")
    .select("*")
    .eq("channel", "mercadolibre")
    .in("status", ["connected", "error", "expired"]);
  const conns = (data ?? []) as ChannelConnection[];

  let items = 0;
  let ingested = 0;
  for (const conn of conns) {
    try {
      const r = await pollOneSeller(conn);
      items += r.items;
      ingested += r.ingested;
    } catch (err) {
      log.warn("ml reviews poll failed for connection", {
        connectionId: conn.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return { sellers: conns.length, items, ingested };
}

async function pollOneSeller(
  conn: ChannelConnection,
): Promise<{ items: number; ingested: number }> {
  const cfg = (conn.config ?? {}) as Record<string, unknown>;
  const sellerId = String(cfg.seller_id ?? "");
  if (!sellerId) return { items: 0, ingested: 0 };

  const token = await getFreshMLToken(conn);
  const auth = { Authorization: `Bearer ${token}` };

  const searchRes = await fetch(
    `${ML}/users/${sellerId}/items/search?limit=${MAX_ITEMS}`,
    { headers: auth },
  );
  if (!searchRes.ok) return { items: 0, ingested: 0 };
  const itemIds = ((await searchRes.json()) as { results?: string[] }).results ?? [];
  if (itemIds.length === 0) return { items: 0, ingested: 0 };

  const state = { ...((cfg.reviews_state ?? {}) as Record<string, ItemState>) };
  const db = supabaseAdmin();
  const now = new Date().toISOString();
  let ingested = 0;

  for (const itemId of itemIds) {
    // 1. ¿Cambió el conteo? Una petición, sin traer las opiniones.
    const headRes = await fetch(`${ML}/reviews/item/${itemId}?limit=1`, {
      headers: auth,
    });
    if (!headRes.ok) continue;
    const head = (await headRes.json()) as {
      paging?: { total?: number };
      rating_average?: number;
    };
    const total = Number(head.paging?.total ?? 0);
    const prev = state[itemId];

    // 2. Primera vez: sembrar el conteo sin importar el histórico.
    if (!prev) {
      state[itemId] = { total, checkedAt: now };
      continue;
    }
    if (total <= prev.total) {
      state[itemId] = { total, checkedAt: prev.checkedAt };
      continue;
    }

    // 3. Creció: recorrer buscando las posteriores a la última revisión.
    const since = Date.parse(prev.checkedAt) || 0;
    const title = await itemTitle(itemId, auth);
    let offset = 0;
    let found = 0;
    while (offset < Math.min(total, MAX_SCAN)) {
      const pageRes = await fetch(
        `${ML}/reviews/item/${itemId}?limit=${PAGE}&offset=${offset}`,
        { headers: auth },
      );
      if (!pageRes.ok) break;
      const page = (await pageRes.json()) as { reviews?: MlReview[] };
      const reviews = page.reviews ?? [];
      if (reviews.length === 0) break;

      for (const rev of reviews) {
        if (!rev?.id) continue;
        const created = Date.parse(rev.date_created ?? "") || 0;
        if (created <= since) continue;
        const wrote = await ingestInboundEvent(db, {
          channel: "ml_review",
          connection: conn,
          // El hilo es el PRODUCTO, no la persona: Mercado Libre anonimiza a
          // quien opina, así que no hay contacto que representar. Agrupadas por
          // publicación, además, es como el comercio las quiere leer ("¿qué
          // dicen del sérum?").
          externalContactId: `item:${itemId}`,
          contactName: title || itemId,
          externalMessageId: `rev:${rev.id}`,
          externalThreadId: `item:${itemId}`,
          subject: title || itemId,
          text: formatReview(rev),
          receivedAt: rev.date_created ?? now,
          raw: rev as unknown as Record<string, unknown>,
        });
        if (wrote) {
          ingested++;
          found++;
        }
      }
      offset += PAGE;
    }
    log.info("ml reviews grew", {
      itemId,
      from: prev.total,
      to: total,
      ingested: found,
    });
    state[itemId] = { total, checkedAt: now };
  }

  await db
    .from("channel_connections")
    .update({ config: { ...cfg, reviews_state: state } })
    .eq("id", conn.id);

  return { items: itemIds.length, ingested };
}

/** Título de la publicación, para que el hilo no se llame "MLA3567114684". */
async function itemTitle(
  itemId: string,
  auth: Record<string, string>,
): Promise<string> {
  try {
    const r = await fetch(`${ML}/items/${itemId}?attributes=title`, {
      headers: auth,
    });
    if (!r.ok) return "";
    return String(((await r.json()) as { title?: string }).title ?? "");
  } catch {
    return "";
  }
}

/**
 * Las estrellas primero y en crudo (★★★★★), porque es lo que el comercio mira
 * antes de leer nada. Luego el título de la opinión y el cuerpo.
 */
function formatReview(rev: MlReview): string {
  const rate = Math.max(0, Math.min(5, Math.round(Number(rev.rate) || 0)));
  const stars = "★".repeat(rate) + "☆".repeat(5 - rate);
  const head = rev.title?.trim() ? `${stars}  ${rev.title.trim()}` : stars;
  const body = rev.content?.trim() ?? "";
  return body ? `${head}\n${body}` : head;
}

interface MlReview {
  id?: number | string;
  title?: string;
  content?: string;
  rate?: number;
  date_created?: string;
}
