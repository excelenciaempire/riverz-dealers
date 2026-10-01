import type { SupabaseClient } from '@supabase/supabase-js';
import type { ChannelConnection } from '@/types';
import { processCommentForDmRules } from '@/lib/comment-to-dm/engine';
import { maybeInstantOutreach } from '@/lib/instagram-agent/realtime';
import { loadCommentSettings } from '@/lib/instagram-agent/controls';
import { anotarPublicacion } from '@/lib/channels/publicacion-media';
import { loadCommentConversation, type CommentChannel } from '@/lib/comments/hilo';
import { puedeAtenderContacto } from '@/lib/billing/contact-cap';
import { aplicarDesenlace } from '@/lib/ai/desenlace';
import { motorApagado } from '@/lib/workspaces/motor';
import { puertaDelPiloto } from '@/lib/piloto';
import { loadRevitalyWhatsAppPolicy } from '@/lib/ai/revitaly-whatsapp-policy';

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
  // Historical tombstones are not new comments and cannot be moderated/replied to.
  if (ev.text.trim() === '[deleted]') return;
  // 0. De qué habla esta persona. La fila debe existir antes de resolver el
  //    caption: si ambas operaciones corren a la vez, el texto puede intentar
  //    actualizar una fila que todavía no existe y el agente queda a ciegas.
  await anotarLaPublicacion(db, {
    workspaceId: ev.workspaceId,
    channel: ev.channel,
    postId: ev.postId,
  }).catch(() => {});

  // Motor apagado —la instalación espera aprobación, o la cuenta está
  // suspendida—: ni las reglas ni la IA contestan. Este camino no pasa por el
  // runner ni por el motor de automatizaciones, así que tiene que preguntarlo
  // él: con el motor apagado y "Responder con IA" encendido, los comentarios
  // salían igual.
  if (await motorApagado(db, ev.workspaceId)) {
    await registrarSkipDeComentario(db, ev, 'motor_apagado');
    return;
  }

  // Piloto en vivo: con "sólo estos números" no sale ningún comentario (quien
  // comenta no trae teléfono), y un piloto agotado o sin este canal tampoco.
  // El cupo se descuenta más adelante, cuando ya se decidió contestar.
  const piloto = await puertaDelPiloto(db, {
    workspaceId: ev.workspaceId,
    tipo: 'comentario',
    canal: ev.channel,
    reservar: false,
  });
  if (!piloto.permitido) {
    await registrarSkipDeComentario(db, ev, piloto.motivo);
    return;
  }

  // 1. Reglas del comercio.
  let handledByRule = false;
  const centralizeWhatsApp = await loadRevitalyWhatsAppPolicy(db, ev.workspaceId, ev.channel);
  try {
    handledByRule = centralizeWhatsApp ? false : await processCommentForDmRules(db, {
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
  if (!redActiva) {
    // Sin fila, "no contesto" no tiene respuesta ni mirando la base. Y este es
    // el caso mas frecuente: `comment_facebook` nace apagado, asi que un
    // comercio que espera respuestas en Facebook ve silencio y nada mas.
    await registrarSkipDeComentario(db, ev, 'comment_red_apagada');
    return;
  }
  if (!(await puedeAtenderContacto(db, ev.workspaceId, ev.contact.id))) {
    await registrarSkipDeComentario(db, ev, 'cupo_contactos');
    return;
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

/**
 * Por qué este comentario no se contestó, cuando la decisión se toma ANTES de
 * llegar al piso autónomo.
 *
 * `registrarSkipComentario` vive dentro de `realtime` y necesita su contexto;
 * acá alcanza con el hilo de esa persona en esa red. Best-effort: la
 * telemetría no puede tumbar el camino que observa.
 */
async function registrarSkipDeComentario(
  db: SupabaseClient,
  ev: { workspaceId: string; channel: CommentChannel; contact: { id: string } },
  motivo: string,
): Promise<void> {
  try {
    const hilo = await loadCommentConversation(db, {
      workspaceId: ev.workspaceId,
      contactId: ev.contact.id,
      channel: ev.channel,
    });
    if (!hilo) return;
    await db.from('ai_replies').insert({
      workspace_id: ev.workspaceId,
      conversation_id: hilo.id,
      agent_id: null,
      status: 'skipped',
      skip_reason: motivo,
    });
    if (motivo === 'cupo_contactos') await aplicarDesenlace(db, hilo.id, motivo);
  } catch (err) {
    console.error('[comentarios] no se pudo registrar el motivo:', motivo, err);
  }
}
