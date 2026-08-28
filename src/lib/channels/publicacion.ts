import type { SupabaseClient } from "@supabase/supabase-js";
import type { ChannelConnection, Conversation } from "@/types";
import { decrypt } from "./encryption";
import { withAppsecretProof } from "./meta-graph";
import { briefDeVideo, videoDelHilo } from "./tiktok_comment/videos";

/**
 * DE QUÉ ESTÁ COLGADO ESTE COMENTARIO.
 *
 * Un comentario no le habla a una conversación: le habla a una publicación.
 * Sin ella, quien contesta —persona o agente— trabaja a ciegas: "eso también
 * es cuando se expone mucho al sol" no significa nada suelto, y significa
 * todo debajo del video que explica por qué se cae el cuello a los 40.
 *
 * En TikTok la publicación es el video, y de él se guarda además la
 * transcripción del audio (`tiktok_videos`). En Instagram y Facebook es el
 * post: su texto se resuelve UNA vez contra Graph y queda guardado en
 * `conversations.subject`, así que la segunda respuesta del mismo hilo ya no
 * pregunta nada afuera.
 *
 * Best-effort en todos los caminos: si la publicación no se puede resolver,
 * devuelve null y el prompt queda como estaba.
 */

const GRAPH = "https://graph.facebook.com/v22.0";

/**
 * Cómo se contesta ABAJO de una publicación, la escriba el agente solo o una
 * persona con el botón de generar respuesta.
 *
 * Un comentario público no es un mensaje privado: lo lee cualquiera que entre
 * al post. Dos cosas se rompen si se olvida. Vender ahí convierte la respuesta
 * en publicidad debajo de la duda de alguien —queda mal y, en TikTok, es lo
 * que la plataforma esconde—. Y pedir un dato personal en público hace que la
 * persona escriba su teléfono o su número de pedido a la vista de todos.
 */
export const REGLAS_COMENTARIO_PUBLICO = [
  'Esta respuesta va PÚBLICA debajo de una publicación: la lee cualquiera, no sólo esta persona.',
  'NO vendas. Nada de ofrecer el producto, invitar a comprar, mandar enlaces, ni mencionar precios o promociones que no preguntaron. Un comentario se contesta, no se aprovecha.',
  'Eso incluye el final del mensaje: nada de cerrar con "si quieres, el serum…", "te puede servir" ni el nombre del producto colgado al final. Si la respuesta ya está dada, se termina ahí.',
  'Nunca menciones datos personales suyos (pedido, dirección, teléfono, correo) NI se los pidas acá: si los escribe, quedan a la vista de todos. Cuando haga falta un dato, dile en media línea que le escribes por privado.',
  'Ejemplo de lo que NO se hace acá: "pasame tu número de pedido", "decime tu teléfono", "mandame tu correo". Lo que sí: "te escribo por privado y lo vemos".',
  'Una o dos frases. Nada más.',
].join(`
`);

export async function briefDePublicacion(
  db: SupabaseClient,
  conversation: Conversation,
): Promise<string | null> {
  try {
    if (conversation.channel === "tiktok_comment") {
      const videoId = videoDelHilo(
        (conversation as { thread_external_id?: string | null }).thread_external_id,
      );
      return videoId ? briefDeVideo(db, conversation.workspace_id, videoId) : null;
    }
    if (conversation.channel !== "ig_comment" && conversation.channel !== "fb_comment") {
      return null;
    }

    const guardado = (conversation.subject ?? "").trim();
    if (guardado) return bloque(guardado, conversation.channel);

    const postId = String(
      (conversation as { thread_external_id?: string | null }).thread_external_id ?? "",
    );
    if (!postId) return null;
    const texto = await textoDelPost(db, conversation, postId);
    if (!texto) return null;

    // Se guarda en el hilo: la próxima respuesta —y la bandeja, que ya muestra
    // el asunto— lo tienen sin volver a preguntarle a Meta.
    await db
      .from("conversations")
      .update({ subject: texto.slice(0, 300) })
      .eq("id", conversation.id);
    return bloque(texto, conversation.channel);
  } catch {
    return null;
  }
}

/**
 * Igual, partiendo del id del hilo: el runner conoce la conversación por id,
 * no el objeto. Una consulta más, y sólo en los canales de comentarios.
 */
export async function briefDePublicacionPorId(
  db: SupabaseClient,
  conversationId: string,
): Promise<string | null> {
  const { data } = await db
    .from("conversations")
    .select("*")
    .eq("id", conversationId)
    .maybeSingle();
  const conv = data as Conversation | null;
  return conv ? briefDePublicacion(db, conv) : null;
}

function bloque(texto: string, canal: "ig_comment" | "fb_comment"): string {
  const red = canal === "ig_comment" ? "Instagram" : "Facebook";
  return [
    "## La publicación que están comentando",
    `Este comentario está debajo de una publicación de ${red} de la tienda. La persona le habla a la PUBLICACIÓN, no a una conversación previa: si su comentario parece suelto, se entiende leyendo lo de abajo.`,
    `Texto de la publicación: ${texto.trim().slice(0, 2000)}`,
    "Sirve para entender de qué habla la persona, no como fuente de datos: los ingredientes, los precios y las promociones salen de la ficha del producto.",
  ].join("\n");
}

/** El texto del post, con el token de la conexión de comentarios. */
async function textoDelPost(
  db: SupabaseClient,
  conversation: Conversation,
  postId: string,
): Promise<string | null> {
  if (!conversation.connection_id) return null;
  const { data } = await db
    .from("channel_connections")
    .select("*")
    .eq("id", conversation.connection_id)
    .maybeSingle();
  const conn = data as ChannelConnection | null;
  if (!conn) return null;
  const secrets = (conn.secrets ?? {}) as Record<string, unknown>;
  const enc = String(secrets.access_token ?? "");
  if (!enc) return null;
  let token: string;
  try {
    token = decrypt(enc);
  } catch {
    return null;
  }

  // Instagram llama `caption` al texto; Facebook, `message`. Se piden los dos
  // y se usa el que venga — así el mismo camino sirve para las dos redes.
  const url = withAppsecretProof(
    `${GRAPH}/${postId}?fields=caption,message&access_token=${encodeURIComponent(token)}`,
    token,
  );
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) return null;
  const json = (await res.json().catch(() => ({}))) as {
    caption?: string;
    message?: string;
  };
  const texto = (json.caption ?? json.message ?? "").trim();
  return texto || null;
}
