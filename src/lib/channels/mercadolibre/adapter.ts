import type { ChannelAdapter, InboundEvent, OutboundMedia, OutboundText, ParsedWebhookContext, SendResult } from "../types";
import type { ChannelConnection, MessageAttachment } from "@/types";
import { decrypt, encrypt } from "../encryption";
import { supabaseAdmin } from "../admin-client";
import { captureWebhookFailure } from "@/lib/webhooks/capture";
import { getLogger } from "@/lib/log/logger";
import { attachmentFilename, fetchAttachmentBytes, ingestRawMedia } from "../media-ingest";
import { safeLocale } from "@/lib/i18n/server";
import { translate } from "@/lib/i18n/translate";
import type { Locale } from "@/lib/i18n/config";
import { isInactiveMLAccountError } from './account-health';
import { mercadoLibreAppFor } from "./apps";
import { isMlRateLimit, throwIfRateLimited } from "./rate-limit";

/**
 * MercadoLibre — pre-sale QUESTIONS + post-sale MESSAGES in the unified inbox.
 *
 * Reply-only + resource-scoped (no free DM): the conversation's
 * thread_external_id encodes the target — `q:<question_id>` (answer a question)
 * or `pack:<pack_id>` (post-sale message pack) — so sendText picks the right ML
 * endpoint. Inbound arrives via app-level notifications (topic + resource path,
 * NO body) so parseWebhook must RE-FETCH the resource with a fresh seller token;
 * a poll cron reconciles anything a momentarily-dead token dropped.
 *
 * config:  { seller_id, site_id, token_expires_at, app_id }
 * secrets: { access_token, refresh_token }  (both encrypted; refresh rotates)
 */

const ML = "https://api.mercadolibre.com";
const log = getLogger("channels.mercadolibre");

export function handlesMLNotification(topic: string): boolean {
  return ['questions', 'marketplace_questions', 'marketplace_messages', 'orders_v2', 'shipments', 'post_purchase'].includes(topic)
    || topic.startsWith('messages') || topic.startsWith('post_purchase.claims');
}

/**
 * Mercado Libre documenta dos nombres distintos para el mismo campo según la
 * versión del recurso de reclamos: `filename` y `file_name`. Aceptamos ambos
 * para no convertir una carga 2xx en un falso "sin id".
 */
export function claimAttachmentName(uploaded: unknown): string | undefined {
  if (!uploaded || typeof uploaded !== "object") return undefined;
  const value = uploaded as Record<string, unknown>;
  for (const key of ["filename", "file_name", "id"] as const) {
    const candidate = value[key];
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
  }
  return undefined;
}

interface MlNotification {
  resource?: string; // e.g. "/questions/123" or "/messages/packs/456/sellers/789"
  user_id?: number | string;
  topic?: string; // questions | messages | orders_v2 | ...
  application_id?: number | string;
}

