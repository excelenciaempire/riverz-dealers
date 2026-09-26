import type { SupabaseClient } from "@supabase/supabase-js";
import { listConnections } from "../connections";
import type { ChannelConnection, MessageAttachment } from "@/types";
import type { InboundEvent } from "../types";
import { supabaseAdmin } from "../admin-client";
import { ingestInboundEvent } from "../inbox-writer";
import { getFreshMLToken, resolveMlNickname } from "./adapter";
import { mercadoLibreWebOrigin } from "./sites";
import { isMlRateLimit, throwIfRateLimited } from "./rate-limit";
import { ingestRawMedia } from "../media-ingest";
import { htmlToText } from "../html-to-text";
import { getLogger } from "@/lib/log/logger";
import {
  mercadoLibreFailure,
  type MercadoLibreSyncFailure,
} from "./sync-result";
import {
  DEFAULT_CONNECTION_CONCURRENCY,
  forEachWithConcurrency,
} from "@/lib/async/concurrency";

const ML = "https://api.mercadolibre.com";
const log = getLogger("channels.mercadolibre.claims");

/** Máximo permitido por Mercado Libre en la búsqueda de reclamos. */
const CLAIMS_PAGE = 100;
/** Defensa ante una cuenta anómala; la API no permite offset + limit >= 10.000. */
export const MAX_CLAIMS = 9_900;
/**
 * Ventana del sondeo en vivo para enterarse de los reclamos cerrados que
 * cambiaron. NO es un corte de la historia: antes lo era —los mensajes de un
 * reclamo abierto hace más de 60 días no se leían nunca, aunque siguiera
 * abierto— y los cerrados más viejos no existían en la bandeja. La historia la
 * recorre ahora, de a poco, la importación histórica (`history.ts`).
 */
const LIVE_CLOSED_WINDOW_DAYS = 60;
/**
 * Lecturas de mensajes por corrida del sondeo en vivo. Lo que no entra queda
 * sin guardar y, por lo tanto, "cambiado": la corrida siguiente lo retoma.
 */
const MAX_MESSAGE_READS_PER_RUN = 40;
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
  resolution?: { reason?: string; date_created?: string } | null;
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
 * El estado del expediente manda sobre el hilo que lo representa.
 *
 * Mercado Libre no crea un mensaje cuando el vendedor resuelve un reclamo
 * mediante una acción (por ejemplo, reembolsar). Si sólo importamos mensajes,
 * Riverz deja el hilo abierto y parece que nadie respondió, aunque el reclamo
 * ya esté cerrado. Además, el compositor sigue disponible y el siguiente
 * envío termina rechazado por Mercado Libre.
 */
