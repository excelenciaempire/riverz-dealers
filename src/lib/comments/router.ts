import type { SupabaseClient } from '@supabase/supabase-js';
import type { ChannelConnection } from '@/types';
import { processCommentForDmRules } from '@/lib/comment-to-dm/engine';
import { maybeInstantOutreach } from '@/lib/instagram-agent/realtime';
import { loadCommentSettings } from '@/lib/instagram-agent/controls';

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
 * Solo Instagram llega al paso 2: en Facebook no existe la respuesta privada
 * por comentario que el agente necesita, así que ahí manda solo el paso 1.
 */
export async function routeComment(
  db: SupabaseClient,
  ev: {
    workspaceId: string;
    channel: 'ig_comment' | 'fb_comment';
    connection: ChannelConnection;
    contact: { id: string; external_id: string | null; name: string | null };
    commentId: string | null;
    postId: string | null;
    parentCommentId: string | null;
    text: string;
  },
): Promise<void> {
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
  //    Facebook entra solo si el comercio lo pidió. El comentario que decía
  //    "en Facebook no existe la respuesta privada por comentario" era falso —
  //    el motor de reglas lleva tiempo mandándolas por Messenger— pero dejaba
  //    a la IA muda en toda una red.
  if (ev.channel === 'fb_comment') {
    const cfg = await loadCommentSettings(db, ev.workspaceId);
    if (!cfg.facebook) return;
  }
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