export const mercadoLibreAdapter: ChannelAdapter = {
  channel: "mercadolibre",
  label: "Mercado Libre",

  isConfigured(connection: ChannelConnection): boolean {
    const cfg = (connection.config ?? {}) as Record<string, unknown>;
    return Boolean(cfg.seller_id) && Boolean(connection.secrets);
  },

  async sendText(input: OutboundText): Promise<SendResult> {
    const token = await getFreshMLToken(input.connection);
    const cfg = (input.connection.config ?? {}) as Record<string, unknown>;
    const sellerId = String(cfg.seller_id ?? "");

    // Target resource: prefer the reply-to (last inbound id), else the
    // conversation thread. Both are "q:<id>" or "pack:<id>".
    const target = input.replyToExternalId?.startsWith("q:") ? input.replyToExternalId : ((input.conversation as { thread_external_id?: string })?.thread_external_id ?? input.replyToExternalId ?? "");

    if (target.startsWith("q:")) {
      // Answer a pre-sale question (one-shot, max 2000 chars).
      const questionId = target.slice(2);
      const res = await fetch(`${ML}/answers`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          question_id: Number(questionId),
          text: input.text.slice(0, 2000),
        }),
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        throw new Error(`[mercadolibre] answer failed (${res.status}): ${detail}`);
      }
      // Guardamos el id saliente como a:<question_id> (NO el id que devuelve
      // POST /answers) para que coincida EXACTO con el evento que emite el
      // webhook cuando la pregunta pasa a ANSWERED — así la respuesta enviada
      // desde Riverz se deduplica y no se duplica con la del webhook.
      await res.json().catch(() => ({}));
      return { externalMessageId: `a:${questionId}`, status: "sent" };
    }

    if (target.startsWith("pack:")) {
      // Post-sale message. Seller text is capped at 350 chars, ISO-8859-1
      // charset (drop chars outside latin1 so emojis don't 400 the send).
      const packId = target.slice(5);
      const buyerId = input.contact.external_id;
      if (!buyerId) throw new Error("[mercadolibre] pack reply missing buyer id");
      const text = [...input.text]
        .filter((c) => (c.codePointAt(0) ?? 0) <= 0xff)
        .join("")
        .slice(0, 350);
      const res = await fetch(`${ML}/messages/packs/${packId}/sellers/${sellerId}?tag=post_sale`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          from: { user_id: sellerId },
          to: { user_id: buyerId },
          text,
        }),
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        throw new Error(`[mercadolibre] message failed (${res.status}): ${detail}`);
      }
      // El id que devuelve el POST NO siempre coincide con el id que luego emite
      // el webhook `messages` para ESTE mismo mensaje → el eco entraría como una
      // fila nueva y el mensaje se DUPLICARÍA en el hilo. Releemos el pack y
      // tomamos el id del mensaje del vendedor más reciente que coincide con lo
      // enviado: ese es el id que usará el webhook, así el dedup global por
      // message_id (inbox-writer) lo reconoce. Fallback al id del POST si falla.
      const posted = (await res.json().catch(() => ({}))) as { id?: string };
      let externalId = posted.id;
      try {
        const packRes = await fetch(
          // Sin `tag=post_sale` esto es un 404 y el catch de abajo lo tapa: se
          // caía siempre al id del POST, que es justo el que NO coincide con el
          // del webhook. Es decir, la protección contra duplicados nunca actuó.
          `${ML}/messages/packs/${packId}/sellers/${sellerId}?tag=post_sale&mark_as_read=false`,
          { headers: { authorization: `Bearer ${token}` } }
        );
        if (packRes.ok) {
          const pack = (await packRes.json()) as MlPack;
          const sellerMsgs = (pack.messages ?? []).filter((m) => String(m.from?.user_id ?? "") === sellerId && Boolean(m.id));
          const matching = sellerMsgs.filter((m) => (m.text ?? "") === text);
          const pool = matching.length ? matching : sellerMsgs;
          let newest: (typeof pool)[number] | undefined;
          for (const m of pool) {
            const tb = Date.parse(m.message_date?.created ?? "") || 0;
            const ta = newest ? Date.parse(newest.message_date?.created ?? "") || 0 : -1;
            if (tb >= ta) newest = m;
          }
          if (newest?.id) externalId = newest.id;
        }
      } catch {
        /* keep posted.id */
      }
      return { externalMessageId: externalId ?? undefined, status: "sent" };
    }

    if (target.startsWith("claim:")) {
      // Descargo dentro de la mediación. Mercado Libre sólo lo acepta mientras
      // el reclamo está abierto; cerrado devuelve 4xx y su motivo se muestra
      // tal cual, que es más útil que un "no se pudo enviar".
      const claimId = target.slice(6);
      const res = await fetch(`${ML}/post-purchase/v1/claims/${claimId}/actions/send-message`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          receiver_role: "complainant",
          message: input.text.slice(0, 2000),
        }),
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        throw new Error(`[mercadolibre] claim message failed (${res.status}): ${detail}`);
      }
      await res.json().catch(() => ({}));
      return {
        externalMessageId: await newestClaimMessageHash(claimId, token),
        status: "sent",
      };
    }

    throw new Error("[mercadolibre] no resolvable target (question/pack/claim) for this reply");
  },

  /**
   * Responder un mensaje post-venta con un archivo. Mercado Libre no acepta
   * una URL: hay que subir el archivo a su endpoint de adjuntos y mandar el
   * id que devuelve junto al texto. Las preguntas de publicación (`q:`) son
   * sólo texto — lo avisamos claro.
   */
  async sendMedia(input: OutboundMedia): Promise<SendResult> {
    const locale = await safeLocale();
    const token = await getFreshMLToken(input.connection);
    const cfg = (input.connection.config ?? {}) as Record<string, unknown>;
    const sellerId = String(cfg.seller_id ?? "");
    const siteId = String(cfg.site_id ?? "");

    const target = (input.conversation as { thread_external_id?: string })?.thread_external_id ?? input.replyToExternalId ?? "";
    // La mediación tiene su propio almacén de adjuntos: la foto se sube al
    // expediente del reclamo y viaja con el descargo. Es justo donde más falta
    // hace —el comprobante de despacho es la prueba del vendedor.
    if (target.startsWith("claim:")) {
      return sendClaimMedia(target.slice(6), input, token, locale);
    }
    if (!target.startsWith("pack:")) {
      throw new Error(translate(locale, "errInbox.attachmentQuestionUnsupported"));
    }
    const packId = target.slice(5);
    const buyerId = input.contact.external_id;
    if (!buyerId) throw new Error("[mercadolibre] pack reply missing buyer id");

    const file = await fetchAttachmentBytes(input.mediaUrl, input.connection.workspace_id);
    if (!file) throw new Error(translate(locale, "errInbox.attachmentUnreadable"));
    const filename = input.filename || attachmentFilename(input.mediaUrl, file.mime);

    const uploadUrl = new URL(`${ML}/messages/attachments`);
    uploadUrl.searchParams.set("tag", "post_sale");
    if (siteId) uploadUrl.searchParams.set("site_id", siteId);
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(file.buffer)], { type: file.mime }), filename);
    const upRes = await fetch(uploadUrl.toString(), {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
      body: form,
    });
    if (!upRes.ok) {
      const detail = await upRes.text().catch(() => "");
      throw new Error(`[mercadolibre] attachment upload failed (${upRes.status}): ${detail}`);
    }
    const uploaded = (await upRes.json().catch(() => ({}))) as { id?: string };
    if (!uploaded.id) throw new Error("[mercadolibre] attachment upload returned no id");

    // Mismo saneo que el texto: tope de 350 y sólo latin1 (ML rechaza emojis).
    const text = [...(input.caption ?? "")]
      .filter((c) => (c.codePointAt(0) ?? 0) <= 0xff)
      .join("")
      .slice(0, 350);
    const res = await fetch(`${ML}/messages/packs/${packId}/sellers/${sellerId}?tag=post_sale`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        from: { user_id: sellerId },
        to: { user_id: buyerId },
        text,
        attachments: [uploaded.id],
      }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`[mercadolibre] message with attachment failed (${res.status}): ${detail}`);
    }
    const posted = (await res.json().catch(() => ({}))) as { id?: string };
    return { externalMessageId: posted.id ?? undefined, status: "sent" };
  },

  async parseWebhook(ctx: ParsedWebhookContext, connection: ChannelConnection): Promise<InboundEvent[]> {
    const n = ctx.payload as MlNotification | null;
    if (!n?.resource || !n.topic) return [];
    // Unsupported topics need no token. Previously a broken token turned even
    // deliberately ignored notifications into recovery incidents.
    if (!handlesMLNotification(n.topic)) {
      log.info("mercadolibre notification ignored — topic not handled", {
        topic: n.topic, connectionId: connection.id,
      });
      return [];
    }
    const cfg = (connection.config ?? {}) as Record<string, unknown>;
    const sellerId = String(cfg.seller_id ?? "");

    let token: string;
    try {
      token = await getFreshMLToken(connection);
    } catch (err) {
      console.error("[mercadolibre] token unavailable for webhook:", err);
      // El aviso de Mercado Libre NO trae cuerpo: sólo dice "mirá este
      // recurso". Si el token falla acá, la notificación se pierde entera y
      // sólo la recupera el sondeo, hasta cinco minutos después. Queda el
      // rastro para poder distinguir "ML no avisa" de "ML avisó y no pudimos
      // leerlo".
      void captureWebhookFailure({
        provider: "mercadolibre:token",
        rawBody: JSON.stringify(n).slice(0, 4000),
        error: err,
      });
      return [];
    }
    const auth = { authorization: `Bearer ${token}` };

    // ---- Questions ----
    if (n.topic === "questions" || n.topic === "marketplace_questions") {
      const r = await fetch(`${ML}${n.resource}?api_version=4`, {
        headers: auth,
      });
      if (!r.ok) return [];
      const q = (await r.json()) as MlQuestion;
      if (!q.id) return [];
      const qBuyerId = String(q.from?.id ?? q.buyer_id ?? "ml");
      // ML no expone el nombre real (privacidad); usamos el apodo público.
      const buyerName = await resolveMlNickname(qBuyerId, auth);
      const events: InboundEvent[] = [];
      // Pregunta del comprador (entrante) — solo mientras sigue sin responder,
      // para que dispare al agente / aparezca como pendiente una sola vez.
      if (q.status === "UNANSWERED" && q.text) {
        events.push({
          channel: "mercadolibre",
          connection,
          externalContactId: qBuyerId,
          contactName: buyerName,
          externalMessageId: `q:${q.id}`,
          externalThreadId: `q:${q.id}`,
          subject: q.item_id ? `Pregunta · ${q.item_id}` : undefined,
          text: q.text,
          receivedAt: q.date_created ?? new Date().toISOString(),
          raw: q,
        });
      }
      // Respuesta del vendedor (saliente) — INCLUYE las respuestas escritas
      // desde la app de Mercado Libre, no solo las enviadas desde Riverz. Se
      // deduplica por a:<question_id>: lo enviado desde Riverz ya guardó ese id
      // (ver sendText), así que solo sobreviven las respuestas hechas en ML.
      if (q.status === "ANSWERED" && q.answer?.text) {
        // Si la PRIMERA notificación llega con la pregunta ya ANSWERED (el
        // vendedor respondió desde la app de ML antes de que procesáramos el
        // evento UNANSWERED), la pregunta del comprador nunca se ingirió. La
        // emitimos igual, pero HISTÓRICA: se preserva en el hilo sin volver a
        // disparar al agente (ya está resuelta). Idempotente por q:<id> si ya
        // existía del flujo normal.
        if (q.text) {
          events.push({
            channel: "mercadolibre",
            connection,
            externalContactId: qBuyerId,
            contactName: buyerName,
            externalMessageId: `q:${q.id}`,
            externalThreadId: `q:${q.id}`,
            subject: q.item_id ? `Pregunta · ${q.item_id}` : undefined,
            text: q.text,
            receivedAt: q.date_created ?? new Date().toISOString(),
            historical: true,
            raw: q,
          });
        }
        events.push({
          channel: "mercadolibre",
          connection,
          externalContactId: qBuyerId,
          contactName: buyerName,
          externalMessageId: `a:${q.id}`,
          externalThreadId: `q:${q.id}`,
          subject: q.item_id ? `Pregunta · ${q.item_id}` : undefined,
          text: q.answer.text,
          receivedAt: q.answer.date_created ?? q.date_created ?? new Date().toISOString(),
          outbound: true,
          raw: q,
        });
      }
      return events;
    }

    // ---- Post-sale messages ----
    //
    // `messages.created` / `messages.read` son los nombres NUEVOS del mismo
    // tema: es lo que ofrece hoy el panel de Mercado Libre para suscribirse, y
    // el `messages` a secas quedó de las apps viejas. Sin aceptar el prefijo,
    // una aplicación recién creada suscribe el tema correcto y Riverz lo
    // descarta como "tema no atendido" — el canal entero sin mensajes en vivo,
    // y el registro diciendo que todo está bien.
    if (n.topic.startsWith("messages") || n.topic === "marketplace_messages") {
      // The resource may be a pack path or a single message. Normalize to the
      // pack conversation and emit buyer-sent messages only.
      const packId = await resolveNotificationPack(n.resource, sellerId, token);
      return (await buildPackEvents({ connection, packId, sellerId, token })).events;
    }

    // ── Pedidos, envíos y reclamos ──
    //
    // No producen un mensaje en la bandeja: producen un CAMBIO DE ESTADO. Por
    // eso se atienden acá pero devuelven [] — quien los persiste es el
    // sincronizador, que ya sabe normalizar un pedido de ML y traer el envío
    // que le cuelga. El webhook sólo adelanta el reloj: sin él el cambio
    // llegaría en la próxima corrida del cron, hasta 15 minutos después.
    if (n.topic === "orders_v2" || n.topic === "shipments" || n.topic === "post_purchase" || n.topic?.startsWith("post_purchase.claims")) {
      // Import perezoso: orders.ts importa este módulo para el token, así que
      // hacerlo arriba cerraría el ciclo.
      const { syncAllMercadoLibreOrders } = await import("./orders");
      await syncAllMercadoLibreOrders().catch(() => ({}));
      return [];
    }

    // Todo lo demás se descarta — pero se DEJA CONSTANCIA. La aplicación está
    // suscrita a 30 temas y sólo se atienden cinco; un `return []` mudo hace
    // que "no llega tal cosa de Mercado Libre" sea indistinguible de un fallo,
    // que es exactamente lo que volvió invisible el problema de Outlook.
    log.info("mercadolibre notification ignored — topic not handled", {
      topic: n.topic,
      resource: n.resource,
      connectionId: connection.id,
    });
    return [];
  },
};

