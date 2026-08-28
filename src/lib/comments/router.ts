import type { SupabaseClient } from '@supabase/supabase-js';
import type { ChannelConnection } from '@/types';
import { processCommentForDmRules } from '@/lib/comment-to-dm/engine';
import { maybeInstantOutreach } from '@/lib/instagram-agent/realtime';
import { loadCommentSettings } from '@/lib/instagram-agent/controls';
import { anotarPublicacion } from '@/lib/channels/publicacion-media';

/**
 * UN solo portero para cada comentario que entra.
 *
 * Había tres caminos disparándose en paralelo sobre el mismo comentario —las
 * reglas de comentario→DM, el alcance de campaña y el piso autónomo—, cada uno
 * fire-and-forget. Funcionaba porque comparten el candado de "una sola
 * respuesta privada por comentario", pero QUIÉN atendía a la persona lo decidía
 * el azar de cuál terminaba primero: un comentario que encajaba con una regla
 * del comercio podía acabar contestado por el agente, y al revés.
 *
 * Ahora el orden es explícito y siempre el mismo:
 *
 *   1. Lo que el comercio configuró a mano (reglas por palabra clave) manda
 *      sobre lo que decida la IA. Si una regla lo atiende, se acabó.
 *   2. Si no hay regla, entra el agente: campaña activa o, si no la hay, el
 *      piso autónomo — que además filtra spam (y lo oculta) y solo escribe a
 *      quien muestra intención de compra.
 *   3. Si nada aplica, el comentario queda en la bandeja para un humano.
 *
 * Las respuestas dentro de un hilo pasan por el mismo camino: el agente lee lo
 * que ya se dijeron bajo ese post y continúa desde ahí.
 *
 * Las tres redes pasan por los dos pasos. TikTok con una diferencia que no es
 * una limitación de Riverz sino de TikTok: no tiene privado (su API de
 * mensajes está cerrada a terceros), así que ahí todo lo que se conteste se
 * publica bajo el video.
 */
/**
 * Anota la publicación para que el cron la entienda: qué muestra la foto, qué
 * se dice en el video. No espera a que termine — una respuesta no puede
 * quedarse esperando a que se transcriba un reel.
 *
 * TikTok no entra: sus videos ya tienen su propia tabla y su propio cron.
 */
async function anotarLaPublicacion(
  db: SupabaseClient,
  ev: { workspaceId: string; channel: string; postId: string | null },
): Promise<void> {
  if (ev.channel !== 'ig_comment' && ev.channel !== 'fb_comment') return;
  if (!ev.postId) return;
  await anotarPublicacion(db, {
    workspaceId: ev.workspaceId,
    channel: ev.channel,
    externalId: ev.postId,
  });
}

export async function routeComment(
  db: SupabaseClient,
  ev: {
    workspaceId: string;
    channel: 'ig_comment' | 'fb_comment' | 'tiktok_comment';
    connection: ChannelConnection;
    contact: { id: string; external_id: string | null; name: string | null };
    commentId: string | null;
    postId: string | null;
    parentCommentId: string | null;
    text: string;
  },
): Promise<void> {
  // 0. De qué habla esta persona. Se anota primero y sin esperar: la
  //    publicación se entiende en el cron, y para cuando llegue el segundo
  //    comentario del mismo post ya está lista.
  void anotarLaPublicacion(db, {
    workspaceId: ev.workspaceId,
    channel: ev.channel,
    postId: ev.postId,
  }).catch(() => {});

  // 1. Reglas del comercio.
  let handledByRule = false;
  try {
    handledByRule = await processCommentForDmRules(db, {
      workspaceId: ev.workspaceId,
      channel: ev.channel,
      connection: ev.connection,
      contact: ev.contact,
      commentId: ev.commentId,
      postId: ev.postId,
      parentCommentId: ev.parentCommentId,
      text: ev.text,
    });
  } catch (err) {
    console.error('[comment-router] regla falló:', err);
  }
  if (handledByRule) return;

  // 2. El agente. Las respuestas DENTRO de un hilo también entran: si la
  //    persona contesta nuestra respuesta, la conversación siguió y dejarla sin
  //    atender era el peor momento para callarse. El bucle lo corta el agente,
  //    que lee el hilo y respeta el tope de respuestas del comercio.
  //
  //    Cada red entra solo si el comercio la eligió arriba, en "Redes". Las
  //    reglas no pasan por acá: las escribió una persona para una red concreta
  //    y valen aunque la IA no trabaje ahí.
  const cfg = await loadCommentSettings(db, ev.workspaceId);
  const redActiva =
    ev.channel === 'fb_comment'
      ? cfg.facebook
      : ev.channel === 'tiktok_comment'
        ? cfg.tiktok
        : cfg.instagram;
  if (!redActiva) return;
  try {
    await maybeInstantOutreach(db, {
      workspaceId: ev.workspaceId,
      contact: ev.contact,
      sourcePostId: ev.postId,
      commentId: ev.commentId,
      parentCommentId: ev.parentCommentId,
      connection: ev.connection,
      engagementText: ev.text,
      commentChannel: ev.channel,
    });
  } catch (err) {
    console.error('[comment-router] agente falló:', err);
  }
}