export async function closeResolvedClaimConversation(
  db: SupabaseClient,
  conn: Pick<ChannelConnection, "id" | "workspace_id">,
  claim: MlClaim,
): Promise<void> {
  if (claim.status !== "closed" || claim.id == null) return;

  const claimId = String(claim.id);
  const closedAt =
    claim.resolution?.date_created ??
    claim.last_updated ??
    new Date().toISOString();
  const { error } = await db
    .from("conversations")
    .update({ status: "closed", closed_at: closedAt })
    .eq("workspace_id", conn.workspace_id)
    .eq("connection_id", conn.id)
    .eq("thread_external_id", `claim:${claimId}`)
    .neq("status", "closed");
  if (error) {
    throw new Error(`claim conversation close ${claimId}: ${error.message}`);
  }
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
  failures: MercadoLibreSyncFailure[];
}> {
  const db = supabaseAdmin();
  const conns = await listConnections(db, { channel: "mercadolibre" });

  let claims = 0;
  let ingested = 0;
  const failures: MercadoLibreSyncFailure[] = [];
  await forEachWithConcurrency(
    conns,
    DEFAULT_CONNECTION_CONCURRENCY,
    async (conn) => {
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
        failures.push(mercadoLibreFailure(conn.id, err));
      }
    },
  );
  return { sellers: conns.length, claims, ingested, failures };
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
  const sellerId = String(
    (conn.config as Record<string, unknown> | null)?.seller_id ?? "",
  );
  if (!sellerId) throw new Error("conexión sin seller_id");
  const cutoff = Date.now() - LIVE_CLOSED_WINDOW_DAYS * 86_400_000;

  // Todos los abiertos + todos los cerrados que cambiaron dentro de la ventana.
  // Se acota por vendedor y rol, como exige la API actual; buscar sólo por
  // status escanea reclamos ajenos al caso y termina rate-limited.
  const found = new Map<string, MlClaim>();
  for (const c of await searchClaims(auth, sellerId, "opened")) {
    const id = String(c.id ?? "");
    if (id) found.set(id, c);
  }
  for (const c of await searchClaims(
    auth,
    sellerId,
    "closed",
    new Date(cutoff),
  )) {
    const id = String(c.id ?? "");
    if (id) found.set(id, c);
  }

  // Lo que teníamos por abierto y ya no aparece entre los abiertos: se pide de
  // a uno. Es la única forma de enterarse de que cerró hace semanas.
  const { data: openRows, error: openRowsError } = await db
    .from("ml_claims")
    .select("claim_id")
    .eq("workspace_id", conn.workspace_id)
    .eq("connection_id", conn.id)
    .neq("status", "closed");
  if (openRowsError)
    throw new Error(`ml_claims open: ${openRowsError.message}`);
  for (const row of (openRows ?? []) as Array<{ claim_id: string }>) {
    if (found.has(row.claim_id)) continue;
    const c = await fetchClaim(row.claim_id, auth);
    if (c) found.set(row.claim_id, c);
  }
  if (found.size === 0) return { claims: 0, ingested: 0 };

  // Estado previo de cada uno, para saber cuáles cambiaron desde la última vez.
  const previous = await storedClaims(db, conn, [...found.keys()]);

  // Los abiertos primero: si el tope de lecturas corta, que corte en los
  // cerrados, que pueden esperar a la corrida siguiente.
  const ordered = [...found].sort(
    ([, a], [, b]) =>
      Number(a.status === "closed") - Number(b.status === "closed"),
  );

  let claims = 0;
  let ingested = 0;
  let reads = 0;
  for (const [claimId, claim] of ordered) {
    // Sólo los reclamos que le hacen AL comercio. `claims/search` devuelve
    // también aquellos en los que el comercio es quien reclama —una compra
    // suya, una cancelación contra el correo— y esos no son atención al
    // cliente. Peor: ahí los roles se invierten, así que sin este filtro los
    // mensajes propios entrarían como si los hubiera escrito un cliente.
    if (ourRole(claim, sellerId) !== "respondent") continue;

    const open = claim.status !== "closed";
    const stored = previous.get(claimId);
    const changed =
      !stored || stored.lastUpdated !== String(claim.last_updated ?? "");

    // Los mensajes se releen si el reclamo sigue abierto (ahí es donde puede
    // haber algo nuevo cada minuto) o si Mercado Libre lo tocó desde la última
    // vez. Un reclamo cerrado y quieto no se vuelve a pedir. Ya no se mira la
    // antigüedad del reclamo: uno abierto hace más de 60 días que sigue en
    // mediación también habla.
    const readMessages = open || changed;
    // Pasado el tope, ni se lee ni se guarda: al no guardarse sigue figurando
    // como cambiado y la corrida siguiente lo retoma.
    if (readMessages && reads >= MAX_MESSAGE_READS_PER_RUN) continue;
    if (readMessages) reads++;
    ingested += await processClaim(db, conn, claim, {
      auth,
      token,
      readMessages,
      // Un reclamo cerrado que se ve por primera vez es historia: no hay nada
      // que atender y no tiene por qué sumar no leídos.
      historical: !open && !stored,
    });
    claims++;
  }
  return { claims, ingested };
}

/**
 * Una página de la historia de reclamos cerrados, para la importación
 * histórica. Cada reclamo va en su propio try/catch: uno roto se saltea y la
 * página sigue. Un 429 corta ahí mismo y `consumed` dice hasta dónde se llegó,
 * para que el cursor no pase por encima de lo que no se leyó.
 */
