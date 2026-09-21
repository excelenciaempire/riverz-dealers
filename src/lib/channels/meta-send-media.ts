import type { OutboundMedia, SendResult } from "./types";
import type { Channel } from "@/types";
import { decrypt } from "./encryption";
import {
  handleMetaGraphError,
  clearMetaConnectionError,
  isMetaAuthWarning,
} from "./meta-auth";
import { describeMetaSendError, parseMetaError } from "./meta-errors";
import { safeLocale } from "@/lib/i18n/server";
import { withAppsecretProofBody } from "./meta-graph";
import { supabaseAdmin } from "./admin-client";
import { resolveMediaFetchUrl } from "./media-url";
import { translate } from "@/lib/i18n/translate";

/**
 * Envío de un archivo por Instagram DM o Messenger (Send API, adjunto por URL).
 *
 * Hasta ahora los dos adaptadores sólo sabían mandar texto: el agente podía
 * RECIBIR una foto del cliente pero no contestarle con una, aunque Meta lo
 * permite. Se comparte acá porque el cuerpo del request es idéntico en los dos
 * canales salvo el id del emisor.
 *
 * Meta descarga el archivo desde la URL, o sea que tiene que funcionar sin
 * nuestras cookies. El adjunto vive en un bucket privado, así que se firma
 * justo antes de armar el cuerpo del request.
 */
export async function sendMetaMedia(
  channel: Extract<Channel, "instagram" | "messenger">,
  senderId: string,
  input: OutboundMedia,
): Promise<SendResult> {
  const locale = await safeLocale();
  const secrets = (input.connection.secrets ?? {}) as Record<string, unknown>;
  const encrypted = String(secrets.access_token ?? "");
  if (!encrypted) throw new Error(`[${channel}] connection missing access_token`);
  const accessToken = decrypt(encrypted);

  // Dos formas de destinatario, igual que en el texto: la respuesta privada a
  // un comentario (`comment_id`) —única vía para mandarle algo a quien sólo
  // comentó— y el DM normal por id.
  const recipient = input.commentId
    ? { comment_id: input.commentId }
    : input.contact.external_id
      ? { id: input.contact.external_id }
      : null;
  if (!recipient) {
    throw new Error(`[${channel}] contact missing external_id`);
  }

  // Instagram no acepta documentos por DM (sí imagen, video y audio); Messenger
  // sí. Se avisa claro en vez de dejar que Meta devuelva un error críptico.
  const type = input.mediaType === "document" ? "file" : input.mediaType;
  if (channel === "instagram" && type === "file") {
    throw new Error(translate(locale, "errInbox.mediaUnsupportedInstagram"));
  }

  const graphUrl = `https://graph.facebook.com/v21.0/${senderId}/messages`;
  const post = (message: Record<string, unknown>, useHumanAgentTag: boolean): Promise<Response> =>
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
            message,
            access_token: accessToken,
          },
          accessToken,
        ),
      ),
    });
  // Meta descarga el adjunto desde el enlace, sin nuestras cookies: un adjunto
  // propio (bucket privado) tiene que ir firmado o la descarga da 400.
  const attachment = {
    attachment: {
      type,
      payload: { url: await resolveMediaFetchUrl(input.mediaUrl, input.connection.workspace_id), is_reusable: false },
    },
  };
  const send = (useHumanAgentTag: boolean): Promise<Response> =>
    post(attachment, useHumanAgentTag);

  let usedHumanAgentTag = false;
  let res = await send(false);
  let detail = res.ok ? "" : await res.text().catch(() => "");
  // Misma red de seguridad que el texto: un humano contestando fuera de la
  // ventana de 24 h reintenta una vez con la etiqueta HUMAN_AGENT (7 días).
  // Y, como allá, si el reintento también falla se conserva el error ORIGINAL:
  // el "(#10) To use 'Human Agent'…" del permiso sin aprobar no explica nada.
  // La respuesta privada a un comentario trae su propia ventana de 7 días y no
  // admite etiqueta: reintentar con HUMAN_AGENT ahí solo cambia un error por
  // otro más confuso.
  if (!res.ok && !input.commentId && input.allowHumanAgent !== false) {
    const firstErr = parseMetaError(detail);
    if (describeMetaSendError(channel, res.status, firstErr).category === "outside_window") {
      const retry = await send(true);
      if (retry.ok) {
        res = retry;
        detail = "";
        usedHumanAgentTag = true;
      } else {
        console.error(
          `[${channel}] fallback HUMAN_AGENT rechazado (${retry.status}):`,
          await retry.text().catch(() => ""),
        );
      }
    }
  }
  if (!res.ok) {
    const parsed = parseMetaError(detail);
    await handleMetaGraphError(supabaseAdmin(), input.connection, res.status, parsed);
    console.error(`[${channel}] send media failed (${res.status}): ${detail}`);
    throw new Error(describeMetaSendError(channel, res.status, parsed, locale).userMessage);
  }
  if (isMetaAuthWarning(input.connection.last_error)) {
    await clearMetaConnectionError(supabaseAdmin(), input.connection);
  }
  const json = (await res.json()) as { message_id?: string };

  // Meta no admite pie de foto junto al adjunto: el texto que escribió el
  // agente sale como un segundo mensaje en vez de perderse. Best-effort — el
  // archivo YA se envió, así que un fallo acá no invalida el envío.
  const caption = input.caption?.trim();
  if (caption) {
    try {
      // If the attachment needed HUMAN_AGENT, its caption is part of the same
      // manual reply and needs the same tag. Sending it as RESPONSE would make
      // Meta accept the image but silently drop the explanatory text.
      const capRes = await post({ text: caption }, usedHumanAgentTag);
      if (!capRes.ok) {
        console.warn(
          `[${channel}] pie de foto no enviado (${capRes.status}):`,
          await capRes.text().catch(() => ""),
        );
      }
    } catch (err) {
      console.warn(`[${channel}] pie de foto no enviado:`, err);
    }
  }
  return { externalMessageId: json.message_id, status: "sent" };
}