/**
 * Los mensajes post-venta de UN pack, como eventos de bandeja.
 *
 * Vive fuera de `parseWebhook` porque tiene DOS entradas: la notificación de
 * Mercado Libre y el sondeo (`messages-poll.ts`). La notificación depende de
 * `notifications_callback_url`, que es un solo campo por aplicación y se
 * configura a mano — si apunta a otro lado, los mensajes no llegan y nada avisa.
 * El sondeo no depende de nadie. Que los dos armen el evento con este mismo
 * código es lo que hace que convivan sin duplicar ni divergir; el corte por
 * `externalMessageId` en `ingestInboundEvent` hace el resto.
 *
 * Devuelve además el estado del hilo: el sondeo lo usa para dejar de releer los
 * que Mercado Libre declara cerrados (ver `PackRead.quiet`).
 */
export async function buildPackEvents(args: { connection: ChannelConnection; packId: string; sellerId: string; token: string }): Promise<PackRead> {
  const { connection, packId, sellerId, token } = args;
  const cfg = (connection.config ?? {}) as Record<string, unknown>;
  const auth = { authorization: `Bearer ${token}` };

  // `tag=post_sale` NO es opcional: sin él Mercado Libre responde 404, y el
  // `if (!r.ok) return []` de antes lo tragaba entero. Resultado medido el
  // 2026-08-05: en toda la historia de la base no había un solo mensaje
  // post-venta ingerido, ni por webhook ni por ningún lado, y no había forma de
  // distinguirlo de "este vendedor no recibe mensajes". El envío sí lo mandaba
  // (`sendText`), así que se podía contestar un hilo que nunca se veía entrar.
  const base = `${ML}/messages/packs/${packId}/sellers/${sellerId}?tag=post_sale&mark_as_read=false`;
  const conv = await readPackPage(base, packId, auth);
  // Mercado Libre cierra la mensajería de la mayoría de las ventas: mide el
  // 2026-08-05, 21 de 24 hilos vuelven `blocked` y vacíos, y van a seguir así
  // salvo que el comprador escriba primero. Releerlos cada corrida era casi
  // todo el costo del sondeo.
  const quiet = (conv.messages?.length ?? 0) === 0 && conv.conversation_status?.status === "blocked";

  // El hilo viene PAGINADO: sin `limit` Mercado Libre devuelve sólo la primera
  // página, y lo que quedaba afuera no entraba nunca. Así se veían hilos con
  // los mensajes del comprador y ninguna respuesta del vendedor aunque en
  // Mercado Libre estuviera contestado. La primera página sale sin `limit`
  // (el pedido de siempre, que no cuesta más en el hilo corto, que es casi
  // todos); las siguientes repiten el tamaño que Mercado Libre informa en
  // `paging.limit`, que es el único valor que se sabe que acepta.
  const byId = new Map<string, NonNullable<MlPack["messages"]>[number]>();
  const collect = (page: MlPack) => {
    for (const m of page.messages ?? []) if (m.id) byId.set(m.id, m);
  };
  collect(conv);
  const pageSize = Number(conv.paging?.limit) || conv.messages?.length || 0;
  let offset = Number(conv.paging?.offset) || 0;
  let received = conv.messages?.length ?? 0;
  let total: unknown = conv.paging?.total;
  for (let page = 1; page < MAX_PACK_PAGES; page++) {
    const next = nextPackOffset(offset, received, total);
    if (next === null || !pageSize) break;
    const more = await readPackPage(`${base}&limit=${pageSize}&offset=${next}`, packId, auth);
    collect(more);
    offset = next;
    received = more.messages?.length ?? 0;
    total = more.paging?.total ?? total;
  }
  // Del más viejo al más nuevo: el hilo se crea con el primer mensaje real.
  const messages = [...byId.values()].sort(
    (a, b) => (Date.parse(a.message_date?.created ?? "") || 0) - (Date.parse(b.message_date?.created ?? "") || 0),
  );

  const events: InboundEvent[] = [];
  const nickCache = new Map<string, string | undefined>();
  for (const m of messages) {
    const fromId = String(m.from?.user_id ?? "");
    const toId = String(m.to?.user_id ?? "");
    if (!m.id || !fromId) continue;
    // El "cliente" del hilo es SIEMPRE el comprador. Si el mensaje lo mandó
    // el vendedor (desde Riverz o desde la app de Mercado Libre), el
    // comprador es el destinatario y ese mensaje es SALIENTE. Antes se
    // descartaba todo lo del vendedor, así que sus respuestas escritas
    // desde la app de ML quedaban invisibles en Riverz.
    const isSeller = fromId === sellerId;
    const buyerId = isSeller ? toId : fromId;
    if (!buyerId || buyerId === sellerId) continue;
    if (!nickCache.has(buyerId)) {
      nickCache.set(buyerId, await resolveMlNickname(buyerId, auth));
    }
    // Fotos / archivos adjuntos: se bajan con el token del vendedor y se
    // re-hospedan en Storage. Sin esto, un mensaje que era sólo una foto
    // (un comprobante, una foto del producto) entraba como burbuja vacía.
    const mlAttachments = await ingestMlAttachments({
      attachments: m.message_attachments,
      token,
      siteId: String(cfg.site_id ?? ""),
      workspaceId: connection.workspace_id,
      externalContactId: buyerId,
      externalMessageId: m.id,
    });
    events.push({
      channel: "mercadolibre",
      connection,
      externalContactId: buyerId,
      contactName: nickCache.get(buyerId),
      externalMessageId: m.id,
      externalThreadId: `pack:${packId}`,
      text: m.text?.trim() || (mlAttachments.length ? "" : "[unsupported]"),
      attachments: mlAttachments.length ? mlAttachments : undefined,
      receivedAt: m.message_date?.created ?? new Date().toISOString(),
      // Mensajes del vendedor = salientes (sender_type=agent). Lo enviado
      // desde Riverz se deduplica por m.id (el mismo id que devolvió el POST).
      outbound: isSeller,
      raw: m,
    });
  }
  return { events, quiet };
}

