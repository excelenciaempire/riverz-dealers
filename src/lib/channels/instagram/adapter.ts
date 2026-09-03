import type {
  ChannelAdapter,
  InboundEvent,
  OutboundMedia,
  OutboundText,
  ParsedWebhookContext,
  SendResult,
} from "../types";
import { sendMetaMedia } from "../meta-send-media";
import type { ChannelConnection } from "@/types";
import { decrypt } from "../encryption";
import { verifyMetaHandshake } from "../meta-webhook";
import {
  composeMetaText,
  ingestMetaAttachments,
  isMetaUnsupportedText,
  logUnrenderableMetaMessage,
} from "../meta-attachments";
import { handleMetaReaction, type MetaReactionEvent } from "../meta-reactions";
import {
  handleMetaGraphError,
  clearMetaConnectionError,
  isMetaAuthWarning,
} from "../meta-auth";
import { describeMetaSendError, parseMetaError } from "../meta-errors";
import { safeLocale } from "@/lib/i18n/server";
import { buildParticipantMap } from "../meta-participants";
import { withAppsecretProof, withAppsecretProofBody } from "../meta-graph";
import { supabaseAdmin } from "../admin-client";
import { marcarEntrega } from "../estado-de-entrega";
import { findMessageByExternalId } from "../message-lookup";
import { COMMENT_DELETED_TEXT } from "../display";
import { isMarketingOptin, recordOptIn } from "../marketing-optin";
import { mapMetaAdReferral } from "../messenger/adapter";

/**
 * Instagram DMs via Meta Graph API (Messenger Platform for IG).
 *
 * Required config (channel_connections.config):
 *   - ig_user_id   — Instagram Professional account user id
 *   - page_id      — Connected Facebook page id (required by IG Messaging)
 *
 * Required secret (channel_connections.secrets):
 *   - access_token — Page access token with instagram_manage_messages
 *
 * Webhook subscription: IG `messages` field on the connected page.
 */