export async function backfillClaimsPage(
  db: SupabaseClient,
  conn: ChannelConnection,
  token: string,
  args: {
    offset: number;
    limit: number;
    /** Sólo reclamos que cambiaron después de esta fecha. */
    since: Date;
    deadline: number;
  },
): Promise<{
  consumed: number;
  pageLength: number;
  total?: number;
  ingested: number;
  errors: number;
  lastError?: string;
  rateLimited: boolean;
}> {
  const auth = { Authorization: `Bearer ${token}` };
  const sellerId = String(
    (conn.config as Record<string, unknown> | null)?.seller_id ?? "",
  );
  if (!sellerId) throw new Error("conexión sin seller_id");

  const page = await searchClaimsPage(auth, sellerId, "closed", {
    offset: args.offset,
    limit: args.limit,
    updatedAfter: args.since,
  });
  const previous = await storedClaims(
    db,
    conn,
    page.claims.map((c) => String(c.id ?? "")).filter(Boolean),
  );

  let consumed = 0;
  let ingested = 0;
  let errors = 0;
  let lastError: string | undefined;
  let rateLimited = false;
  for (const claim of page.claims) {
    if (Date.now() > args.deadline) break;
    const claimId = String(claim.id ?? "");
    try {
      if (claimId && ourRole(claim, sellerId) === "respondent") {
        const stored = previous.get(claimId);
        // Además de lo nuevo o cambiado, lo guardado sin un solo mensaje: el
        // sondeo anterior guardaba la ficha de los reclamos de más de 60 días
        // sin leer lo que se habló en ellos.
        const readMessages =
          !stored ||
          stored.lastUpdated !== String(claim.last_updated ?? "") ||
          !stored.hasMessages;
        ingested += await processClaim(db, conn, claim, {
          auth,
          token,
          readMessages,
          historical: claim.status === "closed",
        });
      }
    } catch (err) {
      if (isMlRateLimit(err)) {
        rateLimited = true;
        break;
      }
      errors++;
      lastError = err instanceof Error ? err.message : String(err);
      log.warn("reclamo histórico salteado", {
        connectionId: conn.id,
        claimId,
        error: lastError,
      });
    }
    consumed++;
  }
  return {
    consumed,
    pageLength: page.claims.length,
    total: page.total,
    ingested,
    errors,
    lastError,
    rateLimited,
  };
}

/** Lo guardado de estos reclamos: cuándo los tocó Mercado Libre por última vez
 *  y si alguna vez se leyó un mensaje de ellos. */
async function storedClaims(
  db: SupabaseClient,
  conn: ChannelConnection,
  ids: string[],
): Promise<Map<string, { lastUpdated: string; hasMessages: boolean }>> {
  const out = new Map<string, { lastUpdated: string; hasMessages: boolean }>();
  if (!ids.length) return out;
  const { data, error } = await db
    .from("ml_claims")
    .select("claim_id, raw, last_message")
    .eq("workspace_id", conn.workspace_id)
    .eq("connection_id", conn.id)
    .in("claim_id", ids);
  if (error) throw new Error(`ml_claims stored: ${error.message}`);
  for (const row of (data ?? []) as Array<{
    claim_id: string;
    raw: Record<string, unknown> | null;
    last_message: string | null;
  }>) {
    out.set(row.claim_id, {
      lastUpdated: String(row.raw?.last_updated ?? ""),
      hasMessages: Boolean(row.last_message),
    });
  }
  return out;
}

/**
 * Un reclamo: sus mensajes (si toca leerlos), la ficha en `ml_claims`, el
 * cierre del hilo si Mercado Libre ya lo resolvió y el espejo de la devolución.
 * Devuelve cuántos mensajes nuevos entraron.
 */
async function processClaim(
  db: SupabaseClient,
  conn: ChannelConnection,
  claim: MlClaim,
  opts: {
    auth: Record<string, string>;
    token: string;
    readMessages: boolean;
    historical: boolean;
  },
): Promise<number> {
  const claimId = String(claim.id ?? "");
  const messages = opts.readMessages
    ? await readClaimMessages(claimId, opts.auth)
    : [];
  const ingested = messages.length
    ? await ingestClaimMessages(
        db,
        conn,
        claim,
        messages,
        opts.auth,
        opts.token,
        opts.historical,
      )
    : 0;

  const last = messages.length ? messages[messages.length - 1] : null;
  const { error } = await db.from("ml_claims").upsert(
    {
      workspace_id: conn.workspace_id,
      connection_id: conn.id,
      claim_id: claimId,
      resource_id: claim.resource_id != null ? String(claim.resource_id) : null,
      order_id:
        claim.resource === "order" && claim.resource_id
          ? String(claim.resource_id)
          : null,
      stage: claim.stage != null ? String(claim.stage) : null,
      status: claim.status != null ? String(claim.status) : null,
      type: claim.type != null ? String(claim.type) : null,
      reason: claim.reason_id != null ? String(claim.reason_id) : null,
      opened_at: claim.date_created != null ? String(claim.date_created) : null,
      ...(last
        ? { last_message: claimMessageBody(last.message).text.slice(0, 500) }
        : {}),
      raw: claim,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "workspace_id,claim_id" },
  );
  if (error) throw new Error(`ml_claims upsert ${claimId}: ${error.message}`);
  await closeResolvedClaimConversation(db, conn, claim);

  // Una devolución no se atiende en la bandeja: se decide en /devoluciones,
  // junto a las que abre el agente desde el chat.
  if (claim.type === "returns") await mirrorReturn(db, conn, claim);
  return ingested;
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
  const orderId =
    claim.resource === "order" && claim.resource_id
      ? String(claim.resource_id)
      : null;

  // El pedido espejado, si está: la fila queda enlazada al pedido y no suelta.
  let orderRowId: string | null = null;
  let contactId: string | null = null;
  if (orderId) {
    const { data } = await db
      .from("orders")
      .select("id, contact_id")
      .eq("workspace_id", conn.workspace_id)
      .eq(
        "shop_domain",
        `mercadolibre:${(conn.config as Record<string, unknown> | null)?.seller_id}`,
      )
      .eq("shopify_order_id", orderId)
      .maybeSingle();
    const row = data as { id?: string; contact_id?: string | null } | null;
    orderRowId = row?.id ?? null;
    contactId = row?.contact_id ?? null;
  }

  const { error } = await db.from("returns").upsert(
    {
      workspace_id: conn.workspace_id,
      platform: "mercadolibre",
      external_id: claimId,
      external_url: `${mercadoLibreWebOrigin((conn.config as Record<string, unknown> | null)?.site_id)}/reclamos/${claimId}`,
      order_id: orderRowId,
      contact_id: contactId,
      order_number: orderId,
      kind: "devolucion",
      reason: claim.reason_id ?? null,
      // El estado lo manda la plataforma: en Riverz esta fila no se decide.
      status: claim.status === "closed" ? "resuelta" : "abierta",
      resolution:
        claim.status === "closed" ? (claim.resolution?.reason ?? null) : null,
      created_by: "sync",
      updated_at: new Date().toISOString(),
    },
    { onConflict: "workspace_id,platform,external_id" },
  );
  if (error) throw new Error(`returns upsert ${claimId}: ${error.message}`);
}