/** Techo de páginas por hilo: un hilo de cientos de mensajes no puede comerse
 *  la cuota de la aplicación en una sola lectura. */
const MAX_PACK_PAGES = 30;

async function readPackPage(url: string, packId: string, auth: Record<string, string>): Promise<MlPack> {
  const r = await fetch(url, { headers: auth });
  throwIfRateLimited(r, `messages/packs/${packId}`);
  if (!r.ok) {
    const body = (await r.text().catch(() => "")).slice(0, 200);
    log.warn("no se pudo leer el hilo post-venta de Mercado Libre", {
      packId,
      status: r.status,
      body,
    });
    throw new Error(`messages/packs/${packId} HTTP ${r.status}${body ? `: ${body}` : ""}`);
  }
  return (await r.json()) as MlPack;
}

/**
 * Desde dónde pedir la página siguiente de un hilo, o `null` si ya está
 * completo. `offset` es el de la página recién leída y `received` cuántos
 * mensajes trajo. Sin `total` legible se asume una sola página: es lo que se
 * hacía antes y nunca pide de más.
 */
export function nextPackOffset(offset: number, received: number, total: unknown): number | null {
  const t = Number(total);
  if (!received || !Number.isFinite(t)) return null;
  const next = offset + received;
  return next < t ? next : null;
}