export const instagramAdapter: ChannelAdapter = {
  channel: "instagram",
  label: "Instagram DMs",

  isConfigured(connection: ChannelConnection): boolean {
    const cfg = (connection.config ?? {}) as Record<string, unknown>;
    return Boolean(cfg.ig_user_id) && Boolean(connection.secrets);
  },

  async sendText(input: OutboundText): Promise<SendResult> {
    const cfg = (input.connection.config ?? {}) as Record<string, unknown>;
    const pageId = String(cfg.page_id ?? "");
    if (!pageId) throw new Error("[instagram] connection missing page_id");

    const secrets = (input.connection.secrets ?? {}) as Record<string, unknown>;
    const encrypted = String(secrets.access_token ?? "");
    if (!encrypted) throw new Error("[instagram] connection missing access_token");
    const accessToken = decrypt(encrypted);

    // Two recipient shapes:
    //  - PRIVATE REPLY to a comment: `recipient: { comment_id }`. Required to
    //    DM someone who only commented — their comment-author id is NOT a
    //    messageable IGSID, so a plain `{ id }` send is rejected by Meta.
    //  - Normal DM (the user messaged us first): `recipient: { id: IGSID }`.
    const recipient = input.commentId
      ? { comment_id: input.commentId }
      : input.contact.external_id
        ? { id: input.contact.external_id }
        : null;
    if (!recipient) {
      throw new Error(
        "[instagram] no recipient — contact missing external_id (IGSID) and no comment_id",
      );
    }

    const graphUrl = `https://graph.facebook.com/v21.0/${pageId}/messages`;
    const send = (useHumanAgentTag: boolean): Promise<Response> =>
      fetch(graphUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(
          withAppsecretProofBody(
            {
              recipient,
              ...(useHumanAgentTag
                ? { messaging_type: "MESSAGE_TAG", tag: "HUMAN_AGENT" }
                : { messaging_type: "RESPONSE" }),
              message: { text: input.text },
              access_token: accessToken,
            },
            accessToken,
          ),
        ),
      });

    let res = await send(false);
    let detail = res.ok ? "" : await res.text().catch(() => "");
    // A human agent replying to a normal DM outside Meta's 24h window is
    // rejected as outside-window. Retry once with the HUMAN_AGENT tag (7-day
    // window) — ONLY for human sends (invalid for bot/automation) and ONLY for
    // id-recipient DMs, never comment private replies (those carry their own
    // 7-day window and take no tag).
    //
    // Si el reintento TAMBIÉN falla, se conserva el error ORIGINAL: la app no
    // tiene aprobada la etiqueta HUMAN_AGENT y Meta responde "(#10) To use
    // 'Human Agent'…", un texto que no le dice nada al comercio y que tapaba la
    // causa real (la ventana de 24 h cerrada). El fallback es una red de
    // seguridad: cuando se cae, calla.
    if (!res.ok && input.humanAgent && !input.commentId) {
      const firstErr = parseMetaError(detail);
      if (
        describeMetaSendError("instagram", res.status, firstErr).category ===
        "outside_window"
      ) {
        const retry = await send(true);
        if (retry.ok) {
          res = retry;
          detail = "";
        } else {
          console.error(
            `[instagram] fallback HUMAN_AGENT rechazado (${retry.status}):`,
            await retry.text().catch(() => ""),
          );
        }
      }
    }
    if (!res.ok) {
      const parsed = parseMetaError(detail);
      await handleMetaGraphError(supabaseAdmin(), input.connection, res.status, parsed);
      // Keep Meta's raw body in the server logs for debugging, but surface
      // only a clear, actionable message (in the merchant's locale) to the
      // agent (the toast / campaign log shows this) instead of a wall of JSON.
      console.error(`[instagram] send failed (${res.status}): ${detail}`);
      throw new Error(describeMetaSendError("instagram", res.status, parsed, await safeLocale()).userMessage);
    }
    // Send succeeded — auto-restore a connection previously flagged dead
    // so a recovered token re-greens without a manual reconnect.
    if (isMetaAuthWarning(input.connection.last_error)) {
      await clearMetaConnectionError(supabaseAdmin(), input.connection);
    }
    const json = (await res.json()) as { message_id?: string };
    return { externalMessageId: json.message_id, status: "sent" };
  },

  /** Foto, video o audio como respuesta del agente (Instagram no acepta
   *  documentos por DM). */
  async sendMedia(input: OutboundMedia): Promise<SendResult> {
    const cfg = (input.connection.config ?? {}) as Record<string, unknown>;
    const pageId = String(cfg.page_id ?? "");
    if (!pageId) throw new Error("[instagram] connection missing page_id");
    return sendMetaMedia("instagram", pageId, input);
  },

  async parseWebhook(
    ctx: ParsedWebhookContext,
    connection: ChannelConnection,
  ): Promise<InboundEvent[]> {
    const body = (ctx.payload ?? {}) as Record<string, unknown>;
    const events: InboundEvent[] = [];
    const entries = (body.entry as Array<Record<string, unknown>> | undefined) ?? [];
    // Our OWN account ids — never ingest events where WE are the sender.
    const cfg = (connection.config ?? {}) as Record<string, unknown>;
    const selfIds = new Set(
      [String(cfg.ig_user_id ?? ""), String(cfg.page_id ?? "")].filter(Boolean),
    );
    let pageToken: string | null = null;
    const getToken = (): string | null => {
      if (pageToken !== null) return pageToken;
      const secrets = (connection.secrets ?? {}) as Record<string, unknown>;
      const enc = String(secrets.access_token ?? "");
      pageToken = enc ? decrypt(enc) : "";
      return pageToken;
    };
    // IG webhooks ship the IGSID but no display label. Resolving the name
    // needs slow Graph calls (conversations API + /{igsid}) that frequently
    // fail without Advanced Access — so we DON'T block the message on them.
    // The message is ingested immediately (the inbox shows a generic label),
    // and names are resolved in the BACKGROUND afterwards, updating the
    // contact when they arrive. upsertContact already backfills names on
    // update, so this is safe and the message appears instantly instead of
    // waiting ~2-3s per delivery for lookups that mostly fail anyway.
    const senderIds = new Set<string>();
    for (const entry of entries) {
      const messaging = (entry.messaging as Array<Record<string, unknown>> | undefined) ?? [];
      for (const m of messaging) {
        const sender = m.sender as { id?: string } | undefined;
        const message = m.message as
          | {
              mid?: string;
              text?: string;
              is_echo?: boolean;
              /** Instagram NO entrega el contenido de las notas de voz, los
               *  GIFs ni lo compartido de cuentas privadas: manda el mensaje
               *  con esta bandera y sin adjunto (tampoco aparece vía Graph). */
              is_unsupported?: boolean;
              /** El DM lo borraron. Instagram lo manda por el MISMO webhook de
               *  `messages`, con esta bandera y sin texto. */
              is_deleted?: boolean;
              attachments?: Array<Record<string, unknown>>;
              reply_to?: { story?: { id?: string; url?: string } };
            }
          | undefined;
        if (!sender?.id) continue;

        // BORRARON UN DM. Se descartaba: el mensaje seguía en la bandeja para
        // siempre, y quien atiende contestaba algo que del otro lado ya no
        // existe. La fila se conserva —con la lápida— para que el hilo siga
        // teniendo sentido.
        if (message?.is_deleted && message.mid) {
          await marcarDmBorrado(connection, String(message.mid));
          continue;
        }

        // La persona aceptó recibir novedades fuera de la ventana de 24 h.
        // No es un mensaje —no lleva `message`— así que caía en el hueco de
        // abajo y se descartaba sin dejar rastro: el token, que es lo único
        // que permite escribirle la semana que viene, se perdía.
        if (isMarketingOptin(m.optin)) {
          await recordOptIn(supabaseAdmin(), {
            workspaceId: connection.workspace_id,
            connectionId: connection.id,
            channel: "instagram",
            externalContactId: String(sender.id),
            optin: m.optin,
          });
          continue;
        }

        const igPostback = m.postback as
          | { mid?: string; title?: string; payload?: string; referral?: unknown }
          | undefined;
        // Reacción a un DM: estado del mensaje reaccionado, no un mensaje nuevo.
        if (m.reaction) {
          const recipient = m.recipient as { id?: string } | undefined;
          await handleMetaReaction({
            channel: "instagram",
            connection,
            senderId: String(sender.id),
            recipientId: recipient?.id ? String(recipient.id) : undefined,
            selfIds,
            reaction: m.reaction as MetaReactionEvent,
          });
          continue;
        }
        if (!message) {
          // Acuse de LECTURA (`messaging_seen`) y de entrega. Instagram los
          // manda con una marca de tiempo y sin ids: "todo lo que te mandé
          // antes de esto, lo vio". Se procesa acá para que el día que se
          // suscriba el campo funcione sin tocar nada más — hoy no llega
          // porque agregarlo a la suscripción puede tumbar los DM enteros
          // (ver la nota en meta-graph.ts).
          const igLectura = m.read as { watermark?: number } | undefined;
          const igEntrega = m.delivery as { mids?: string[]; watermark?: number } | undefined;
          if (igLectura || igEntrega) {
            const recipient = m.recipient as { id?: string } | undefined;
            const contacto = selfIds.has(String(sender.id))
              ? String(recipient?.id ?? "")
              : String(sender.id);
            if (contacto) {
              await anotarAcuseIg(connection, contacto, {
                estado: igLectura ? "read" : "delivered",
                mids: igEntrega?.mids,
                watermarkMs: Number(igLectura?.watermark ?? igEntrega?.watermark ?? 0),
              });
            }
            continue;
          }
          // Sin `message` el evento antes se tiraba entero. Un botón tocado
          // (postback) SÍ es una respuesta de la persona y va al hilo; un
          // `referral` suelto sólo sella de qué anuncio vino la conversación.
          const pbTitle = String(igPostback?.title ?? "").trim();
          if (pbTitle) {
            senderIds.add(sender.id);
            events.push({
              channel: "instagram",
              connection,
              externalContactId: sender.id,
              externalMessageId:
                igPostback?.mid ?? `pb-${sender.id}-${String(m.timestamp ?? "")}`,
              text: pbTitle,
              receivedAt: new Date(Number(m.timestamp ?? Date.now())).toISOString(),
              referral: mapMetaAdReferral(igPostback?.referral),
              raw: m,
            });
            continue;
          }
          // Reacción a uno de NUESTROS mensajes (el corazón que la persona
          // deja sobre el DM). Meta la entrega en `message_reactions` —ya
          // suscrito— pero llegaba sin `message` y se tiraba entera, así que
          // una de las pocas interacciones que la API sí nos da person-level
          // se perdía. Es señal de interés real: la ingerimos como el emoji en
          // el hilo, que se entiende en cualquier idioma y no necesita UI nueva.
          const reaction = m.reaction as
            | { mid?: string; action?: string; emoji?: string; reaction?: string }
            | undefined;
          if (reaction?.action === "react") {
            const emoji = String(reaction.emoji ?? "").trim() || "❤️";
            senderIds.add(sender.id);
            events.push({
              channel: "instagram",
              connection,
              externalContactId: sender.id,
              externalMessageId: `rx-${reaction.mid ?? sender.id}-${String(m.timestamp ?? "")}`,
              text: emoji,
              receivedAt: new Date(Number(m.timestamp ?? Date.now())).toISOString(),
              raw: m,
            });
            continue;
          }

          const standalone =
            mapMetaAdReferral(m.referral) ?? mapMetaAdReferral(igPostback?.referral);
          if (standalone) {
            events.push({
              channel: "instagram",
              connection,
              externalContactId: sender.id,
              text: "",
              receivedAt: new Date(Number(m.timestamp ?? Date.now())).toISOString(),
              referral: standalone,
              referralOnly: true,
              raw: m,
            });
          }
          continue;
        }
        // Echo: a DM the business SENT — from the Instagram phone app, Business
        // Suite, or our own API. IG fires one for every business send (sender =
        // our IG/page id). Instead of dropping it we ingest it OUTBOUND, so a
        // reply the merchant types on their phone shows up in Riverz too
        // (multicanal: se sincroniza todo lo enviado y recibido, no solo lo que
        // sale desde acá). Sends made from Riverz dedupe by message_id (mismo
        // mid → inbox-writer los descarta), así que no se duplican; sólo
        // sobreviven los mensajes escritos realmente desde el celular.
        const isEcho = Boolean(message.is_echo) || selfIds.has(String(sender.id));
        if (isEcho) {
          const recipient = m.recipient as { id?: string } | undefined;
          const customerId = recipient?.id ? String(recipient.id) : "";
          // Sin destinatario mapeable, o eco hacia nuestra propia cuenta: nada
          // que sincronizar.
          if (!customerId || selfIds.has(customerId)) continue;
          const echo = await ingestMetaAttachments({
            attachments: message.attachments,
            workspaceId: connection.workspace_id,
            externalContactId: customerId,
            externalMessageId: message.mid,
            accessToken: getToken() || undefined,
          });
          // Resolvemos también el nombre del destinatario (por si el hilo lo
          // inició el comercio desde el celular y aún no existe en Riverz).
          senderIds.add(customerId);
          events.push({
            channel: "instagram",
            connection,
            externalContactId: customerId,
            externalMessageId: message.mid,
            text: composeMetaText(
              message.text,
              echo.descriptions,
              echo.media.length > 0,
              Boolean(message.is_unsupported) || echo.unsupported,
            ),
            attachments: echo.media.length ? echo.media : undefined,
            receivedAt: new Date(Number(m.timestamp ?? Date.now())).toISOString(),
            outbound: true,
            raw: m,
          });
          continue;
        }
        senderIds.add(sender.id);
        // Bajamos cada attachment a Storage para tener un permalink — las CDN
        // URLs de IG caducan en horas y el inbox necesita poder mostrar el
        // adjunto días después. Lo que no es archivo (post o reel compartido,
        // mención en historia, enlace) vuelve como texto descriptivo en vez de
        // desaparecer.
        const parsed = await ingestMetaAttachments({
          attachments: message.attachments,
          workspaceId: connection.workspace_id,
          externalContactId: sender.id,
          externalMessageId: message.mid,
          accessToken: getToken() || undefined,
        });
        // Click-to-Instagram ad context (the customer arrived from an ad).
        const igReferral =
          mapMetaAdReferral(m.referral) ?? mapMetaAdReferral(igPostback?.referral);
        // Respuesta a una historia NUESTRA, o mención de la marca en la SUYA:
        // llegan como un DM cualquiera y así quedaban indistinguibles. Son la
        // señal más caliente que Meta permite contactar — se etiquetan para
        // poder segmentarlas después.
        const engagementKind = message.reply_to?.story
          ? ("story_reply" as const)
          : (message.attachments ?? []).some(
                (att) => String((att as { type?: string }).type ?? "") === "story_mention",
              )
            ? ("story_mention" as const)
            : null;
        const igText = composeMetaText(
          message.text,
          parsed.descriptions,
          parsed.media.length > 0,
          Boolean(message.is_unsupported) || parsed.unsupported,
        );
        if (isMetaUnsupportedText(igText)) logUnrenderableMetaMessage("instagram", m);
        events.push({
          channel: "instagram",
          connection,
          externalContactId: sender.id,
          externalMessageId: message.mid,
          engagementKind,
          text: igText,
          attachments: parsed.media.length ? parsed.media : undefined,
          receivedAt: new Date(Number(m.timestamp ?? Date.now())).toISOString(),
          referral: igReferral,
          raw: m,
        });
      }
    }
    // Fire-and-forget name resolution — never blocks the inbound insert. By
    // the time the Graph call returns, ingest has already created the contact
    // row, so the UPDATE lands; on failure the name just stays generic.
    if (senderIds.size > 0) {
      void backfillInstagramNames(connection, [...senderIds], getToken());
    }
    return events;
  },

  async verifyWebhookHandshake(req: Request, connection: ChannelConnection): Promise<string | null> {
    return verifyMetaHandshake(req, connection);
  },
};

