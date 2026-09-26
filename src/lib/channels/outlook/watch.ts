/**
 * Microsoft Graph change-notification subscriptions for Outlook
 * mailboxes — the push equivalent of Gmail's Pub/Sub watch. Without
 * this, Outlook would only flow into the inbox on the 5-minute poll
 * cron; with it the latency drops to single-digit seconds.
 *
 * Subscriptions on `/me/mailFolders('inbox')/messages` have a 3-day
 * maximum lifetime; we renew every ~2 days via a separate cron (see
 * `/api/cron/outlook-watch`).
 *
 * Required env:
 *   - OUTLOOK_PUSH_CLIENT_STATE  — shared secret echoed in every
 *     notification so the receiver can confirm it really came from
 *     Graph. Generate a long random string and store in Render.
 *   - The deployed app's public URL is derived from request origin at
 *     creation time, so no separate URL env is needed.
 */

import crypto from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ChannelConnection, MessageAttachment } from "@/types";
import { decrypt, encrypt } from "../encryption";
import { savePollState } from "../poll-state";
import { pedirAlProveedor } from "../email/falla-transitoria";
import {
  ingestRawMedia,
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENTS_PER_MESSAGE,
} from "../media-ingest";

const GRAPH_API = "https://graph.microsoft.com/v1.0";
const OAUTH_TOKEN_URL = "https://login.microsoftonline.com/common/oauth2/v2.0/token";

/**
 * Create or refresh a Graph push subscription for one Outlook
 * connection. If a subscription_id is already stored, this PATCHes its
 * expirationDateTime instead of creating a new one — cheaper and keeps
 * the existing subscription id stable.
 */
