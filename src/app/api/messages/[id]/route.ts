import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/channels/admin-client";
import { csrfGuard } from "@/lib/csrf";
import { serverError } from "@/lib/api/errors";
import { getLocale } from "@/lib/i18n/server";
import { translate } from "@/lib/i18n/translate";
import { decrypt } from "@/lib/channels/encryption";
import { withAppsecretProof } from "@/lib/channels/meta-graph";
import { describeMetaSendError, parseMetaError } from "@/lib/channels/meta-errors";
import { puedeEditarse } from "@/lib/inbox/editable";
import { conversationPreviewFromMessage } from "@/lib/inbox/conversation-preview";
import type { ChannelConnection, Conversation, Message } from "@/types";

/**
 * DELETE /api/messages/:id
 *
 * Removes a message from the workspace inbox. This is a "delete from
 * inbox" — the platform side (Meta/WhatsApp/Gmail) is untouched
 * because most channels either don't allow programmatic delete or
 * require a separate moderation API. The conversation is left in
 * place: a delete usually means the agent misclicked, not that the
 * whole thread should disappear.
 *
 * RLS already enforces workspace membership for the messages table,
 * so we don't have to re-check workspace here — the admin client
 * call below would fail otherwise. We still verify the caller is
 * authenticated to avoid anonymous trolls hitting the endpoint.
 */
export async function DELETE(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const block = await csrfGuard(req);
  if (block) return block;
  const locale = await getLocale();
  const { id } = await ctx.params;
  if (!id) {
    return NextResponse.json(
      { error: translate(locale, "errInbox.missingIdGeneric") },
      { status: 400 },
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json(
      { error: translate(locale, "errInbox.notSignedIn") },
      { status: 401 },
    );
  }

  // Look up the message + its conversation's workspace so we can
  // confirm the caller belongs to it. RLS would also block on its own
  // but the explicit check gives a clean 403 instead of a "row not
  // found" 500.
  const admin = supabaseAdmin();
  const { data: row } = await admin
    .from("messages")
    .select("id, conversation_id, created_at, conversation:conversations(workspace_id)")
    .eq("id", id)
    .maybeSingle();
  if (!row) {
    return NextResponse.json(
      { error: translate(locale, "errInbox.notFound") },
      { status: 404 },
    );
  }
  const workspaceId = (row as { conversation?: { workspace_id?: string } })
    .conversation?.workspace_id;
  if (!workspaceId) {
    return NextResponse.json(
      { error: translate(locale, "errInbox.orphanMessage") },
      { status: 500 },
    );
  }
  const { data: membership } = await admin
    .from("workspace_members")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!membership) {
    return NextResponse.json(
      { error: translate(locale, "errInbox.forbidden") },
      { status: 403 },
    );
  }

  const { error } = await admin.from("messages").delete().eq("id", id);
  if (error) {
    return serverError(error);
  }

  // La lista no lee `messages`: usa el resumen desnormalizado que vive en la
  // conversación. Si se borró el último, hay que rebobinarlo al anterior; de
  // lo contrario la burbuja desaparece pero su texto queda en el preview.
  const deleted = row as {
    conversation_id: string;
    created_at: string;
  };
  const { data: latest, error: latestError } = await admin
    .from("messages")
    .select(
      "content_text, content_type, subject, media_type, created_at, sender_type, status, is_hidden",
    )
    .eq("conversation_id", deleted.conversation_id)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (latestError) return serverError(latestError);

  // El guard evita que una llegada concurrente más nueva sea pisada por este
  // rebobinado. Si el borrado fue de un mensaje viejo, tampoco toca el preview.
  const preview = conversationPreviewFromMessage(
    (latest as Message | null) ?? null,
  );
  const { error: previewError } = await admin
    .from("conversations")
    .update(preview)
    .eq("id", deleted.conversation_id)
    .lte("last_message_at", deleted.created_at);
  if (previewError) return serverError(previewError);

  return NextResponse.json({ ok: true, preview });
}

/**
 * PATCH /api/messages/:id  — body { text }
 *
 * Reescribe un mensaje que YA salió. Sólo donde el canal lo permite de verdad
 * (ver `puedeEditarse`): el chat web, que es nuestro, y el comentario de
 * Facebook, que Graph deja actualizar. En un comentario primero se cambia el
 * texto EN Facebook y sólo si eso sale bien se toca la fila: al revés, la
 * bandeja mostraría un texto que el público no ve.
 */
