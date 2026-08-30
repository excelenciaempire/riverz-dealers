import { NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "node:crypto";
import { supabaseAdmin } from "@/lib/channels/admin-client";
import { listConnections } from "@/lib/channels/connections";
import { getFreshTikTokToken } from "@/lib/channels/tiktok_comment/adapter";
import {
  ingestVideoComments,
  ingestarUnComentario,
} from "@/lib/channels/tiktok_comment/poll";
import { applyCommentLifecycle } from "@/lib/channels/comment-sync";
import { captureWebhookFailure } from "@/lib/webhooks/capture";
import type { ChannelConnection } from "@/types";

/**
 * POST /api/tiktok/webhook
 *
 * TikTok Accounts API webhook (event `comment.update`). Fires within ~5 min of
 * a comment being created, deleted, or having its visibility changed on an
 * owned video — so an action taken directly in the TikTok app is reflected in
 * the Riverz inbox (and new comments arrive without waiting for the poll).
 *
 * Body: { client_key, event, create_time, user_openid, content } where
 * `user_openid` is the account's business_id and `content` is a serialized JSON
 * with { comment_id, video_id, parent_comment_id?, comment_type, comment_action }.
 *
 * Signature: header `TikTok-Signature: t=<unix>,s=<hmac>` where the HMAC is
 * SHA-256 of `${t}.${rawBody}` keyed by the app secret (hex). Verified before
 * processing; always answers 200 so TikTok doesn't retry (processing is
 * best-effort + idempotent).
 */
export async function POST(req: Request): Promise<Response> {
  const rawBody = await req.text();
  const secret = process.env.TIKTOK_APP_SECRET ?? "";
  const sig = req.headers.get("tiktok-signature") ?? "";
  if (!secret || !verifySignature(rawBody, sig, secret)) {
    // Entrega no confiable: no se procesa, pero se guarda. Antes se descartaba
    // en silencio, y como TikTok recibe 200 igual, un secreto mal puesto o un
    // cambio de formato de la firma se veia EXACTAMENTE igual que "TikTok no
    // manda nada": comentarios que llegaban tarde por el poll y nadie sabia
    // por que. Queda en webhook_events_raw, que es donde se mira.
    await captureWebhookFailure({
      provider: "tiktok",
      rawBody,
      signature: sig || null,
      error: secret ? "firma invalida" : "falta TIKTOK_APP_SECRET",
    });
    return NextResponse.json({ ok: false });
  }

  // Rastro de que TikTok SI entrego. Es la unica forma de distinguir "el
  // webhook no llega" de "el webhook llega y algo falla despues".
  const entrega = await registrarEntrega(rawBody, sig);

  let payload: {
    event?: string;
    user_openid?: string;
    content?: string;
  };
  try {
    payload = JSON.parse(rawBody);
  } catch {
    await cerrarEntrega(entrega, "cuerpo ilegible");
    return NextResponse.json({ ok: true });
  }
  if (payload.event !== "comment.update" || !payload.user_openid) {
    await cerrarEntrega(entrega, `evento ignorado: ${payload.event ?? "?"}`);
    return NextResponse.json({ ok: true });
  }

  let content: {
    comment_id?: string | number;
    video_id?: string | number;
    parent_comment_id?: string | number;
    comment_type?: string;
    comment_action?: string;
  };
  try {
    content = JSON.parse(payload.content ?? "{}");
  } catch {
    await cerrarEntrega(entrega, "content ilegible");
    return NextResponse.json({ ok: true });
  }
  const commentId = String(content.comment_id ?? "");
  const videoId = String(content.video_id ?? "");
  const action = String(content.comment_action ?? "");
  if (!commentId || !action) {
    await cerrarEntrega(entrega, "sin comment_id o comment_action");
    return NextResponse.json({ ok: true });
  }

  const db = supabaseAdmin();
  const businessId = String(payload.user_openid);
  // Every connection that holds this account (same account can live in more
  // than one workspace — each reflects the change in its own inbox).
  const conns = (
    await listConnections(db, { channel: "tiktok_comment" })
  ).filter(
    (c) => String((c.config as Record<string, unknown> | null)?.business_id ?? "") === businessId,
  );
  if (conns.length === 0) {
    await cerrarEntrega(entrega, `sin conexion para business_id ${businessId}`);
    return NextResponse.json({ ok: true });
  }

  let fallo: string | null = null;
  for (const conn of conns) {
    try {
      await applyToConnection(db, conn, { commentId, videoId, action });
    } catch (err) {
      console.error("[tiktok/webhook] apply failed:", err);
      fallo = err instanceof Error ? err.message : String(err);
    }
  }
  await cerrarEntrega(entrega, fallo);
  return NextResponse.json({ ok: true });
}

/** Deja la entrega anotada apenas se verifica la firma y devuelve su id. */
async function registrarEntrega(rawBody: string, sig: string): Promise<string | null> {
  try {
    const { data } = await supabaseAdmin()
      .from("webhook_events_raw")
      .insert({ provider: "tiktok", raw_body: rawBody.slice(0, 100_000), signature: sig || null })
      .select("id")
      .maybeSingle();
    return (data as { id?: string } | null)?.id ?? null;
  } catch {
    return null; // el rastro no puede tumbar la entrega
  }
}

/** Cierra la entrega: procesada, o procesada con error. */
async function cerrarEntrega(id: string | null, error: string | null): Promise<void> {
  if (!id) return;
  try {
    await supabaseAdmin()
      .from("webhook_events_raw")
      .update({ processed_at: new Date().toISOString(), last_error: error?.slice(0, 1000) ?? null })
      .eq("id", id);
  } catch {
    /* best-effort */
  }
}

async function applyToConnection(
  db: ReturnType<typeof supabaseAdmin>,
  conn: ChannelConnection,
  ev: { commentId: string; videoId: string; action: string },
): Promise<void> {
  const workspaceId = conn.workspace_id;

  if (ev.action === "delete") {
    await applyCommentLifecycle(db, {
      channel: "tiktok_comment",
      workspaceId,
      commentExternalId: ev.commentId,
      kind: "delete",
    });
    return;
  }
  if (ev.action === "set_to_hidden" || ev.action === "set_to_friends_only") {
    await applyCommentLifecycle(db, {
      channel: "tiktok_comment",
      workspaceId,
      commentExternalId: ev.commentId,
      kind: "hide",
    });
    return;
  }
  if (ev.action === "set_to_public") {
    await applyCommentLifecycle(db, {
      channel: "tiktok_comment",
      workspaceId,
      commentExternalId: ev.commentId,
      kind: "unhide",
    });
    return;
  }
  if (ev.action !== "insert" || !ev.videoId) return;

  // Si el poll se adelanto no hay nada que hacer.
  const { data: existing } = await db
    .from("messages")
    .select("id, conversations!inner(workspace_id)")
    .eq("message_id", ev.commentId)
    .eq("channel", "tiktok_comment")
    .eq("conversations.workspace_id", workspaceId)
    .maybeSingle();
  if (existing) return;

  const cfg = (conn.config ?? {}) as Record<string, unknown>;
  const businessId = String(cfg.business_id ?? "");
  if (!businessId) return;
  let token: string;
  try {
    token = await getFreshTikTokToken(conn);
  } catch {
    return; // el poll lo recuperara
  }

  // PRIMERO el comentario que llegó, y recién después el resto del video.
  //
  // Antes esto ingería el video ENTERO y esperaba: hasta 20 páginas, más una
  // llamada por las respuestas de cada comentario y otra por su estado. En un
  // video con 17 comentarios son decenas de llamadas encadenadas antes de que
  // el agente vea el comentario nuevo. Medido el 2026-08-27: el webhook entregó
  // 22:56:48 y la respuesta salió 23:00:25 — tres minutos y medio, ninguno de
  // TikTok.
  //
  // La lectura completa sigue siendo necesaria (las respuestas anidadas, lo
  // que el comercio contestó desde la app, los comentarios de solo sticker),
  // pero nadie tiene que esperarla: es idempotente y corre detrás.
  const rapido = await ingestarUnComentario(
    db,
    conn,
    businessId,
    token,
    ev.videoId,
    ev.commentId,
  ).catch(() => false);

  const completo = ingestVideoComments(db, conn, businessId, token, ev.videoId).catch(
    (err) => {
      console.error("[tiktok/webhook] ingesta completa falló:", err);
      return 0;
    },
  );
  // Si el camino rápido no lo encontró —una respuesta anidada dentro de un
  // hilo largo— hay que esperar al completo, que es el único que las ve.
  if (!rapido) await completo;
}

/** Verifica `TikTok-Signature: t=<unix>,s=<hmac>`. HMAC-SHA256 de `${t}.${body}`
 *  con el app secret (hex). Rechaza timestamps de más de 10 min (anti-replay). */
function verifySignature(rawBody: string, header: string, secret: string): boolean {
  if (!header) return false;
  const parts: Record<string, string> = {};
  for (const seg of header.split(",")) {
    const [k, v] = seg.split("=");
    if (k && v) parts[k.trim()] = v.trim();
  }
  const t = parts.t;
  const s = parts.s;
  if (!t || !s) return false;
  const expected = createHmac("sha256", secret).update(`${t}.${rawBody}`).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(s);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return false;
  const ageSec = Math.abs(Date.now() / 1000 - Number(t));
  return Number.isFinite(ageSec) && ageSec < 600;
}
