import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/channels/admin-client";
import { csrfGuard } from "@/lib/csrf";
import {
  ACCIONES_COMENTARIO,
  moderarComentario,
  type AccionComentario,
} from "@/lib/channels/comment-actions";
import { describeMetaSendError, parseMetaError } from "@/lib/channels/meta-errors";
import { getLocale } from "@/lib/i18n/server";
import { translate } from "@/lib/i18n/translate";
import type { Conversation, Message } from "@/types";

/**
 * POST /api/messages/moderate
 * Body: { message_id: string; action: 'hide' | 'unhide' | 'delete' | 'like' | 'unlike' }
 *
 * Aplica una acción de moderación sobre un comentario de Facebook, Instagram o
 * TikTok. Es el equivalente a los botones de la interfaz de moderación de
 * business.facebook.com.
 *
 * El cuerpo —qué llamada corresponde, sobre qué conexión, y qué queda escrito
 * de este lado— vive en `lib/channels/comment-actions`, porque el Operador hace
 * exactamente lo mismo desde el chat y una segunda implementación sería una
 * segunda forma de dejar la bandeja diciendo "oculto" sobre algo visible. Acá
 * queda lo que es de una ruta: sesión, permiso y traducción del error.
 */
export async function POST(req: Request): Promise<Response> {
  const block = await csrfGuard(req);
  if (block) return block;
  const locale = await getLocale();
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json(
      { error: translate(locale, "errInbox.unauthorized") },
      { status: 401 },
    );

  const body = (await req.json().catch(() => null)) as
    | { message_id?: string; action?: AccionComentario }
    | null;
  if (
    !body?.message_id ||
    !body.action ||
    !ACCIONES_COMENTARIO.includes(body.action)
  ) {
    return NextResponse.json(
      { error: translate(locale, "errInbox.moderateMissingFields") },
      { status: 400 },
    );
  }

  const admin = supabaseAdmin();
  const { data: message } = await admin
    .from("messages")
    .select("id, conversation_id")
    .eq("id", body.message_id)
    .maybeSingle();
  if (!message) {
    return NextResponse.json(
      { error: translate(locale, "errInbox.messageNotFound") },
      { status: 404 },
    );
  }
  const { data: conv } = await admin
    .from("conversations")
    .select("workspace_id, channel")
    .eq("id", (message as Message).conversation_id)
    .maybeSingle();
  if (!conv)
    return NextResponse.json(
      { error: translate(locale, "errInbox.conversationNotFound") },
      { status: 404 },
    );

  // Permiso: modera un admin del workspace.
  const { data: membership } = await admin
    .from("workspace_members")
    .select("role")
    .eq("workspace_id", (conv as Conversation).workspace_id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!membership || (membership as { role: string }).role !== "admin") {
    return NextResponse.json(
      { error: translate(locale, "errInbox.adminOnly") },
      { status: 403 },
    );
  }

  const result = await moderarComentario(admin, {
    workspaceId: (conv as Conversation).workspace_id,
    messageId: (message as Message).id,
    accion: body.action,
    actorUserId: user.id,
  });

  if (!result.ok) {
    if (result.motivo === "no_es_comentario") {
      return NextResponse.json(
        { error: translate(locale, "errInbox.moderateOnlyComments") },
        { status: 400 },
      );
    }
    if (result.motivo === "sin_id_externo") {
      return NextResponse.json(
        { error: translate(locale, "errInbox.commentNoExternalId") },
        { status: 409 },
      );
    }
    if (result.motivo === "sin_conexion") {
      return NextResponse.json(
        { error: translate(locale, "errInbox.connectionNotFound") },
        { status: 404 },
      );
    }
    if (result.motivo === "no_existe") {
      return NextResponse.json(
        { error: translate(locale, "errInbox.messageNotFound") },
        { status: 404 },
      );
    }
    // El JSON crudo de Meta traducido a una frase ("falta aprobar el permiso")
    // en vez de volcarle el cuerpo del error a un toast.
    const parsed = parseMetaError(result.detail ?? "");
    // El canal REAL, no siempre Instagram.
    //
    // Estaba fijo en `ig_comment`, así que un fallo de Facebook se explicaba
    // como si fuera de Instagram —"Instagram comments rejected the send"— y
    // mandaba a mirar el permiso equivocado. Visto el 2026-08-30 probando la
    // moderación de un comentario de Facebook.
    const channel =
      (conv as Conversation).channel === "fb_comment" ? "fb_comment" : "ig_comment";
    const descrito = parsed
      ? describeMetaSendError(channel, 502, parsed, locale).userMessage
      : null;
    // Con lo que dijo Meta, siempre. La frase traducida sola dejaba al comercio
    // con "ocurrió un error desconocido" sobre algo que casi siempre es un
    // permiso con nombre propio: sin el código y el mensaje de Graph no hay
    // forma de saber cuál, ni de arreglarlo.
    const crudo = [
      parsed?.error?.code ? `#${parsed.error.code}` : "",
      parsed?.error?.message ?? "",
    ]
      .filter(Boolean)
      .join(" ")
      .trim();
    const messageText =
      [descrito ?? result.detail ?? translate(locale, "errInbox.graphCallFailed"), crudo]
        .filter(Boolean)
        .join(" · ")
        .slice(0, 500);
    console.error("[moderate] Meta rechazó la moderación", {
      channel,
      action: body.action,
      detail: result.detail,
    });
    return NextResponse.json({ error: messageText }, { status: 502 });
  }

  return NextResponse.json({ ok: true });
}