export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const block = await csrfGuard(req);
  if (block) return block;
  const locale = await getLocale();
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => null)) as { text?: string } | null;
  const texto = (body?.text ?? "").trim();
  if (!id) {
    return NextResponse.json(
      { error: translate(locale, "errInbox.missingIdGeneric") },
      { status: 400 },
    );
  }
  if (!texto) {
    return NextResponse.json(
      { error: translate(locale, "errInbox.editEmptyText") },
      { status: 400 },
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json(
      { error: translate(locale, "errInbox.notSignedIn") },
      { status: 401 },
    );
  }

  const admin = supabaseAdmin();
  const { data: row } = await admin
    .from("messages")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (!row) {
    return NextResponse.json(
      { error: translate(locale, "errInbox.notFound") },
      { status: 404 },
    );
  }
  const message = row as Message;
  if (!puedeEditarse(message)) {
    return NextResponse.json(
      { error: translate(locale, "errInbox.editNotSupported") },
      { status: 409 },
    );
  }

  const { data: conv } = await admin
    .from("conversations")
    .select("*")
    .eq("id", message.conversation_id)
    .maybeSingle();
  if (!conv) {
    return NextResponse.json(
      { error: translate(locale, "errInbox.conversationNotFound") },
      { status: 404 },
    );
  }
  const conversation = conv as Conversation;
  const { data: membership } = await admin
    .from("workspace_members")
    .select("role")
    .eq("workspace_id", conversation.workspace_id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!membership) {
    return NextResponse.json(
      { error: translate(locale, "errInbox.forbidden") },
      { status: 403 },
    );
  }

  if (message.channel === "fb_comment") {
    // Un comentario es público: cambiarlo es del mismo peso que borrarlo, así
    // que pide el mismo rol que la barra de moderación.
    if ((membership as { role: string }).role !== "admin") {
      return NextResponse.json(
        { error: translate(locale, "errInbox.adminOnly") },
        { status: 403 },
      );
    }
    if (!message.message_id) {
      return NextResponse.json(
        { error: translate(locale, "errInbox.commentNoExternalId") },
        { status: 409 },
      );
    }
    // Mismo criterio que /moderate: manda la conexión DUEÑA del comentario, no
    // la de la conversación, que puede ser de otra cuenta del mismo comercio.
    const { data: cmeta } = await admin
      .from("comments_meta")
      .select("connection_id")
      .eq("message_id", message.id)
      .maybeSingle();
    const connectionId =
      (cmeta as { connection_id?: string | null } | null)?.connection_id ??
      conversation.connection_id ??
      "";
    const { data: connection } = await admin
      .from("channel_connections")
      .select("*")
      .eq("id", connectionId)
      .maybeSingle();
    if (!connection) {
      return NextResponse.json(
        { error: translate(locale, "errInbox.connectionNotFound") },
        { status: 404 },
      );
    }
    const secrets = ((connection as ChannelConnection).secrets ?? {}) as Record<
      string,
      unknown
    >;
    const accessToken = decrypt(String(secrets.access_token ?? ""));
    const applied = await editarComentarioFacebook(
      message.message_id,
      texto,
      accessToken,
    );
    if (!applied.ok) {
      const parsed = parseMetaError(applied.detail ?? "");
      const detalle = parsed
        ? describeMetaSendError("fb_comment", 502, parsed, locale).userMessage
        : (applied.detail ?? translate(locale, "errInbox.graphCallFailed"));
      return NextResponse.json({ error: detalle }, { status: 502 });
    }
  }

  const { error } = await admin
    .from("messages")
    .update({ content_text: texto, edited_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return serverError(error);

  // La lista de conversaciones no lee la tabla de mensajes: muestra el resumen
  // que quedó
  // pegado en la conversación. Sin esto, editar el último mensaje dejaba el
  // texto viejo en la lista y el nuevo en el hilo, uno al lado del otro.
  const { data: ultimo } = await admin
    .from("messages")
    .select("id")
    .eq("conversation_id", message.conversation_id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if ((ultimo as { id?: string } | null)?.id === id) {
    await admin
      .from("conversations")
      .update({ last_message_text: texto.slice(0, 200) })
      .eq("id", message.conversation_id);
  }

  return NextResponse.json({ ok: true, text: texto });
}

/** Graph acepta pisar el texto de un comentario con POST /{comment-id}. */
async function editarComentarioFacebook(
  commentId: string,
  message: string,
  accessToken: string,
): Promise<{ ok: boolean; detail?: string }> {
  const GRAPH = "https://graph.facebook.com/v21.0";
  try {
    const res = await fetch(
      withAppsecretProof(
        `${GRAPH}/${commentId}?access_token=${encodeURIComponent(accessToken)}`,
        accessToken,
      ),
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ message }),
      },
    );
    const text = await res.text().catch(() => "");
    if (!res.ok) return { ok: false, detail: text };
    try {
      const json = JSON.parse(text) as { error?: unknown };
      if (json && typeof json === "object" && json.error) {
        return { ok: false, detail: text };
      }
    } catch {
      /* un 2xx que no es JSON (Graph devuelve `true` a veces) es éxito */
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, detail: String(err) };
  }
}
