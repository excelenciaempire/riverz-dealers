import type { SupabaseClient } from "@supabase/supabase-js";
import type { ChannelConnection, Conversation } from "@/types";
import type { InboundEvent } from "./types";

/**
 * La respuesta que el comercio escribe DESDE Instagram / Facebook.
 *
 * Para la bandeja es un mensaje SALIENTE del hilo de quien comentó, pero
 * llegaba por el mismo webhook que los comentarios de clientes y con `from` =
 * nuestra propia cuenta, así que el filtro de "nunca ingerir nuestra cuenta
 * como cliente" la descartaba. Resultado: el hilo mostraba la pregunta del
 * cliente y ninguna respuesta, como si nadie hubiera contestado — aunque en
 * Instagram sí estuviera contestada.
 *
 * A qué hilo pertenece se deduce del comentario PADRE: buscamos el mensaje ya
 * guardado con ese id externo y usamos su conversación. Un comentario suelto
 * del negocio en su propio post (sin padre) no es respuesta a nadie → se
 * ignora, como antes.
 *
 * Los duplicados no son un problema: `ingestInboundEvent` corta por id externo
 * de mensaje, así que una respuesta enviada desde Riverz —que ya guardó su
 * fila con ese id— nunca se duplica; solo sobreviven las escritas por fuera.
 */
export async function buildSelfCommentEvent(
  db: SupabaseClient,
  input: {
    channel: "ig_comment" | "fb_comment";
    connection: ChannelConnection;
    /** Id externo de NUESTRA respuesta. */
    commentId: string;
    /** Id externo del comentario al que responde. Sin esto no hay hilo. */
    parentCommentId?: string | null;
    postId?: string | null;
    text: string;
    receivedAt: string;
  },
): Promise<InboundEvent | null> {
  const commentId = input.commentId.trim();
  const parentId = (input.parentCommentId ?? "").trim();
  if (!commentId || !parentId) return null;

  const conversation = await conversationOfComment(db, {
    channel: input.channel,
    workspaceId: input.connection.workspace_id,
    commentExternalId: parentId,
  });
  if (!conversation) return null;

  const { data: contact } = await db
    .from("contacts")
    .select("external_id")
    .eq("id", conversation.contact_id)
    .maybeSingle();
  const externalContactId = (contact as { external_id?: string | null } | null)?.external_id;
  if (!externalContactId) return null;

  return {
    channel: input.channel,
    connection: input.connection,
    externalContactId: String(externalContactId),
    externalMessageId: commentId,
    text: input.text,
    comment: {
      postId: input.postId ? String(input.postId) : undefined,
      parentCommentId: parentId,
    },
    receivedAt: input.receivedAt,
    outbound: true,
  };
}

/**
 * Conversación (del workspace) en la que vive un comentario ya guardado,
 * buscado por su id externo. Sirve tanto si el padre es el comentario del
 * cliente como si es otra respuesta nuestra dentro del mismo hilo.
 */
async function conversationOfComment(
  db: SupabaseClient,
  input: { channel: "ig_comment" | "fb_comment"; workspaceId: string; commentExternalId: string },
): Promise<Conversation | null> {
  const { data: rows } = await db
    .from("messages")
    .select("conversation_id")
    .eq("channel", input.channel)
    .eq("message_id", input.commentExternalId)
    .order("created_at", { ascending: false })
    .limit(5);
  const convIds = ((rows ?? []) as Array<{ conversation_id: string | null }>)
    .map((r) => r.conversation_id)
    .filter((id): id is string => Boolean(id));
  if (convIds.length === 0) return null;

  // El mismo id externo puede existir en dos workspaces (la misma cuenta de
  // Instagram conectada dos veces): nos quedamos SOLO con el nuestro.
  const { data: convs } = await db
    .from("conversations")
    .select("*")
    .in("id", convIds)
    .eq("workspace_id", input.workspaceId)
    .is("deleted_at", null)
    .limit(1);
  return ((convs ?? [])[0] as Conversation | undefined) ?? null;
}