/** Reclamos por estado. `sort=date_desc` es el ÚNICO orden que respeta. */
async function searchClaims(
  auth: Record<string, string>,
  sellerId: string,
  status: "opened" | "closed",
  updatedAfter?: Date,
): Promise<MlClaim[]> {
  const out: MlClaim[] = [];
  for (let offset = 0; offset < MAX_CLAIMS; offset += CLAIMS_PAGE) {
    const page = await searchClaimsPage(auth, sellerId, status, {
      offset,
      limit: CLAIMS_PAGE,
      updatedAfter,
    });
    out.push(...page.claims);
    if (page.claims.length < CLAIMS_PAGE || out.length >= Number(page.total ?? 0))
      break;
  }
  return out;
}

/** Una página de la búsqueda de reclamos del comercio. */
async function searchClaimsPage(
  auth: Record<string, string>,
  sellerId: string,
  status: "opened" | "closed",
  opts: { offset: number; limit: number; updatedAfter?: Date },
): Promise<{ claims: MlClaim[]; total?: number }> {
  const params = new URLSearchParams({
    "players.user_id": sellerId,
    "players.role": "respondent",
    status,
    limit: String(opts.limit),
    offset: String(opts.offset),
    sort: "date_created:desc",
  });
  if (opts.updatedAfter) {
    params.set("range", `last_updated:after:${mlClaimDate(opts.updatedAfter)}`);
  }
  const r = await fetch(`${ML}/post-purchase/v1/claims/search?${params}`, {
    headers: auth,
  });
  throwIfRateLimited(r, `claims/search ${status}`);
  if (!r.ok) throw new Error(`claims/search ${status} HTTP ${r.status}`);
  const j = (await r.json()) as {
    data?: MlClaim[];
    results?: MlClaim[];
    paging?: { total?: number };
  };
  const total = Number(j.paging?.total);
  return {
    claims: j.data ?? j.results ?? [],
    total: Number.isFinite(total) ? total : undefined,
  };
}

function mlClaimDate(date: Date): string {
  return date.toISOString().replace("Z", "+00:00");
}

async function fetchClaim(
  claimId: string,
  auth: Record<string, string>,
): Promise<MlClaim | null> {
  const r = await fetch(`${ML}/post-purchase/v1/claims/${claimId}`, {
    headers: auth,
  });
  if (r.status === 404) return null;
  throwIfRateLimited(r, `claims/${claimId}`);
  if (!r.ok) throw new Error(`claims/${claimId} HTTP ${r.status}`);
  return (await r.json()) as MlClaim;
}