export async function startOutlookWatch(
  admin: SupabaseClient,
  connection: ChannelConnection,
  notificationUrl: string,
): Promise<{ subscriptionId?: string; expiration?: string; error?: string }> {
  const clientState = process.env.OUTLOOK_PUSH_CLIENT_STATE;
  if (!clientState) {
    return { error: "OUTLOOK_PUSH_CLIENT_STATE not set" };
  }

  const accessToken = await getFreshAccessToken(admin, connection);
  if (!accessToken) return { error: "no access token" };

  const cfg = (connection.config ?? {}) as Record<string, unknown>;
  const existingId = cfg.subscription_id ? String(cfg.subscription_id) : "";

  // Huella de CON QUÉ se creó la suscripción (URL de aviso + secreto). Graph
  // no devuelve el clientState al consultarla, así que sin esto no hay forma
  // de saber si la que está viva sigue coincidiendo con la configuración
  // actual.
  //
  // Importa porque el camino de renovación de abajo hace PATCH solo de
  // `expirationDateTime`: ni la URL ni el secreto se reescriben nunca. Si el
  // dominio cambia o se rota OUTLOOK_PUSH_CLIENT_STATE, la suscripción sigue
  // reportándose sana e indefinidamente renovada mientras Graph avisa a la
  // dirección vieja —o con el secreto viejo, y entonces el adaptador tira cada
  // aviso al comparar. El correo pasa a entrar solo por el sondeo y el retraso
  // parece inexplicable. Fue exactamente lo que pasó aquí.
  //
  // Sin huella guardada (toda suscripción anterior a este cambio) también se
  // recrea: es la única manera de garantizar que la viva es la correcta, y
  // ocurre una sola vez por buzón.
  const fingerprint = crypto
    .createHash("sha256")
    .update(`${notificationUrl}\n${clientState}`)
    .digest("hex")
    .slice(0, 16);
  const storedFingerprint = cfg.subscription_fingerprint
    ? String(cfg.subscription_fingerprint)
    : "";
  const drifted = existingId && storedFingerprint !== fingerprint;

  if (drifted) {
    // Borrar antes de crear: Graph limita las suscripciones por buzón y una
    // huérfana apuntando a la dirección vieja seguiría recibiendo avisos.
    await fetch(`${GRAPH_API}/subscriptions/${existingId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${accessToken}` },
    }).catch(() => {});
  }

  // Graph max for /messages is 3 days from now (4230 minutes), but
  // subscriptions also can't extend beyond 3 days from creation. We
  // request 2d 22h to leave headroom for clock drift and renew jitter.
  const expirationDateTime = new Date(
    Date.now() + (2 * 24 + 22) * 60 * 60 * 1000,
  ).toISOString();

  let res: Response;
  if (existingId && !drifted) {
    res = await fetch(`${GRAPH_API}/subscriptions/${existingId}`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ expirationDateTime }),
    });
    if (res.status === 404) {
      // Subscription was deleted (expired beyond grace, revoked, etc).
      // Fall through to creation below.
      res = await createSubscription(accessToken, notificationUrl, clientState, expirationDateTime);
    }
  } else {
    res = await createSubscription(accessToken, notificationUrl, clientState, expirationDateTime);
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    return { error: `subscriptions ${res.status}: ${detail}` };
  }
  const j = (await res.json()) as { id?: string; expirationDateTime?: string };

  // Mezclado contra la fila actual: escribir `{ ...config de la foto }` pisaba
  // el progreso que el poll guardó mientras tanto (el historial volvía a
  // empezar).
  try {
    await savePollState(
      admin,
      connection.id,
      {
        subscription_id: j.id,
        subscription_expiration: j.expirationDateTime,
        subscription_fingerprint: fingerprint,
      },
      null,
      { complete: false },
    );
  } catch (err) {
    return {
      subscriptionId: j.id,
      expiration: j.expirationDateTime,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  return { subscriptionId: j.id, expiration: j.expirationDateTime };
}

async function createSubscription(
  accessToken: string,
  notificationUrl: string,
  clientState: string,
  expirationDateTime: string,
): Promise<Response> {
  return fetch(`${GRAPH_API}/subscriptions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      changeType: "created",
      notificationUrl,
      resource: "/me/mailFolders('inbox')/messages",
      expirationDateTime,
      clientState,
    }),
  });
}

export async function getFreshAccessToken(
  admin: SupabaseClient,
  connection: ChannelConnection,
): Promise<string | null> {
  const secrets = (connection.secrets ?? {}) as Record<string, unknown>;
  const encAccess = String(secrets.access_token ?? "");
  const encRefresh = String(secrets.refresh_token ?? "");
  if (!encAccess) return null;

  const expiresAt = secrets.access_token_expires_at
    ? new Date(String(secrets.access_token_expires_at)).getTime()
    : 0;
  if (expiresAt && expiresAt - 60_000 > Date.now()) return decrypt(encAccess);
  if (!encRefresh) return decrypt(encAccess);

  const clientId = process.env.MICROSOFT_CLIENT_ID;
  const clientSecret = process.env.MICROSOFT_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;

  const refreshToken = decrypt(encRefresh);
  const r = await fetch(OAUTH_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      scope: "offline_access Mail.ReadWrite Mail.Send User.Read",
    }).toString(),
  });
  if (!r.ok) return null;
  const j = (await r.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
  };
  const fresh = j.access_token;
  if (!fresh) return null;

  const newSecrets: Record<string, unknown> = {
    ...secrets,
    access_token: encrypt(fresh),
    access_token_expires_at: new Date(
      Date.now() + Number(j.expires_in ?? 3600) * 1000,
    ).toISOString(),
  };
  if (j.refresh_token) newSecrets.refresh_token = encrypt(j.refresh_token);

  await admin
    .from("channel_connections")
    .update({ secrets: newSecrets })
    .eq("id", connection.id);
  return fresh;
}

/**
 * Fetch a single message by Graph id and turn it into the InboundEvent
 * shape the inbox-writer expects. Reused from the notification handler
 * and any future backfill code.
 */
export async function fetchOutlookMessage(
  accessToken: string,
  graphMessageId: string,
): Promise<GraphMessageFull | null> {
  const u = new URL(`${GRAPH_API}/me/messages/${graphMessageId}`);
  u.searchParams.set(
    "$select",
    "id,internetMessageId,conversationId,from,toRecipients,subject,bodyPreview,body,receivedDateTime,isRead,hasAttachments,internetMessageHeaders",
  );
  const r = await fetch(u.toString(), {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!r.ok) return null;
  return (await r.json()) as GraphMessageFull;
}

export interface GraphMessageFull {
  id: string;
  internetMessageId?: string;
  conversationId?: string;
  from?: { emailAddress?: { name?: string; address?: string } };
  toRecipients?: { emailAddress?: { address?: string } }[];
  subject?: string;
  bodyPreview?: string;
  body?: { contentType?: string; content?: string };
  receivedDateTime?: string;
  isRead?: boolean;
  hasAttachments?: boolean;
  internetMessageHeaders?: { name: string; value: string }[];
}

/**
 * Download a message's file attachments (the customer emailed a photo,
 * PDF, …) and re-host them in Storage. Graph returns fileAttachment
 * bytes inline as base64 `contentBytes`. Skips inline images (signature
 * logos) and non-file attachment types. Best-effort per file.
 *
 * Un 429/5xx o una caída de red LANZA en vez de devolver la lista vacía. Si
 * no, el correo quedaba guardado sin su archivo y, como ya existe, ninguna
 * pasada lo volvía a pedir. Lanzando, no se guarda: en el aviso de Graph el
 * error se registra y el poll lo trae completo; en el poll la corrida no
 * guarda el cursor y la siguiente lo repite.
 */
export async function fetchOutlookAttachments(
  accessToken: string,
  graphMessageId: string,
  workspaceId: string,
  convKey: string,
): Promise<MessageAttachment[]> {
  const r = await pedirAlProveedor(
    `${GRAPH_API}/me/messages/${graphMessageId}/attachments`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
    "attachments.list",
  );
  if (!r.ok) return [];
  const j = (await r.json()) as {
    value?: Array<{
      "@odata.type"?: string;
      id?: string;
      name?: string;
      contentType?: string;
      size?: number;
      contentBytes?: string;
      isInline?: boolean;
    }>;
  };
  const out: MessageAttachment[] = [];
  for (const a of j.value ?? []) {
    if (out.length >= MAX_ATTACHMENTS_PER_MESSAGE) break;
    if (a["@odata.type"] !== "#microsoft.graph.fileAttachment") continue;
    if (a.isInline || !a.contentBytes) continue;
    // Descartar por tamaño declarado antes de decodificar.
    if (a.size && a.size > MAX_ATTACHMENT_BYTES) continue;
    try {
      const buffer = Buffer.from(a.contentBytes, "base64");
      const ingested = await ingestRawMedia({
        buffer,
        mime: a.contentType || "application/octet-stream",
        workspaceId,
        conversationId: convKey,
        id: `${graphMessageId}-${a.id ?? out.length}`.slice(0, 120),
        fileName: a.name,
      });
      if (!ingested) continue;
      out.push({
        url: ingested.url,
        mime_type: ingested.mediaMime,
        name: a.name,
        size: ingested.mediaSize,
      });
    } catch {
      /* skip this attachment */
    }
  }
  return out;
}
