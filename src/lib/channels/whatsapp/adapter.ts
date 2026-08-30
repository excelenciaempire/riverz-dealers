import type {
  ChannelAdapter,
  InboundEvent,
  OutboundText,
  OutboundMedia,
  OutboundTemplate,
  ParsedWebhookContext,
  SendResult,
} from "../types";
import {
  sendImageMessage,
  sendVideoMessage,
  sendDocumentMessage,
  sendAudioMessage,
} from "@/lib/whatsapp/meta-api";
import type { ChannelConnection, MessageAttachment } from "@/types";
import { decrypt } from "../encryption";
import { ingestWhatsappMedia, type MediaCategory } from "../media-ingest";
import { resolveMediaFetchUrl } from "../media-url";
import {
  handleMetaGraphError,
  parseMetaErrorBody,
  clearMetaConnectionError,
} from "../meta-auth";
import { withAppsecretProof } from "../meta-graph";
import { supabaseAdmin } from "../admin-client";
import { findMessageByExternalId, findMessagesByExternalIds } from "../message-lookup";
import { desdeDonde } from "../estado-de-entrega";
import { metaErrorText, metaErrorCode } from "@/lib/whatsapp/delivery-errors";
import { ensureSendableImageUrl } from "@/lib/whatsapp/image-compat";
import {
  handleTemplateStatusUpdate,
  handleTemplateQualityUpdate,
  type TemplateWebhookValue,
} from "@/lib/whatsapp/template-webhooks";
import {
  fetchWhatsAppAccountHealth,
  persistWhatsAppHealthSnapshot,
} from "@/lib/whatsapp/account-health";
import { verifyPhoneNumber } from "@/lib/whatsapp/meta-api";

/** After a successful Meta call, restore a connection that was
 *  previously flagged dead (status='error'/'expired') so a recovered
 *  token re-greens without a manual reconnect. Guarded on the loaded
 *  status so healthy sends don't issue a needless UPDATE. */
async function healIfRecovered(connection: ChannelConnection): Promise<void> {
  if (connection.status !== "connected") {
    await clearMetaConnectionError(supabaseAdmin(), connection);
  }
}

/**
 * Refresca el snapshot de salud de la conexión (can_send / review / blockers +
 * quality_rating) desde Meta. Lo dispara un webhook de calidad de número o de
 * cuenta — refrescamos desde la fuente de verdad en vez de parsear el payload,
 * que no trae el color de calidad directo. Best-effort: nunca lanza al caller.
 */
async function refreshConnectionHealth(connection: ChannelConnection): Promise<void> {
  const cfg = (connection.config ?? {}) as Record<string, unknown>;
  const secrets = (connection.secrets ?? {}) as Record<string, unknown>;
  const phoneNumberId = String(
    cfg.phone_number_id ?? connection.external_account_id ?? "",
  );
  const wabaId = String(cfg.waba_id ?? "");
  const enc = String(secrets.access_token ?? "");
  if (!phoneNumberId || !wabaId || !enc) return;
  const accessToken = decrypt(enc);
  const [health, phoneInfo] = await Promise.all([
    fetchWhatsAppAccountHealth({ phoneNumberId, wabaId, accessToken }),
    verifyPhoneNumber({ phoneNumberId, accessToken }).catch(() => null),
  ]);
  await persistWhatsAppHealthSnapshot(
    supabaseAdmin(),
    connection.id,
    health,
    phoneInfo?.quality_rating,
  );
}

const GRAPH = "https://graph.facebook.com/v21.0";

/**
 * WhatsApp (Meta Cloud API).
 *
 * Fully wired through the unified channels router: inbound via
 * /api/channels/whatsapp/webhook, outbound via /api/messages/send.
 * The connection carries `config.phone_number_id` and an encrypted
 * `secrets.access_token` (a permanent system/long-lived user token).
 */