/** Lo que una lectura de hilo deja: los eventos y si vale la pena volver. */
export interface PackRead {
  events: InboundEvent[];
  /** Vacío y cerrado por Mercado Libre: releerlo pronto es gastar la cuota de
   *  la aplicación —compartida entre todos los comercios— para nada. */
  quiet: boolean;
}

// ── Token refresh (rotating refresh_token — must persist the new one) ──
//
// ML's refresh_token is SINGLE-USE. Under concurrent notifications two calls can
// both see the token expired and both POST /oauth/token with the same
// refresh_token: the first rotates it, the second 400s ("invalid_grant"). The
// old code flipped the connection to status='error' on that 400 — so a healthy,
// just-refreshed seller got stuck in error. We guard it two ways (serverless-safe,
// no schema): re-read the row right BEFORE refreshing (a concurrent winner may
// have already rotated it → use theirs), and re-read AFTER a failure (if the
// token is now valid, a winner rotated it while we were in flight → recover
// instead of erroring). Only a genuine, still-invalid token flips to error.
export async function getFreshMLToken(connection: ChannelConnection): Promise<string> {
  const admin = supabaseAdmin();

  const stillValid = (s: Record<string, unknown>, c: Record<string, unknown>): string | null => {
    const exp = c.token_expires_at ? Date.parse(String(c.token_expires_at)) : 0;
    const enc = String(s.access_token ?? "");
    return enc && exp > Date.now() + 120_000 ? decrypt(enc) : null;
  };

  let secrets = (connection.secrets ?? {}) as Record<string, unknown>;
  let config = (connection.config ?? {}) as Record<string, unknown>;
  const cached = stillValid(secrets, config);
  if (cached) return cached;

  // Re-read fresh before spending the refresh_token — a concurrent request may
  // have just rotated it.
  const { data: fresh } = await admin.from("channel_connections").select("secrets, config").eq("id", connection.id).maybeSingle();
  if (fresh) {
    secrets = (fresh.secrets ?? {}) as Record<string, unknown>;
    config = (fresh.config ?? {}) as Record<string, unknown>;
    const now = stillValid(secrets, config);
    if (now) return now;
  }

  const refreshEnc = String(secrets.refresh_token ?? "");
  if (!refreshEnc) {
    // Sin refresh_token la conexión no se puede renovar sola: la cuenta vence
    // a las 6 horas y queda muda. Se marca para que Integraciones pida
    // reconectar, en vez de seguir figurando "conectada" sin traer nada.
    await admin
      .from("channel_connections")
      .update({ status: "error", last_error: "ML sin refresh_token: hay que reconectar Mercado Libre" })
      .eq("id", connection.id);
    throw new Error("[mercadolibre] connection missing refresh_token");
  }
  // Only the app that issued the refresh_token can redeem it.
  const app = mercadoLibreAppFor(config.app_id);
  const res = await fetch(`${ML}/oauth/token`, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      accept: "application/json",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: app.clientId,
      client_secret: app.clientSecret,
      refresh_token: decrypt(refreshEnc),
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    // A concurrent winner may have rotated the token while we were in flight
    // (our refresh_token was already spent → this 400). Re-read: if it's now
    // valid, use it instead of flipping a healthy connection to error.
    const { data: after } = await admin.from("channel_connections").select("secrets, config").eq("id", connection.id).maybeSingle();
    if (after) {
      const recovered = stillValid((after.secrets ?? {}) as Record<string, unknown>, (after.config ?? {}) as Record<string, unknown>);
      if (recovered) return recovered;
    }
    await admin
      .from("channel_connections")
      .update({
        status: "error",
        last_error: `ML token refresh failed: ${detail.slice(0, 300)}`,
      })
      .eq("id", connection.id);
    throw new Error(`[mercadolibre] token refresh failed (${res.status}): ${detail}`);
  }
  const json = (await res.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
  };
  if (!json.access_token) throw new Error("[mercadolibre] refresh returned no access_token");
  const newExpiry = new Date(Date.now() + (json.expires_in ?? 21_600) * 1000).toISOString();
  const persisted=await admin.rpc('patch_ml_connection_state',{
      p_id: connection.id,
      p_secrets: {
        access_token: encrypt(json.access_token),
        // Single-use refresh token — persist the rotated one or the connection dies.
        ...(json.refresh_token ? { refresh_token: encrypt(json.refresh_token) } : {}),
      },
      // A successful refresh proves which app owns the token: record it for
      // rows that predate `app_id`.
      p_config: { token_expires_at: newExpiry, app_id: app.clientId },
      // Renewing OAuth does not reactivate a seller disabled by Mercado Libre.
      // Only a successful resource read can clear that confirmed account error.
      p_status: isInactiveMLAccountError(connection.last_error) ? "error" : "connected",
      p_clear_error: !isInactiveMLAccountError(connection.last_error),
    });
  if(persisted.error)throw new Error('[mercadolibre] refreshed token persistence failed');
  return json.access_token;
}

