import type { SupabaseClient } from "@supabase/supabase-js";
import type { ChannelConnection, MessageAttachment } from "@/types";
import type { InboundEvent } from "../types";
import { supabaseAdmin } from "../admin-client";
import { ingestInboundEvent } from "../inbox-writer";
import { getFreshMLToken, resolveMlNickname } from "./adapter";
import { ingestRawMedia } from "../media-ingest";
import { getLogger } from "@/lib/log/logger";

const ML = "https://api.mercadolibre.com";
const log = getLogger("channels.mercadolibre.claims");

/** Reclamos abiertos que se piden por corrida. */
const OPEN_PAGE = 50;
/**
 * Reclamos CERRADOS recientes que se revisan por corrida.
 *
 * Hacen falta por dos motivos: un reclamo puede abrirse y cerrarse entre dos
 * corridas —y entonces la búsqueda de abiertos no lo ve nunca—, y un reclamo
 * que ya estaba guardado como abierto sólo se entera de que cerró si alguien
 * vuelve a mirarlo. Medido el 2026-08-28: los dos reclamos que la bandeja
 * mostraba como abiertos estaban cerrados en Mercado Libre desde el día 15.
 */
const CLOSED_PAGE = 20;
/**
 * Hasta dónde hacia atrás se importan los mensajes de un reclamo.
 *
 * El vendedor tiene 81 reclamos cerrados desde 2023: volcarlos enteros en la
 * bandeja no es "sincronizar los reclamos", es enterrar todo lo demás — mismo
 * criterio que el sembrado de opiniones.
 */
const MAX_AGE_DAYS = 60;
/** Tope por adjunto (10 MB), igual que en los mensajes post-venta. */
const ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;

interface MlClaim {
  id?: number | string;
  status?: string;
  stage?: string;
  type?: string;
  resource?: string;
  resource_id?: number | string;
  reason_id?: string;
  date_created?: string;
  last_updated?: string;
  players?: Array<{ role?: string; user_id?: number | string }>;
  resolution?: { reason?: string } | null;
}

interface MlClaimMessage {
  sender_role?: string;
  receiver_role?: string;
  message?: string;
  date_created?: string;
  message_date?: string;
  hash?: string;
  attachments?: Array<{
    filename?: string;
    original_filename?: string;
    type?: string;
    size?: number;
  }>;
}

/**
 * Reclamos de Mercado Libre: el expediente Y la conversación.
 *
 * Un reclamo es lo único del canal que se discutía enteramente fuera de
 * Riverz. Se guardaba la ficha (estado, motivo, reloj) pero no una sola línea
 * de lo que ahí se dijo, así que la respuesta que el vendedor daba desde
 * Mercado Libre —justo la conversación más cara del canal, la que decide si se
 * devuelve la plata— no existía en la bandeja.
 *
 * Ahora los mensajes del reclamo entran como un hilo más (`claim:<id>`), con
 * los del vendedor como salientes, vengan de donde vengan. Es de sólo lectura:
 * el descargo se sigue haciendo en Mercado Libre, y el hilo lo dice.
 *
 * Nunca despiertan al agente (`suppressAutoReply`): en un reclamo hay plata y
 * reputación en juego, y una respuesta automática puede cerrar la mediación en
 * contra.
 */