export const whatsappAdapter: ChannelAdapter = {
  channel: "whatsapp",
  label: "WhatsApp Business",

  isConfigured(connection: ChannelConnection): boolean {
    const cfg = (connection.config ?? {}) as Record<string, unknown>;
    return Boolean(cfg.phone_number_id) && Boolean(connection.secrets);
  },

  async sendText(input: OutboundText): Promise<SendResult> {
    const cfg = (input.connection.config ?? {}) as Record<string, unknown>;
    const phoneNumberId = String(cfg.phone_number_id ?? "");
    if (!phoneNumberId) throw new Error("[whatsapp] connection missing phone_number_id");

    const secrets = (input.connection.secrets ?? {}) as Record<string, unknown>;
    const encrypted = String(secrets.access_token ?? "");
    if (!encrypted) throw new Error("[whatsapp] connection missing access_token");
    const accessToken = decrypt(encrypted);

    const to = input.contact.phone || input.contact.external_id;
    if (!to) throw new Error("[whatsapp] contact missing phone/wa_id");

    const res = await fetch(
      withAppsecretProof(`${GRAPH}/${phoneNumberId}/messages`, accessToken),
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          recipient_type: "individual",
          to,
          type: "text",
          text: { body: input.text },
        }),
      },
    );
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      // On 401 / OAuthException / code 190 / 102 / 463, flip the
      // connection to status='error' with last_error so the Settings
      // → Canales card shows a "Reconectar" CTA instead of a green
      // dot over a broken token.
      await handleMetaGraphError(
        supabaseAdmin(),
        input.connection,
        res.status,
        parseMetaErrorBody(detail),
      );
      throw new Error(`[whatsapp] send failed (${res.status}): ${detail}`);
    }
    await healIfRecovered(input.connection);
    const json = (await res.json()) as {
      messages?: { id?: string; message_status?: string }[];
      contacts?: { wa_id?: string }[];
    };
    return {
      externalMessageId: json.messages?.[0]?.id,
      status: "sent",
      heldForQuality:
        json.messages?.[0]?.message_status === "held_for_quality_assessment",
      waId: json.contacts?.[0]?.wa_id,
    };
  },

  async sendTemplate(input: OutboundTemplate): Promise<SendResult> {
    const cfg = (input.connection.config ?? {}) as Record<string, unknown>;
    const phoneNumberId = String(cfg.phone_number_id ?? "");
    if (!phoneNumberId) throw new Error("[whatsapp] connection missing phone_number_id");

    const secrets = (input.connection.secrets ?? {}) as Record<string, unknown>;
    const encrypted = String(secrets.access_token ?? "");
    if (!encrypted) throw new Error("[whatsapp] connection missing access_token");
    const accessToken = decrypt(encrypted);

    const to = input.contact.phone || input.contact.external_id;
    if (!to) throw new Error("[whatsapp] contact missing phone/wa_id");

    const res = await fetch(
      withAppsecretProof(`${GRAPH}/${phoneNumberId}/messages`, accessToken),
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to,
          type: "template",
          template: {
            name: input.templateName,
            language: { code: input.language ?? "es" },
            components: input.params?.length
              ? [
                  {
                    type: "body",
                    parameters: input.params.map((text) => ({ type: "text", text })),
                  },
                ]
              : undefined,
          },
        }),
      },
    );
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      await handleMetaGraphError(
        supabaseAdmin(),
        input.connection,
        res.status,
        parseMetaErrorBody(detail),
      );
      throw new Error(`[whatsapp] template send failed (${res.status}): ${detail}`);
    }
    await healIfRecovered(input.connection);
    const json = (await res.json()) as {
      messages?: { id?: string; message_status?: string }[];
      contacts?: { wa_id?: string }[];
    };
    return {
      externalMessageId: json.messages?.[0]?.id,
      status: "sent",
      heldForQuality:
        json.messages?.[0]?.message_status === "held_for_quality_assessment",
      waId: json.contacts?.[0]?.wa_id,
    };
  },

  async sendMedia(input: OutboundMedia): Promise<SendResult> {
    const cfg = (input.connection.config ?? {}) as Record<string, unknown>;
    const phoneNumberId = String(cfg.phone_number_id ?? "");
    if (!phoneNumberId) throw new Error("[whatsapp] connection missing phone_number_id");
    const secrets = (input.connection.secrets ?? {}) as Record<string, unknown>;
    const encrypted = String(secrets.access_token ?? "");
    if (!encrypted) throw new Error("[whatsapp] connection missing access_token");
    const accessToken = decrypt(encrypted);
    const to = input.contact.phone || input.contact.external_id;
    if (!to) throw new Error("[whatsapp] contact missing phone/wa_id");

    // WhatsApp no recibe el archivo: recibe un enlace y lo descarga él. Los
    // adjuntos propios viven en un bucket privado, así que van firmados.
    const common = {
      phoneNumberId,
      accessToken,
      to,
      url: await resolveMediaFetchUrl(input.mediaUrl),
      contextMessageId: input.replyToExternalId,
    };
    try {
      let result: { messageId: string };
      switch (input.mediaType) {
        case "image":
          // Red de seguridad para URLs que no pasaron por el composer (imagen
          // de producto, nodo de flujo, CDN de Shopify): WhatsApp rechaza todo
          // lo que no sea JPEG/PNG con el código 131053.
          result = await sendImageMessage({
            ...common,
            url: await ensureSendableImageUrl(input.mediaUrl),
            caption: input.caption,
          });
          break;
        case "video":
          result = await sendVideoMessage({ ...common, caption: input.caption });
          break;
        case "document":
          result = await sendDocumentMessage({
            ...common,
            caption: input.caption,
            filename: input.filename,
          });
          break;
        case "audio":
          result = await sendAudioMessage(common);
          break;
      }
      await healIfRecovered(input.connection);
      return { externalMessageId: result.messageId, status: "sent" };
    } catch (err) {
      // Flip the connection to error on token death so the card shows a
      // Reconnect CTA, mirroring sendText. The meta-api helper throws a
      // MetaSendError carrying the HTTP status + parsed body.
      const status = (err as { status?: number })?.status;
      const parsed = (err as { body?: unknown })?.body ?? null;
      if (typeof status === "number") {
        await handleMetaGraphError(
          supabaseAdmin(),
          input.connection,
          status,
          parsed as Parameters<typeof handleMetaGraphError>[3],
        );
      }
      throw new Error(
        `[whatsapp] media send failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  },

  async parseWebhook(
    ctx: ParsedWebhookContext,
    connection: ChannelConnection,
  ): Promise<InboundEvent[]> {
    const body = ctx.payload as WhatsAppWebhookBody | null;
    if (!body || body.object !== "whatsapp_business_account") return [];

    const secrets = (connection.secrets ?? {}) as Record<string, unknown>;
    const encryptedToken = String(secrets.access_token ?? "");

    const events: InboundEvent[] = [];
    for (const entry of body.entry ?? []) {
      for (const change of entry.changes ?? []) {
        const value = change.value;
        if (!value) continue;

        // Delivery/read/FAILED status updates for our OWN outbound messages.
        // Without this the channels route left every sent message stuck at
        // "sent" forever AND silently dropped failures — so a message that
        // Meta rejected looked "sent" while the customer never received it.
        if (value.statuses) {
          await handleWhatsappStatuses(connection, value.statuses);
          continue;
        }

        // --- Plantillas: estado + calidad (visibilidad de pacing) ---
        // Esta ES la ruta activa (el callback configurado en la app de Meta),
        // así que los webhooks de plantilla suscritos se procesan acá. entry.id
        // es el WABA. Best-effort; nunca rompe el parseo del resto.
        if (change.field === "message_template_status_update") {
          await handleTemplateStatusUpdate(
            supabaseAdmin(),
            entry.id ?? "",
            value as unknown as TemplateWebhookValue,
          ).catch((e) => console.error("[whatsapp] template status webhook:", e));
          continue;
        }
        if (change.field === "message_template_quality_update") {
          await handleTemplateQualityUpdate(
            supabaseAdmin(),
            entry.id ?? "",
            value as unknown as TemplateWebhookValue,
          ).catch((e) => console.error("[whatsapp] template quality webhook:", e));
          continue;
        }
        // --- Salud de la cuenta / calidad del número: refrescamos el snapshot
        //     desde la fuente de verdad en vez de parsear el payload (que no
        //     trae el color de calidad directo). Best-effort. ---
        if (
          change.field === "phone_number_quality_update" ||
          change.field === "account_update" ||
          change.field === "account_review_update"
        ) {
          await refreshConnectionHealth(connection).catch((e) =>
            console.error("[whatsapp] health refresh webhook:", e),
          );
          continue;
        }

        // --- Coexistence: echoes of messages the merchant sent from their own
        //     phone's WhatsApp Business app. Stored OUTBOUND (agent) so the AI
        //     never double-replies to a customer the human already answered. ---
        if (change.field === "smb_message_echoes" && value.message_echoes) {
          for (const e of value.message_echoes) {
            if (!e.to || !e.id || e.type === "revoke" || e.type === "edit") continue;
            // Una reacción NO es un mensaje: la reacción que el comercio mandó
            // desde el celular va a message_reactions y se muestra SOBRE el
            // mensaje objetivo (como WhatsApp), no como un bubble "[reaction]".
            if (e.type === "reaction") {
              await handleWhatsappReactionEcho(connection, e);
              continue;
            }
            const att = await ingestInboundMedia({
              message: e,
              encryptedToken,
              workspaceId: connection.workspace_id,
              externalContactId: e.to,
            });
            events.push({
              channel: "whatsapp",
              connection,
              externalContactId: e.to,
              externalMessageId: e.id,
              text: extractText(e),
              attachments: att.length ? att : undefined,
              receivedAt: e.timestamp
                ? new Date(Number(e.timestamp) * 1000).toISOString()
                : new Date().toISOString(),
              outbound: true,
              raw: e,
            });
          }
          continue;
        }

        // --- Coexistence: past chats synced from the app. Direction derived
        //     from `from` vs the business number; flagged historical so old
        //     messages never trigger the AI. ---
        if (change.field === "history" && value.history) {
          const bizPhone = onlyDigits(
            value.metadata?.display_phone_number ??
              String(
                (connection.config as Record<string, unknown>)
                  ?.display_phone_number ?? "",
              ),
          );
          for (const chunk of value.history) {
            for (const thread of chunk.threads ?? []) {
              if (!thread.id) continue;
              for (const m of thread.messages ?? []) {
                if (
                  !m.id ||
                  m.type === "revoke" ||
                  m.type === "edit" ||
                  m.type === "reaction"
                )
                  continue;
                const fromBusiness =
                  bizPhone.length >= 8 &&
                  onlyDigits(m.from ?? "").endsWith(bizPhone.slice(-10));
                const att = await ingestInboundMedia({
                  message: m,
                  encryptedToken,
                  workspaceId: connection.workspace_id,
                  externalContactId: thread.id,
                });
                events.push({
                  channel: "whatsapp",
                  connection,
                  externalContactId: thread.id,
                  externalMessageId: m.id,
                  text: extractText(m),
                  attachments: att.length ? att : undefined,
                  receivedAt: m.timestamp
                    ? new Date(Number(m.timestamp) * 1000).toISOString()
                    : new Date().toISOString(),
                  outbound: fromBusiness,
                  historical: true,
                  raw: m,
                });
              }
            }
          }
          continue;
        }

        // --- Coexistence: the merchant's contacts synced from the app. ---
        if (change.field === "smb_app_state_sync" && value.state_sync) {
          await upsertCoexistenceContacts(connection.workspace_id, value.state_sync);
          continue;
        }

        if (change.field !== "messages" || !value.messages) continue;

        // Map wa_id → profile name from the contacts array.
        const nameByWaId = new Map<string, string>();
        for (const c of value.contacts ?? []) {
          if (c.wa_id) nameByWaId.set(c.wa_id, c.profile?.name ?? "");
        }

        for (const m of value.messages) {
          if (!m.from || !m.id) continue;
          // Las reacciones NO son mensajes: se guardan en message_reactions y se
          // muestran adjuntas a la burbuja del mensaje reaccionado (como
          // WhatsApp real), no como un mensaje "[reaction]". Antes caían al
          // default de extractText y ensuciaban el hilo.
          if (m.type === "reaction") {
            await handleWhatsappReaction(connection, m);
            continue;
          }
          const text = extractText(m);
          // Si el mensaje trae media, bajamos los bytes ahora y los
          // subimos a Supabase Storage para tener una URL pública
          // estable. Si la descarga falla, dejamos el texto "[Imagen]"
          // y seguimos — nunca bloqueamos el ingest por un media roto.
          const attachments = await ingestInboundMedia({
            message: m,
            encryptedToken,
            workspaceId: connection.workspace_id,
            externalContactId: m.from,
          });
          const referral = m.referral
            ? {
                sourceType: m.referral.source_type,
                sourceId: m.referral.source_id,
                ctwaClid: m.referral.ctwa_clid,
                sourceUrl: m.referral.source_url,
                headline: m.referral.headline,
                body: m.referral.body,
                mediaType: m.referral.media_type,
              }
            : undefined;
          events.push({
            channel: "whatsapp",
            connection,
            externalContactId: m.from,
            contactName: nameByWaId.get(m.from) || undefined,
            externalMessageId: m.id,
            text,
            referral,
            attachments: attachments.length ? attachments : undefined,
            // WhatsApp timestamps are Unix SECONDS as a string.
            receivedAt: m.timestamp
              ? new Date(Number(m.timestamp) * 1000).toISOString()
              : new Date().toISOString(),
            raw: m,
          });
        }
      }
    }
    return events;
  },

  async verifyWebhookHandshake(req: Request, connection: ChannelConnection): Promise<string | null> {
    const url = new URL(req.url);
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");
    // Accept either the per-connection secret or the shared Meta verify
    // token (the unified route already handles the shared-token case
    // before reaching here, but keep both paths working).
    const expected = connection.webhook_secret || process.env.META_WEBHOOK_VERIFY_TOKEN;
    if (mode === "subscribe" && token && expected && token === expected) {
      return challenge;
    }
    return null;
  },
};

/** Strip everything but digits — for comparing phone numbers across formats. */
function onlyDigits(s: string): string {
  return (s || "").replace(/\D/g, "");
}

/** Message-status ladder — never regress a recipient back down it. `failed`
 *  is a terminal side branch valid only from the early states. */

/**
 * Apply WhatsApp delivery/read/FAILED status updates to our outbound messages
 * (keyed by the Meta wamid = messages.message_id). Forward-only on the ladder;
 * a `failed` status flips the message to failed and logs Meta's reason so the
 * real cause of a "sent but never delivered" message is visible in the logs.
 */
async function handleWhatsappStatuses(
  connection: ChannelConnection,
  statuses: Array<{
    id?: string;
    status?: string;
    timestamp?: string;
    recipient_id?: string;
    errors?: { code?: number; title?: string; message?: string; error_data?: { details?: string } }[];
  }>,
): Promise<void> {
  const db = supabaseAdmin();
  // De qué fila habla cada acuse, con alcance de workspace. Antes el UPDATE
  // filtraba por `message_id` a secas: el mismo número conectado en dos
  // comercios escribía el estado en las dos filas.
  const filas = await findMessagesByExternalIds(db, {
    workspaceId: connection.workspace_id,
    channel: "whatsapp",
    externalMessageIds: (statuses ?? []).map((s) => s?.id ?? ""),
  });
  for (const s of statuses ?? []) {
    if (!s?.id || !s.status) continue;
    const fila = filas.get(s.id);
    if (!fila) continue;
    if (s.status === "failed") {
      const e = s.errors?.[0];
      console.error(
        `[whatsapp] message ${s.id} FAILED — code=${e?.code} title="${e?.title}" detail="${e?.error_data?.details ?? e?.message ?? ""}"`,
      );
      // Persistir el motivo REAL (código + texto + payload crudo) para que la
      // bandeja lo muestre traducido — este handler antes marcaba 'failed' a
      // secas y el comercio se quedaba sin explicación.
      await db
        .from("messages")
        .update({
          status: "failed",
          error_reason: metaErrorText(s.errors),
          error_code: metaErrorCode(s.errors),
          meta_status_raw: s,
          delivery_unconfirmed_at: null,
        })
        .eq("id", fila.id)
        .in("status", ["sending", "sent"]);
      continue;
    }
    // Sólo hacia adelante: el escalón vive en `estado-de-entrega`, compartido
    // con Messenger. "pending" no existe en el CHECK de messages.status
    // (migración 001): el peldaño cero real es "sending", el optimista del
    // compositor.
    const anteriores = desdeDonde(s.status);
    if (anteriores.length === 0) continue;
    const patch: Record<string, unknown> = { status: s.status };
    if (s.status === "delivered" || s.status === "read") {
      // Entrega confirmada: limpiar marcas de "no confirmada" / retención.
      patch.delivery_unconfirmed_at = null;
      patch.held_for_quality = false;
    }
    await db
      .from("messages")
      .update(patch)
      .eq("id", fila.id)
      .in("status", anteriores);
  }
}

/**
 * Coexistence `smb_app_state_sync`: upsert the merchant's phone contacts so the
 * inbox shows real names. Keyed by external_id = the raw wa_id/phone (matching
 * how inbound messages key contacts). `remove` is ignored — never delete a
 * contact that may already have conversation history. Best-effort per item.
 */
async function upsertCoexistenceContacts(
  workspaceId: string,
  stateSync: Array<{
    type?: string;
    action?: string;
    contact?: { full_name?: string; first_name?: string; phone_number?: string };
  }>,
): Promise<void> {
  const db = supabaseAdmin();
  for (const item of stateSync ?? []) {
    if (item?.type !== "contact" || !item.contact || item.action === "remove") continue;
    const external = onlyDigits(item.contact.phone_number ?? "");
    if (!external) continue;
    const name = item.contact.full_name || item.contact.first_name || "";
    try {
      const { data: existing } = await db
        .from("contacts")
        .select("id, name")
        .eq("workspace_id", workspaceId)
        .eq("channel", "whatsapp")
        .eq("external_id", external)
        .maybeSingle();
      if (existing) {
        if (name && (existing as { name?: string }).name !== name) {
          await db.from("contacts").update({ name }).eq("id", (existing as { id: string }).id);
        }
      } else {
        await db.from("contacts").insert({
          workspace_id: workspaceId,
          channel: "whatsapp",
          external_id: external,
          phone: external,
          // Sin nombre de perfil dejamos name=null: la UI muestra el teléfono
          // FORMATEADO ("+54 9 …") en vez del wa_id crudo pegado como nombre.
          name: name || null,
        });
      }
    } catch (err) {
      console.warn("[whatsapp] coexistence contact upsert failed:", err);
    }
  }
}

/**
 * Persist an inbound WhatsApp reaction. Reactions aren't messages — they're
 * per-(target, actor) state — so we upsert/delete on `message_reactions` and
 * the bubble renders the emoji, exactly like the legacy webhook does. Empty
 * emoji = removal (Meta spec). Best-effort: a missing parent is skipped.
 */
async function handleWhatsappReaction(
  connection: ChannelConnection,
  m: WhatsAppMessage,
): Promise<void> {
  const reaction = m.reaction;
  if (!reaction?.message_id || !m.from) return;
  const db = supabaseAdmin();
  try {
    // Con alcance de workspace: el mismo numero puede estar conectado en dos
    // comercios, y el wamid es el mismo para los dos.
    const t = await findMessageByExternalId(db, {
      workspaceId: connection.workspace_id,
      channel: "whatsapp",
      externalMessageId: reaction.message_id,
    });
    if (!t) return; // el mensaje reaccionado aún no está ingerido

    const { data: contact } = await db
      .from("contacts")
      .select("id")
      .eq("workspace_id", connection.workspace_id)
      .eq("channel", "whatsapp")
      .eq("external_id", m.from)
      .limit(1)
      .maybeSingle();
    const c = contact as { id: string } | null;
    if (!c) return;

    if (!reaction.emoji) {
      await db
        .from("message_reactions")
        .delete()
        .eq("message_id", t.id)
        .eq("actor_type", "customer")
        .eq("actor_id", c.id);
      return;
    }
    await db.from("message_reactions").upsert(
      {
        message_id: t.id,
        conversation_id: t.conversation_id,
        actor_type: "customer",
        actor_id: c.id,
        emoji: reaction.emoji,
      },
      { onConflict: "message_id,actor_type,actor_id" },
    );
  } catch (err) {
    console.warn("[whatsapp] reaction handling failed:", err);
  }
}

/**
 * Persist a reaction the MERCHANT sent from their phone (coexistence echo). Es
 * el negocio reaccionando, así que actor_type='agent' + actor_id=workspace_id
 * — se muestra sobre el mensaje objetivo como WhatsApp, en vez de caer como un
 * bubble "[reaction]". Emoji vacío = quitó la reacción. Best-effort: si el
 * mensaje objetivo aún no está ingerido, se omite.
 */
async function handleWhatsappReactionEcho(
  connection: ChannelConnection,
  e: WhatsAppMessage,
): Promise<void> {
  const reaction = e.reaction;
  if (!reaction?.message_id) return;
  const db = supabaseAdmin();
  try {
    // Con alcance de workspace: el mismo numero puede estar conectado en dos
    // comercios, y el wamid es el mismo para los dos.
    const t = await findMessageByExternalId(db, {
      workspaceId: connection.workspace_id,
      channel: "whatsapp",
      externalMessageId: reaction.message_id,
    });
    if (!t) return;
    const actorId = connection.workspace_id;
    if (!reaction.emoji) {
      await db
        .from("message_reactions")
        .delete()
        .eq("message_id", t.id)
        .eq("actor_type", "agent")
        .eq("actor_id", actorId);
      return;
    }
    await db.from("message_reactions").upsert(
      {
        message_id: t.id,
        conversation_id: t.conversation_id,
        actor_type: "agent",
        actor_id: actorId,
        emoji: reaction.emoji,
      },
      { onConflict: "message_id,actor_type,actor_id" },
    );
  } catch (err) {
    console.warn("[whatsapp] reaction echo handling failed:", err);
  }
}

/** Exportada para tests: es la que decide QUÉ se ve de cada tipo de mensaje. */
export function extractText(m: WhatsAppMessage): string {
  switch (m.type) {
    case "text":
      return m.text?.body ?? "";
    case "image":
      return m.image?.caption || "[Imagen]";
    case "video":
      return m.video?.caption || "[Video]";
    case "document":
      return m.document?.caption || m.document?.filename || "[Documento]";
    case "audio":
      return "[Audio]";
    case "sticker":
      return "[Sticker]";
    case "location":
      return describeLocation(m);
    case "interactive":
      return (
        m.interactive?.button_reply?.title ??
        m.interactive?.list_reply?.title ??
        describeFlowReply(m) ??
        "[Respuesta interactiva]"
      );
    // Botón de una plantilla: el título es literalmente lo que respondió la
    // persona, así que se lee como cualquier mensaje suyo.
    case "button":
      return m.button?.text || "[Respuesta]";
    case "contacts":
      return describeContacts(m);
    case "order":
      return describeOrder(m);
    case "system":
      return m.system?.body || "[unsupported message type: system]";
    default:
      // Un tipo nuevo de WhatsApp: si trae texto lo mostramos; si no, la
      // bandeja pone el rótulo localizado de "mensaje no compatible" en vez
      // de un "[order]" crudo.
      //
      // Se guarda ADEMÁS lo que Meta dice del problema. Su `errors[]` es la
      // única pista de QUÉ mandó la persona —el código 131051 y su detalle— y
      // se estaba tirando: quedaba "[No compatible]" y nadie, ni el comercio
      // ni la IA, podía saber qué había pasado (2026-08-29). La bandeja no lo
      // muestra: `isUnsupportedSnippet` ancla al principio del texto y lo
      // reemplaza por el rótulo localizado, así que esto vive en la fila para
      // cuando haya que explicarlo.
      return m.text?.body || `[unsupported message type: ${m.type}]${motivoDeMeta(m)}`;
  }
}

/** Lo que Meta explicó del mensaje que no pudo entregar. Vacío si no dijo nada. */
function motivoDeMeta(m: WhatsAppMessage): string {
  const e = m.errors?.[0];
  if (!e) return "";
  const detalle = e.error_data?.details || e.details || e.message || e.title || "";
  const partes = [e.code ? `#${e.code}` : "", detalle].filter(Boolean);
  return partes.length ? ` (${partes.join(" ")})` : "";
}

/** Nombre / dirección de la ubicación + enlace al mapa, para poder abrirla. */
function describeLocation(m: WhatsAppMessage): string {
  const loc = m.location ?? {};
  const label = [loc.name, loc.address].filter(Boolean).join(" · ");
  const lat = Number(loc.latitude);
  const lng = Number(loc.longitude);
  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    return [label || "[Ubicación]", `https://maps.google.com/?q=${lat},${lng}`].join("\n");
  }
  return label || "[Ubicación]";
}

/** Tarjeta(s) de contacto compartidas: nombre y teléfono de cada una. */
function describeContacts(m: WhatsAppMessage): string {
  const lines = (m.contacts ?? [])
    .map((c) => {
      const name = c.name?.formatted_name || c.name?.first_name || "";
      const phone = c.phones?.find((p) => p.phone || p.wa_id);
      const number = phone?.phone || phone?.wa_id || "";
      const email = c.emails?.find((e) => e.email)?.email ?? "";
      return [name, number, email].filter(Boolean).join(" · ");
    })
    .filter(Boolean);
  return lines.length ? lines.join("\n") : "[Contacto]";
}

/** Pedido armado desde el catálogo: cuántas unidades de cada producto. */
function describeOrder(m: WhatsAppMessage): string {
  const items = m.order?.product_items ?? [];
  const lines = items
    .map((it) => {
      const qty = Number(it.quantity);
      const price = Number(it.item_price);
      const parts = [
        Number.isFinite(qty) && qty > 0 ? `${qty}×` : "",
        it.product_retailer_id ?? "",
        Number.isFinite(price) && price > 0
          ? `${price}${it.currency ? ` ${it.currency}` : ""}`
          : "",
      ].filter(Boolean);
      return parts.join(" ");
    })
    .filter(Boolean);
  const note = m.order?.text?.trim();
  const body = lines.length ? `[Pedido]\n${lines.join("\n")}` : "[Pedido]";
  return note ? `${body}\n${note}` : body;
}

/** Respuesta de un WhatsApp Flow: mostramos los valores que completó la
 *  persona, no el JSON crudo. */
function describeFlowReply(m: WhatsAppMessage): string | undefined {
  const nfm = m.interactive?.nfm_reply;
  if (!nfm) return undefined;
  const fromJson = (() => {
    if (!nfm.response_json) return "";
    try {
      const parsed = JSON.parse(nfm.response_json) as Record<string, unknown>;
      return Object.entries(parsed)
        .filter(([k]) => k !== "flow_token")
        .map(([k, v]) => `${k}: ${String(v)}`)
        .join("\n");
    } catch {
      return "";
    }
  })();
  return fromJson || nfm.body || nfm.name || undefined;
}

interface WhatsAppWebhookBody {
  object?: string;
  entry?: {
    id?: string;
    changes?: {
      field?: string;
      value?: {
        metadata?: { display_phone_number?: string; phone_number_id?: string };
        contacts?: { wa_id?: string; profile?: { name?: string } }[];
        messages?: WhatsAppMessage[];
        statuses?: {
          id?: string;
          status?: string;
          timestamp?: string;
          recipient_id?: string;
          errors?: {
            code?: number;
            title?: string;
            message?: string;
            error_data?: { details?: string };
          }[];
        }[];
        // Coexistence-only fields (merchant kept the WhatsApp Business app).
        message_echoes?: WhatsAppMessage[];
        history?: { threads?: { id?: string; messages?: WhatsAppMessage[] }[] }[];
        state_sync?: {
          type?: string;
          action?: string;
          contact?: { full_name?: string; first_name?: string; phone_number?: string };
        }[];
      };
    }[];
  }[];
}

export interface WhatsAppMessage {
  id?: string;
  from?: string;
  /** Recipient (the customer) — present on echoes / history messages. */
  to?: string;
  timestamp?: string;
  type: string;
  text?: { body: string };
  image?: { id: string; caption?: string; mime_type?: string };
  video?: { id: string; caption?: string; mime_type?: string };
  document?: {
    id: string;
    filename?: string;
    caption?: string;
    mime_type?: string;
  };
  audio?: { id: string; voice?: boolean; mime_type?: string };
  sticker?: { id: string; mime_type?: string; animated?: boolean };
  location?: {
    name?: string;
    address?: string;
    latitude?: number;
    longitude?: number;
  };
  interactive?: {
    type: string;
    button_reply?: { id: string; title: string };
    list_reply?: { id: string; title: string };
    /** Respuesta de un WhatsApp Flow — el detalle viaja como JSON. */
    nfm_reply?: { name?: string; body?: string; response_json?: string };
  };
  /** Respuesta a un botón de plantilla (tipo `button`, no `interactive`). */
  button?: { text?: string; payload?: string };
  /** Tarjeta de contacto compartida. */
  contacts?: Array<{
    name?: { formatted_name?: string; first_name?: string };
    phones?: Array<{ phone?: string; wa_id?: string }>;
    emails?: Array<{ email?: string }>;
  }>;
  /** Pedido armado desde el catálogo de WhatsApp. */
  order?: {
    catalog_id?: string;
    text?: string;
    product_items?: Array<{
      product_retailer_id?: string;
      quantity?: number | string;
      item_price?: number | string;
      currency?: string;
    }>;
  };
  /** Mensaje del sistema (cambio de número, etc.). */
  system?: { body?: string };
  /** Emoji reaction to a previously-exchanged message (not a new message). */
  reaction?: { message_id?: string; emoji?: string };
  /**
   * Por qué Meta no pudo entregarlo. Viene con `type: "unsupported"`, que es lo
   * que manda cuando la persona envió algo que la Cloud API no reparte
   * (ver-una-vez, una encuesta, una función nueva del teléfono): llega este
   * aviso y ningún archivo.
   */
  errors?: Array<{
    code?: number;
    title?: string;
    message?: string;
    details?: string;
    error_data?: { details?: string };
  }>;
  /** Present when the message came from a Click-to-WhatsApp ad. */
  referral?: {
    source_type?: string;
    source_id?: string;
    ctwa_clid?: string;
    source_url?: string;
    headline?: string;
    body?: string;
    media_type?: string;
  };
}

/**
 * Para mensajes con media, baja el archivo desde Meta y lo sube a
 * Storage. Devuelve un array de MessageAttachment listos para
 * persistir en `messages.attachments`. Si la descarga falla devuelve
 * []. Soporta image/video/document/audio/voice/sticker — WhatsApp
 * sólo manda UNA pieza por mensaje, pero usamos array para que sea
 * consistente con IG/Messenger y futuras extensiones.
 */
async function ingestInboundMedia(args: {
  message: WhatsAppMessage;
  encryptedToken: string;
  workspaceId: string;
  externalContactId: string;
}): Promise<MessageAttachment[]> {
  const { message: m, encryptedToken, workspaceId, externalContactId } = args;
  if (!encryptedToken) return [];

  let mediaId: string | undefined;
  let hintedKind: MediaCategory | undefined;
  let fileName: string | undefined;
  switch (m.type) {
    case "image":
      mediaId = m.image?.id;
      hintedKind = "image";
      break;
    case "video":
      mediaId = m.video?.id;
      hintedKind = "video";
      break;
    case "document":
      mediaId = m.document?.id;
      hintedKind = "document";
      fileName = m.document?.filename;
      break;
    case "audio":
      mediaId = m.audio?.id;
      // WhatsApp distingue voice notes con `voice: true`. El resto
      // (audio adjunto) lo marcamos como "audio".
      hintedKind = m.audio?.voice ? "voice" : "audio";
      break;
    case "sticker":
      mediaId = m.sticker?.id;
      hintedKind = "sticker";
      break;
    default:
      return [];
  }
  if (!mediaId) return [];

  const ingested = await ingestWhatsappMedia({
    mediaId,
    encryptedAccessToken: encryptedToken,
    workspaceId,
    // Usamos el wa_id del cliente como segmento de path porque acá
    // todavía no creamos la conversation row. Es estable y único
    // por sender — el inbox-writer no toca esto.
    conversationId: externalContactId,
    hintedKind,
    fileName,
  });
  if (!ingested) return [];

  const attachment: MessageAttachment = {
    url: ingested.url,
    mime_type: ingested.mediaMime,
    name: fileName,
    size: ingested.mediaSize,
  };
  return [attachment];
}