/**
 * Resolve an IGSID to a display label, preferring "@username" over the
 * full name (matches how IG shows people everywhere). Best-effort —
 * undefined on any failure so ingest never blocks on a profile fetch.
 */
async function fetchInstagramName(
  igsid: string,
  token: string | null,
): Promise<string | undefined> {
  if (!token) return undefined;
  try {
    const r = await fetch(
      withAppsecretProof(
        `https://graph.facebook.com/v22.0/${igsid}?fields=username,name&access_token=${encodeURIComponent(token)}`,
        token,
      ),
    );
    if (!r.ok) return undefined;
    const j = (await r.json()) as { username?: string; name?: string };
    if (j.username && j.username.trim()) return `@${j.username.trim()}`;
    if (j.name && j.name.trim()) return j.name.trim();
    return undefined;
  } catch {
    return undefined;
  }
}

/**
 * Resolve IG sender display names AFTER the message is ingested (so the
 * message itself never waits on Graph). Updates each contact's name only
 * when it's still null, so we never clobber a name resolved earlier. The
 * conversations-API participant map is the reliable source; the per-id
 * lookup is a best-effort fallback. Fully fire-and-forget — any error just
 * leaves the generic label until the next message or the 6h backfill cron.
 */
async function backfillInstagramNames(
  connection: ChannelConnection,
  senderIds: string[],
  token: string | null,
): Promise<void> {
  try {
    const map = await buildParticipantMap(
      "instagram",
      connection,
      token ?? "",
      5,
    ).catch(() => new Map<string, string>());
    const db = supabaseAdmin();
    for (const id of senderIds) {
      const name = map.get(id) ?? (await fetchInstagramName(id, token));
      if (!name) continue;
      await db
        .from("contacts")
        .update({ name })
        .eq("workspace_id", connection.workspace_id)
        .eq("channel", "instagram")
        .eq("external_id", id)
        .is("name", null);
    }
  } catch (err) {
    console.error("[instagram] background name backfill failed:", err);
  }
}