/** Los mensajes del reclamo, del más viejo al más nuevo. */
async function readClaimMessages(
  claimId: string,
  auth: Record<string, string>,
): Promise<MlClaimMessage[]> {
  const r = await fetch(`${ML}/post-purchase/v1/claims/${claimId}/messages`, {
    headers: auth,
  });
  throwIfRateLimited(r, `claims/${claimId}/messages`);
  if (!r.ok) throw new Error(`claims/${claimId}/messages HTTP ${r.status}`);
  const j = (await r.json()) as MlClaimMessage[] | { data?: MlClaimMessage[] };
  const list = Array.isArray(j) ? j : (j.data ?? []);
  // Mercado Libre los devuelve en cualquier orden (medido: el del vendedor
  // antes que el del comprador, siendo posterior).
  return [...list].sort((a, b) => msgTime(a) - msgTime(b));
}

function msgTime(m: MlClaimMessage): number {
  return Date.parse(m.message_date ?? m.date_created ?? "") || 0;
}

/** Una etiqueta de párrafo o de formato: separa el HTML del editor de Mercado
 *  Libre de un texto con un "<" suelto ("<3", "menos de <100"). */
const MARKUP = /<\/?(?:p|br|div|span|b|strong|i|em|u|a|ul|ol|li)\b[^>]*>/i;
/** La portada de un sitio: el enlace de una firma, que no aporta destino. */
const SITE_HOME = /^https?:\/\/[^/?#]+\/?(?:[?#].*)?$/i;

/**
 * El cuerpo de un mensaje del reclamo, listo para la bandeja.
 *
 * Lo que escribe el equipo de Mercado Libre llega en el HTML de su editor
 * (`<p>`, `<span style=…>`, `&oacute;`). Guardado tal cual, la burbuja mostraba
 * las etiquetas en vez del mensaje. Se guarda el texto —el HTML original queda
 * en `html_body`, como en un correo— y cada enlace deja su destino entre
 * paréntesis, porque "este instructivo" no dice adónde lleva. Lo que escriben
 * comprador y vendedor ya es texto y pasa igual.
 */
export function claimMessageBody(message: string | undefined): {
  text: string;
  html?: string;
} {
  const raw = (message ?? "").trim();
  if (!MARKUP.test(raw)) return { text: raw };
  const withTargets = raw.replace(
    /<a\b[^>]*?\bhref\s*=\s*(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a>/gi,
    (_link, _quote, href: string, label: string) => {
      const url = href.trim();
      const addsTarget =
        /^https?:\/\//i.test(url) &&
        !SITE_HOME.test(url) &&
        !label.includes(url.replace(/^https?:\/\//i, ""));
      return addsTarget ? `${label} (${url})` : label;
    },
  );
  return { text: htmlToText(withTargets), html: raw };
}

async function ingestClaimMessages(
  db: SupabaseClient,
  conn: ChannelConnection,
  claim: MlClaim,
  messages: MlClaimMessage[],
  auth: Record<string, string>,
  token: string,
  /** Reclamo ya cerrado que se importa por primera vez: rellena el hilo sin
   *  sumar no leídos. */
  historical = false,
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
    const body = claimMessageBody(m.message);
    const event: InboundEvent = {
      channel: "mercadolibre",
      connection: conn,
      externalContactId: buyerId,
      contactName: nickname,
      // El `hash` es estable entre corridas: es el corte que evita duplicar.
      externalMessageId: m.hash ?? `claim:${claimId}:${i}`,
      externalThreadId: `claim:${claimId}`,
      subject: claim.reason_id
        ? `Reclamo · ${claim.reason_id}`
        : `Reclamo ${claimId}`,
      text: body.text || (attachments.length ? "" : "[unsupported]"),
      htmlBody: body.html,
      attachments: attachments.length ? attachments : undefined,
      receivedAt: m.message_date ?? m.date_created ?? new Date().toISOString(),
      outbound: m.sender_role === "respondent",
      // Un reclamo NUNCA se contesta solo: se juega plata y reputación, y la
      // respuesta hay que darla en Mercado Libre igual.
      suppressAutoReply: true,
      ...(historical ? { historical: true } : {}),
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
      // Sin cuota se corta el reclamo entero: el mensaje se guarda una sola
      // vez y entraría para siempre sin su comprobante.
      throwIfRateLimited(r, "claims/attachments");
      if (!r.ok) continue;
      const buffer = Buffer.from(await r.arrayBuffer());
      if (!buffer.length || buffer.length > ATTACHMENT_MAX_BYTES) continue;
      const ingested = await ingestRawMedia({
        buffer,
        mime:
          a.type || r.headers.get("content-type") || "application/octet-stream",
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
      if (isMlRateLimit(err)) throw err;
      log.warn("adjunto de reclamo no descargado", {
        claimId: args.claimId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return out;
}