/**
 * Resolve a MercadoLibre user's PUBLIC nickname (ML never exposes the real
 * name). Best-effort: returns undefined on any failure so ingest still works
 * and the UI falls back to "Cliente Mercado Libre · …id".
 */
export async function resolveMlNickname(userId: string, auth: Record<string, string>): Promise<string | undefined> {
  if (!userId || userId === "ml") return undefined;
  try {
    const r = await fetch(`${ML}/users/${userId}`, { headers: auth });
    if (!r.ok) return undefined;
    const u = (await r.json()) as { nickname?: string };
    return u.nickname || undefined;
  } catch {
    return undefined;
  }
}

/**
 * Descargo con archivo dentro de un reclamo.
 *
 * Dos pasos, como en el resto de Mercado Libre: primero el archivo al
 * expediente (`/attachments`, multipart), después el mensaje citando el nombre
 * que devolvió. Un adjunto que no sube corta el envío en vez de mandar el
 * texto solo: en una mediación la foto ES el argumento.
 */
async function sendClaimMedia(claimId: string, input: OutboundMedia, token: string, locale: Locale): Promise<SendResult> {
  const file = await fetchAttachmentBytes(input.mediaUrl, input.connection.workspace_id);
  if (!file) throw new Error(translate(locale, "errInbox.attachmentUnreadable"));
  const filename = input.filename || attachmentFilename(input.mediaUrl, file.mime);

  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(file.buffer)], { type: file.mime }), filename);
  const upRes = await fetch(`${ML}/post-purchase/v1/claims/${claimId}/attachments`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
    body: form,
  });
  if (!upRes.ok) {
    const detail = await upRes.text().catch(() => "");
    throw new Error(`[mercadolibre] claim attachment failed (${upRes.status}): ${detail}`);
  }
  const uploaded = await upRes.json().catch(() => ({}));
  const attachmentId = claimAttachmentName(uploaded);
  if (!attachmentId) throw new Error("[mercadolibre] claim attachment returned no id");

  const res = await fetch(`${ML}/post-purchase/v1/claims/${claimId}/actions/send-message`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      receiver_role: "complainant",
      message: (input.caption ?? "").slice(0, 2000),
      attachments: [attachmentId],
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`[mercadolibre] claim message failed (${res.status}): ${detail}`);
  }
  await res.json().catch(() => ({}));
  return {
    externalMessageId: await newestClaimMessageHash(claimId, token),
    status: "sent",
  };
}