/**
 * El mismo acuse que Messenger, para Instagram.
 *
 * Vive aparte porque el hilo se resuelve por el contacto de ESTE canal: la
 * misma persona puede tener un DM de Instagram y uno de Messenger, y la marca
 * de tiempo de Meta es por conversación.
 */
async function anotarAcuseIg(
  connection: ChannelConnection,
  externalContactId: string,
  acuse: { estado: "delivered" | "read"; mids?: string[]; watermarkMs: number },
): Promise<void> {
  try {
    const db = supabaseAdmin();
    if (acuse.mids?.length) {
      await marcarEntrega(db, {
        workspaceId: connection.workspace_id,
        channel: "instagram",
        estado: acuse.estado,
        externalMessageIds: acuse.mids,
      });
      return;
    }
    if (!acuse.watermarkMs) return;
    const { data: contact } = await db
      .from("contacts")
      .select("id")
      .eq("workspace_id", connection.workspace_id)
      .eq("channel", "instagram")
      .eq("external_id", externalContactId)
      .limit(1)
      .maybeSingle();
    const contactId = (contact as { id?: string } | null)?.id;
    if (!contactId) return;
    const { data: conv } = await db
      .from("conversations")
      .select("id")
      .eq("workspace_id", connection.workspace_id)
      .eq("contact_id", contactId)
      .eq("channel", "instagram")
      .order("last_message_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const conversationId = (conv as { id?: string } | null)?.id;
    if (!conversationId) return;
    await marcarEntrega(db, {
      workspaceId: connection.workspace_id,
      channel: "instagram",
      estado: acuse.estado,
      watermarkMs: acuse.watermarkMs,
      conversationId,
    });
  } catch (err) {
    console.warn("[instagram] no se pudo anotar el acuse:", err);
  }
}

/** Un DM que la persona borró en Instagram. Ver el comentario del webhook. */
async function marcarDmBorrado(
  connection: ChannelConnection,
  mid: string,
): Promise<void> {
  try {
    const db = supabaseAdmin();
    const fila = await findMessageByExternalId<{ status: string | null }>(db, {
      workspaceId: connection.workspace_id,
      channel: "instagram",
      externalMessageId: mid,
      select: "status",
    });
    if (!fila || fila.status === "failed") return;
    await db
      .from("messages")
      .update({ status: "failed", content_text: COMMENT_DELETED_TEXT })
      .eq("id", fila.id);
  } catch (err) {
    console.warn("[instagram] no se pudo marcar el DM borrado:", err);
  }
}
