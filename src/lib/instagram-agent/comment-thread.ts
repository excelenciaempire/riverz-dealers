import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * El HILO de un comentario: lo que esa persona y nosotros ya nos dijimos bajo
 * ese post.
 *
 * Un comentario no siempre es el principio de nada: la persona responde a
 * nuestra respuesta, y otra vez, y otra. Hasta ahora el agente ignoraba esas
 * respuestas (para no entrar en bucle) y, cuando contestaba, lo hacía como si
 * fuera el primer mensaje — saludando de cero a alguien con quien ya venía
 * hablando.
 *
 * La conversación de comentarios ya está agrupada por (persona, post), así que
 * el hilo es simplemente su historial. Se devuelve compacto para el prompt.
 */
export interface CommentThread {
  /** Historial listo para el prompt. */
  brief: string;
  /** Cuántas veces le respondimos ya en este hilo (freno anti-bucle). */
  ourReplies: number;
}

export async function loadCommentThread(
  db: SupabaseClient,
  contactId: string,
  postId: string | null,
  channel: 'ig_comment' | 'fb_comment' | 'tiktok_comment' = 'ig_comment',
): Promise<CommentThread | null> {
  try {
    const q = db
      .from('conversations')
      .select('id, thread_external_id')
      .eq('contact_id', contactId)
      .eq('channel', channel)
      .is('deleted_at', null)
      .order('last_message_at', { ascending: false })
      .limit(5);
    const { data: convs } = await q;
    const rows = (convs ?? []) as Array<{ id: string; thread_external_id: string | null }>;
    if (rows.length === 0) return null;
    // El hilo de ESTE post; si no lo encontramos, el más reciente.
    const conv =
      (postId ? rows.find((c) => c.thread_external_id === postId) : null) ?? rows[0];

    const { data: msgs } = await db
      .from('messages')
      .select('sender_type, content_text, created_at')
      .eq('conversation_id', conv.id)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(10);
    const list = ((msgs ?? []) as Array<{
      sender_type: string;
      content_text: string | null;
    }>)
      .filter((m) => (m.content_text ?? '').trim())
      .reverse();
    if (list.length <= 1) return null; // solo su comentario: no hay hilo todavía

    const ourReplies = list.filter((m) => m.sender_type !== 'customer').length;
    const brief = [
      'HISTORIAL DE COMENTARIOS DE ESTA PERSONA (puede incluir otros posts). El contexto de la publicación recién recibida manda; no atribuyas todos estos mensajes al mismo post. Continúa su consulta actual, no reinicies una venta si ya compró:',
      ...list.map(
        (m) =>
          `${m.sender_type === 'customer' ? 'Ella' : 'Nosotros'}: ${(m.content_text ?? '')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 200)}`,
      ),
    ].join('\n');

    return { brief, ourReplies };
  } catch {
    return null;
  }
}