/**
 * El `hash` del último mensaje propio dentro del reclamo.
 *
 * El POST del descargo no devuelve ese hash, y el hash es justo la clave con
 * la que el sondeo de reclamos deduplica: sin releerlo, el mensaje enviado
 * desde Riverz volvería a entrar como una fila nueva en la corrida siguiente y
 * el hilo mostraría el descargo dos veces.
 */
async function newestClaimMessageHash(claimId: string, token: string): Promise<string | undefined> {
  try {
    const r = await fetch(`${ML}/post-purchase/v1/claims/${claimId}/messages`, {
      headers: { authorization: `Bearer ${token}` },
    });
    if (!r.ok) return undefined;
    const raw = (await r.json()) as
      | Array<{
          sender_role?: string;
          hash?: string;
          message_date?: string;
          date_created?: string;
        }>
      | {
          data?: Array<{
            sender_role?: string;
            hash?: string;
            message_date?: string;
            date_created?: string;
          }>;
        };
    const list = Array.isArray(raw) ? raw : (raw.data ?? []);
    const mine = list.filter((m) => m.sender_role === "respondent" && m.hash);
    let newest: (typeof mine)[number] | undefined;
    for (const m of mine) {
      const tb = Date.parse(m.message_date ?? m.date_created ?? "") || 0;
      const ta = newest ? Date.parse(newest.message_date ?? newest.date_created ?? "") || 0 : -1;
      if (tb >= ta) newest = m;
    }
    return newest?.hash;
  } catch {
    return undefined;
  }
}

/** Pull the pack id from a resource path like "/messages/packs/123/sellers/456". */
function extractPackId(resource: string): string | null {
  const m = resource.match(/\/messages\/packs\/([^/]+)/);
  return m ? m[1] : null;
}

