import type { SupabaseClient } from "@supabase/supabase-js";
import type { ChannelConnection, Conversation } from "@/types";
import { decrypt } from "./encryption";
import { withAppsecretProof } from "./meta-graph";
import { briefDeVideo, videoDelHilo } from "./tiktok_comment/videos";
import { briefDeMedio } from "./publicacion-media";

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
  // La afirmación que volvía una y otra vez, redactada de mil maneras: "los
  // resultados son reales", "los testimonios son de clientas de verdad", "no
  // usamos IA". El agente no hizo la publicidad y no lo sabe, y lo que escriba
  // queda publicado debajo de la foto. Va acá y no en la instrucción de las
  // críticas porque no depende de detectar nada: vale para todo comentario.
  'NUNCA afirmes que las fotos, los testimonios, los antes y después o los resultados que se muestran son reales, ni que no se usó inteligencia artificial para hacerlos; tampoco lo niegues. Contesta igual, en primera persona: ese detalle lo confirmas y se lo pasas. Y no expliques por qué no lo sabes: nada de "no hice esa publicidad", que suena a excusa y despega a la marca de su propio anuncio.',
  'Lo mismo con registros, aprobaciones y certificados (ANMAT, INVIMA, sanitario): si el dato está en tu información, dilo; si no está, no digas que lo tiene ni que no lo tiene, y ofrécele confirmarlo tú.',
  'Nunca derives a "una persona del equipo", "alguien del equipo" ni "un agente": el equipo eres tú. Derivar es la forma elegante de no contestar.',
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

    const postId = String(
      (conversation as { thread_external_id?: string | null }).thread_external_id ?? "",
    );

    // Qué muestra la foto / qué se dice en el video. Va JUNTO al texto, no en
    // su lugar: el caption dice de qué habla el post y la imagen dice qué se
    // ve. Lo resuelve un cron aparte, así que puede no estar todavía — se
    // prefiere contestar rápido y sin la foto que hacer esperar a alguien
    // mientras se transcribe un reel.
    const medio = postId
      ? await briefDeMedio(db, {
          workspaceId: conversation.workspace_id,
          channel: conversation.channel,
          externalId: postId,
        }).catch(() => null)
      : null;

    const guardado = (conversation.subject ?? "").trim();
    if (guardado) return bloque(guardado, conversation.channel, medio);

    if (!postId) return null;
    const texto = await textoDelPost(db, conversation, postId);
    if (!texto) return null;

    // Se guarda en el hilo: la próxima respuesta —y la bandeja, que ya muestra
    // el asunto— lo tienen sin volver a preguntarle a Meta.
    await guardarTextoDePublicacion(db, {
      workspaceId: conversation.workspace_id,
      channel: conversation.channel,
      postId,
      texto,
    });
    return bloque(texto, conversation.channel, medio);
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

/**
 * Contexto del post exacto de un comentario. Instagram y Facebook agrupan
 * varios posts de la misma persona en un hilo, por lo que el id del hilo no
 * siempre representa el comentario recién recibido.
 */
export async function briefDePublicacionPorOrigen(
  db: SupabaseClient,
  args: {
    workspaceId: string;
    channel: 'ig_comment' | 'fb_comment';
    postId: string;
    connectionId?: string | null;
  },
): Promise<string | null> {
  const medio = await briefDeMedio(db, {
    workspaceId: args.workspaceId,
    channel: args.channel,
    externalId: args.postId,
  }).catch(() => null);
  const { data } = await db
    .from('publicacion_contexto')
    .select('titulo, cuerpo')
    .eq('workspace_id', args.workspaceId)
    .eq('channel', args.channel)
    .eq('external_id', args.postId)
    .maybeSingle();
  const cached = data as { titulo?: string | null; cuerpo?: string | null } | null;
  let texto = String(cached?.cuerpo ?? cached?.titulo ?? '').trim();
  if (!texto && args.connectionId) {
    texto = await textoDelPost(db, {
      workspace_id: args.workspaceId,
      channel: args.channel,
      connection_id: args.connectionId,
    } as Conversation, args.postId) ?? '';
    if (texto) {
      await guardarTextoDePublicacion(db, {
        workspaceId: args.workspaceId,
        channel: args.channel,
        postId: args.postId,
        texto,
      });
    }
  }
  if (!texto && !medio) return null;
  return bloque(texto || 'Sin texto publicado.', args.channel, medio);
}

/** Guarda el caption para todos los hilos que pertenecen al mismo post. */
export async function guardarTextoDePublicacion(
  db: SupabaseClient,
  args: {
    workspaceId: string;
    channel: 'ig_comment' | 'fb_comment';
    postId: string;
    texto: string;
  },
): Promise<void> {
  const texto = args.texto.trim();
  if (!texto || !args.postId.trim()) return;
  await Promise.all([
    db.from('publicacion_contexto').upsert({
      workspace_id: args.workspaceId,
      channel: args.channel,
      external_id: args.postId,
      titulo: texto.slice(0, 2000),
      cuerpo: texto.slice(0, 2000),
      updated_at: new Date().toISOString(),
    }, { onConflict: 'workspace_id,channel,external_id' }),
    db.from('conversations')
      .update({ subject: texto.slice(0, 300) })
      .eq('workspace_id', args.workspaceId)
      .eq('channel', args.channel)
      .eq('thread_external_id', args.postId),
  ]);
}

function bloque(
  texto: string,
  canal: "ig_comment" | "fb_comment",
  medio: string | null,
): string {
  const red = canal === "ig_comment" ? "Instagram" : "Facebook";
  return [
    "## La publicación que están comentando",
    `Este comentario está debajo de una publicación de ${red} de la tienda. La persona le habla a la PUBLICACIÓN, no a una conversación previa: si su comentario parece suelto, se entiende leyendo lo de abajo.`,
    `Texto de la publicación: ${texto.trim().slice(0, 2000)}`,
    // Qué se ve en la foto o qué se dice en el video. En Instagram esto suele
    // pesar más que el texto: el caption son tres palabras y un emoji.
    medio,
    "Sirve para entender de qué habla la persona, no como fuente de datos: los ingredientes, los precios y las promociones salen de la ficha del producto.",
    medio
      ? null
      : "No se pudo mirar la imagen ni el video del post: no supongas qué se ve en ellos.",
  ]
    .filter(Boolean)
    .join("\n");
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