export async function pollAllMercadoLibreClaims(): Promise<{
  sellers: number;
  claims: number;
  ingested: number;
}> {
  const db = supabaseAdmin();
  const { data } = await db
    .from("channel_connections")
    .select("*")
    .eq("channel", "mercadolibre")
    .in("status", ["connected", "error", "expired"]);
  const conns = (data ?? []) as ChannelConnection[];

  let claims = 0;
  let ingested = 0;
  for (const conn of conns) {
    try {
      const token = await getFreshMLToken(conn);
      const r = await syncClaimsForConnection(db, conn, token);
      claims += r.claims;
      ingested += r.ingested;
    } catch (err) {
      log.warn("ml claims poll failed", {
        connectionId: conn.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return { sellers: conns.length, claims, ingested };
}

/**
 * Un vendedor. Vive aparte de `pollAllMercadoLibreClaims` porque el
 * sincronizador de pedidos ya tiene el token en la mano y llama aquí directo
 * —el webhook de reclamos entra por ahí y no debe esperar al cron.
 */
export async function syncClaimsForConnection(
  db: SupabaseClient,
  conn: ChannelConnection,
  token: string,
): Promise<{ claims: number; ingested: number }> {
  const auth = { Authorization: `Bearer ${token}` };

  // Abiertos + cerrados recientes. Los cerrados van ordenados por fecha
  // descendente (`sort=date_desc`): sin eso Mercado Libre devuelve los de 2023.
  const found = new Map<string, MlClaim>();
  for (const c of await searchClaims(auth, "opened", OPEN_PAGE, false)) {
    const id = String(c.id ?? "");
    if (id) found.set(id, c);
  }
  for (const c of await searchClaims(auth, "closed", CLOSED_PAGE, true)) {
    const id = String(c.id ?? "");
    if (id) found.set(id, c);
  }

  // Lo que teníamos por abierto y ya no aparece entre los abiertos: se pide de
  // a uno. Es la única forma de enterarse de que cerró hace semanas.
  const { data: openRows } = await db
    .from("ml_claims")
    .select("claim_id")
    .eq("workspace_id", conn.workspace_id)
    .neq("status", "closed");
  for (const row of (openRows ?? []) as Array<{ claim_id: string }>) {
    if (found.has(row.claim_id)) continue;
    const c = await fetchClaim(row.claim_id, auth);
    if (c) found.set(row.claim_id, c);
  }
  if (found.size === 0) return { claims: 0, ingested: 0 };

  // Estado previo de cada uno, para saber cuáles cambiaron desde la última vez.
  const ids = [...found.keys()];
  const { data: storedRows } = await db
    .from("ml_claims")
    .select("claim_id, raw")
    .eq("workspace_id", conn.workspace_id)
    .in("claim_id", ids);
  const previous = new Map<string, string>();
  for (const row of (storedRows ?? []) as Array<{
    claim_id: string;
    raw: Record<string, unknown> | null;
  }>) {
    previous.set(row.claim_id, String(row.raw?.last_updated ?? ""));
  }

  const cutoff = Date.now() - MAX_AGE_DAYS * 86_400_000;
  const sellerId = String((conn.config as Record<string, unknown> | null)?.seller_id ?? "");
  let claims = 0;
  let ingested = 0;
  for (const [claimId, claim] of found) {
    // Sólo los reclamos que le hacen AL comercio. `claims/search` devuelve
    // también aquellos en los que el comercio es quien reclama —una compra
    // suya, una cancelación contra el correo— y esos no son atención al
    // cliente. Peor: ahí los roles se invierten, así que sin este filtro los
    // mensajes propios entrarían como si los hubiera escrito un cliente.
    if (ourRole(claim, sellerId) !== "respondent") continue;

    const open = claim.status !== "closed";
    const changed = !previous.has(claimId) || previous.get(claimId) !== String(claim.last_updated ?? "");

    // Los mensajes se releen si el reclamo sigue abierto (ahí es donde puede
    // haber algo nuevo cada minuto) o si Mercado Libre lo tocó desde la última
    // vez. Un reclamo cerrado y quieto no se vuelve a pedir.
    const recent = (Date.parse(claim.date_created ?? "") || 0) > cutoff;
    const messages = recent && (open || changed) ? await readClaimMessages(claimId, auth) : [];
    if (messages.length) {
      ingested += await ingestClaimMessages(db, conn, claim, messages, auth, token);
    }

    const last = messages.length ? messages[messages.length - 1] : null;
    const { error } = await db.from("ml_claims").upsert(
      {
        workspace_id: conn.workspace_id,
        connection_id: conn.id,
        claim_id: claimId,
        resource_id: claim.resource_id != null ? String(claim.resource_id) : null,
        order_id:
          claim.resource === "order" && claim.resource_id ? String(claim.resource_id) : null,
        stage: claim.stage != null ? String(claim.stage) : null,
        status: claim.status != null ? String(claim.status) : null,
        type: claim.type != null ? String(claim.type) : null,
        reason: claim.reason_id != null ? String(claim.reason_id) : null,
        opened_at: claim.date_created != null ? String(claim.date_created) : null,
        ...(last ? { last_message: (last.message ?? "").slice(0, 500) } : {}),
        raw: claim,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "workspace_id,claim_id" },
    );
    if (!error) claims++;

    // Una devolución no se atiende en la bandeja: se decide en /devoluciones,
    // junto a las que abre el agente desde el chat.
    if (claim.type === "returns") await mirrorReturn(db, conn, claim);
  }
  return { claims, ingested };
}

/** Qué papel juega el comercio en este reclamo: quien reclama o quien responde. */
function ourRole(claim: MlClaim, sellerId: string): string | null {
  if (!sellerId) return null;
  const me = claim.players?.find((p) => String(p.user_id ?? "") === sellerId);
  return me?.role ?? null;
}

/**
 * La devolución de Mercado Libre, en la lista de devoluciones de Riverz.
 *
 * Es un ESPEJO: se aprueba, se reembolsa y se manda la etiqueta en Mercado
 * Libre, que es donde la plataforma la tramita. Lo que aporta la fila es que
 * el comercio la vea junto a las que abre el agente por chat, en vez de tener
 * que acordarse de mirar dos sitios.
 */
async function mirrorReturn(
  db: SupabaseClient,
  conn: ChannelConnection,
  claim: MlClaim,
): Promise<void> {
  const claimId = String(claim.id ?? "");
  if (!claimId) return;
  const orderId = claim.resource === "order" && claim.resource_id ? String(claim.resource_id) : null;

  // El pedido espejado, si está: la fila queda enlazada al pedido y no suelta.
  let orderRowId: string | null = null;
  let contactId: string | null = null;
  if (orderId) {
    const { data } = await db
      .from("orders")
      .select("id, contact_id")
      .eq("workspace_id", conn.workspace_id)
      .eq("shop_domain", `mercadolibre:${(conn.config as Record<string, unknown> | null)?.seller_id}`)
      .eq("shopify_order_id", orderId)
      .maybeSingle();
    const row = data as { id?: string; contact_id?: string | null } | null;
    orderRowId = row?.id ?? null;
    contactId = row?.contact_id ?? null;
  }

  await db.from("returns").upsert(
    {
      workspace_id: conn.workspace_id,
      platform: "mercadolibre",
      external_id: claimId,
      external_url: `https://www.mercadolibre.com.ar/reclamos/${claimId}`,
      order_id: orderRowId,
      contact_id: contactId,
      order_number: orderId,
      kind: "devolucion",
      reason: claim.reason_id ?? null,
      // El estado lo manda la plataforma: en Riverz esta fila no se decide.
      status: claim.status === "closed" ? "resuelta" : "abierta",
      resolution: claim.status === "closed" ? (claim.resolution?.reason ?? null) : null,
      created_by: "sync",
      updated_at: new Date().toISOString(),
    },
    { onConflict: "workspace_id,platform,external_id" },
  );
}

/** Reclamos por estado. `sort=date_desc` es el ÚNICO orden que respeta. */
async function searchClaims(
  auth: Record<string, string>,
  status: "opened" | "closed",
  limit: number,
  newestFirst: boolean,
): Promise<MlClaim[]> {
  try {
    const url =
      `${ML}/post-purchase/v1/claims/search?status=${status}&limit=${limit}` +
      (newestFirst ? "&sort=date_desc" : "");
    const r = await fetch(url, { headers: auth });
    if (!r.ok) return [];
    const j = (await r.json()) as { data?: MlClaim[]; results?: MlClaim[] };
    return j.data ?? j.results ?? [];
  } catch {
    return [];
  }
}

async function fetchClaim(
  claimId: string,
  auth: Record<string, string>,
): Promise<MlClaim | null> {
  try {
    const r = await fetch(`${ML}/post-purchase/v1/claims/${claimId}`, { headers: auth });
    if (!r.ok) return null;
    return (await r.json()) as MlClaim;
  } catch {
    return null;
  }
}

/** Los mensajes del reclamo, del más viejo al más nuevo. */
async function readClaimMessages(
  claimId: string,
  auth: Record<string, string>,
): Promise<MlClaimMessage[]> {
  try {
    const r = await fetch(`${ML}/post-purchase/v1/claims/${claimId}/messages`, {
      headers: auth,
    });
    if (!r.ok) return [];
    const j = (await r.json()) as MlClaimMessage[] | { data?: MlClaimMessage[] };
    const list = Array.isArray(j) ? j : (j.data ?? []);
    // Mercado Libre los devuelve en cualquier orden (medido: el del vendedor
    // antes que el del comprador, siendo posterior).
    return [...list].sort((a, b) => msgTime(a) - msgTime(b));
  } catch {
    return [];
  }
}

function msgTime(m: MlClaimMessage): number {
  return Date.parse(m.message_date ?? m.date_created ?? "") || 0;
}

async function ingestClaimMessages(
  db: SupabaseClient,
  conn: ChannelConnection,
  claim: MlClaim,
  messages: MlClaimMessage[],
  auth: Record<string, string>,
  token: string,
): Promise<number> {
  const claimId = String(claim.id ?? "");
  // El "cliente" del hilo es quien reclama. El vendedor es la otra parte, y
  // sus mensajes son salientes los haya escrito Riverz o Mercado Libre.
  const buyerId = String(
    claim.players?.find((p) => p.role === "complainant")?.user_id ?? "",
  );
  if (!claimId || !buyerId) return 0;
  const nickname = await resolveMlNickname(buyerId, auth);

  let n = 0;
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    const attachments = await ingestClaimAttachments({
      attachments: m.attachments,
      claimId,
      token,
      workspaceId: conn.workspace_id,
      externalContactId: buyerId,
      externalMessageId: m.hash ?? `${claimId}-${i}`,
    });
    const event: InboundEvent = {
      channel: "mercadolibre",
      connection: conn,
      externalContactId: buyerId,
      contactName: nickname,
      // El `hash` es estable entre corridas: es el corte que evita duplicar.
      externalMessageId: m.hash ?? `claim:${claimId}:${i}`,
      externalThreadId: `claim:${claimId}`,
      subject: claim.reason_id ? `Reclamo · ${claim.reason_id}` : `Reclamo ${claimId}`,
      text: (m.message ?? "").trim() || (attachments.length ? "" : "[unsupported]"),
      attachments: attachments.length ? attachments : undefined,
      receivedAt: m.message_date ?? m.date_created ?? new Date().toISOString(),
      outbound: m.sender_role === "respondent",
      // Un reclamo NUNCA se contesta solo: se juega plata y reputación, y la
      // respuesta hay que darla en Mercado Libre igual.
      suppressAutoReply: true,
      raw: m,
    };
    if (await ingestInboundEvent(db, event)) n++;
  }
  return n;
}

/**
 * Fotos y comprobantes del reclamo. Mercado Libre no publica una URL: el
 * archivo se pide con el token del vendedor y `/download` al final —sin eso
 * devuelve la ficha del adjunto en JSON, no el archivo. Best-effort: uno que
 * falla no impide que el mensaje entre.
 */
async function ingestClaimAttachments(args: {
  attachments?: MlClaimMessage["attachments"];
  claimId: string;
  token: string;
  workspaceId: string;
  externalContactId: string;
  externalMessageId: string;
}): Promise<MessageAttachment[]> {
  const list = args.attachments ?? [];
  const out: MessageAttachment[] = [];
  for (let i = 0; i < list.length; i++) {
    const a = list[i];
    const name = a.filename?.trim();
    if (!name) continue;
    if (a.size && a.size > ATTACHMENT_MAX_BYTES) continue;
    try {
      const r = await fetch(
        `${ML}/post-purchase/v1/claims/${args.claimId}/attachments/${encodeURIComponent(name)}/download`,
        { headers: { Authorization: `Bearer ${args.token}` } },
      );
      if (!r.ok) continue;
      const buffer = Buffer.from(await r.arrayBuffer());
      if (!buffer.length || buffer.length > ATTACHMENT_MAX_BYTES) continue;
      const ingested = await ingestRawMedia({
        buffer,
        mime: a.type || r.headers.get("content-type") || "application/octet-stream",
        workspaceId: args.workspaceId,
        conversationId: args.externalContactId,
        id: `${args.externalMessageId}-${i}`,
        fileName: a.original_filename || name,
      });
      if (!ingested) continue;
      out.push({
        url: ingested.url,
        mime_type: ingested.mediaMime,
        size: ingested.mediaSize,
        name: a.original_filename || name,
      });
    } catch (err) {
      log.warn("adjunto de reclamo no descargado", {
        claimId: args.claimId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return out;
}