/** New notifications can carry only a message id rather than a pack path. */
export async function resolveNotificationPack(resource: string, sellerId: string, token: string): Promise<string> {
  const direct = extractPackId(resource);
  if (direct) return direct;
  const match = resource.match(/^(?:\/messages\/)?([a-zA-Z0-9_-]+)$/);
  if (!match) throw new Error('[mercadolibre] unrecognized message notification resource');
  // Fixed origin and validated id: never fetch an arbitrary webhook URL.
  // Neither the lookup nor the subsequent pack read marks messages as read.
  const res = await fetch(`${ML}/messages/${encodeURIComponent(match[1])}?tag=post_sale&mark_as_read=false`, {
    headers: { authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(15_000),
  });
  throwIfRateLimited(res, 'message notification lookup');
  if (!res.ok) throw new Error(`[mercadolibre] message notification lookup failed (${res.status})`);
  type Resource = { id?: string | number; name?: string };
  type Message = { message_resources?: Resource[] };
  const payload = await res.json() as Message & { messages?: Message[] };
  const packs = new Set<string>();
  for (const message of payload.messages ?? [payload]) {
    const resources = message.message_resources ?? [];
    const seller = resources.find(r => r.name === 'seller');
    if (String(seller?.id ?? '') !== sellerId) continue;
    for (const r of resources) {
      const id = String(r.id ?? '');
      if (r.name === 'packs' && /^\d+$/.test(id)) packs.add(id);
    }
  }
  if (packs.size !== 1) throw new Error('[mercadolibre] message notification has no unique seller pack');
  return [...packs][0];
}

/** Tope de descarga por adjunto (10 MB) — igual criterio que el resto de los
 *  canales: un archivo enorme no puede bloquear el ingest. */
const ML_ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;

/**
 * Baja los adjuntos de un mensaje post-venta de Mercado Libre y los re-hospeda
 * en Storage. ML no publica una URL: se pide el archivo por su id con el token
 * del vendedor (`/messages/attachments/{id}?tag=post_sale&site_id=…`).
 * Best-effort — un adjunto que falla se saltea y el mensaje igual entra.
 *
 * Salvo un 429: ése corta la lectura entera del hilo. El mensaje se guarda una
 * sola vez (el corte por id externo descarta la relectura), así que dejarlo
 * entrar sin su foto por falta de cuota sería perder la foto para siempre.
 */
async function ingestMlAttachments(args: {
  attachments?: Array<{
    filename?: string;
    original_filename?: string;
    type?: string;
    size?: number;
  }>;
  token: string;
  siteId: string;
  workspaceId: string;
  externalContactId: string;
  externalMessageId?: string;
}): Promise<MessageAttachment[]> {
  const list = args.attachments ?? [];
  const out: MessageAttachment[] = [];
  for (let i = 0; i < list.length; i++) {
    const a = list[i];
    const id = a.filename?.trim();
    if (!id) continue;
    if (a.size && a.size > ML_ATTACHMENT_MAX_BYTES) continue;
    try {
      const url = new URL(`${ML}/messages/attachments/${encodeURIComponent(id)}`);
      url.searchParams.set("tag", "post_sale");
      if (args.siteId) url.searchParams.set("site_id", args.siteId);
      const r = await fetch(url.toString(), {
        headers: { authorization: `Bearer ${args.token}` },
      });
      throwIfRateLimited(r, "messages/attachments");
      if (!r.ok) continue;
      const buffer = Buffer.from(await r.arrayBuffer());
      if (!buffer.length || buffer.length > ML_ATTACHMENT_MAX_BYTES) continue;
      const ingested = await ingestRawMedia({
        buffer,
        mime: a.type || r.headers.get("content-type") || "application/octet-stream",
        workspaceId: args.workspaceId,
        conversationId: args.externalContactId,
        id: `${args.externalMessageId ?? "ml"}-${i}`,
        fileName: a.original_filename || id,
      });
      if (!ingested) continue;
      out.push({
        url: ingested.url,
        mime_type: ingested.mediaMime,
        size: ingested.mediaSize,
        name: a.original_filename || id,
      });
    } catch (err) {
      if (isMlRateLimit(err)) throw err;
      console.warn("[mercadolibre] adjunto no descargado:", err);
    }
  }
  return out;
}

interface MlQuestion {
  id?: number;
  seller_id?: number;
  buyer_id?: number;
  item_id?: string;
  text?: string;
  status?: string;
  date_created?: string;
  from?: { id?: number };
  /** Respuesta del vendedor (presente cuando status === "ANSWERED"). */
  answer?: { text?: string; date_created?: string; status?: string };
}
interface MlPack {
  messages?: Array<{
    id?: string;
    text?: string;
    from?: { user_id?: number | string };
    to?: { user_id?: number | string };
    message_date?: { created?: string };
    /** Fotos y archivos que el comprador (o el vendedor) adjuntó al mensaje. */
    message_attachments?: Array<{
      filename?: string;
      original_filename?: string;
      type?: string;
      size?: number;
    }>;
  }>;
  /** `blocked` cuando Mercado Libre no permite conversación en esa venta. */
  conversation_status?: { status?: string; substatus?: string | null };
  paging?: { limit?: number; offset?: number; total?: number };
}
