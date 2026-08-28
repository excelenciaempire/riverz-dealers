import type { SupabaseClient } from '@supabase/supabase-js';
import { MESSAGING_WINDOW_MS, COMMENT_WINDOW_MS } from './engagement';
import { traerTodo } from '@/lib/db/paginar';

/**
 * Cuánta gente puede REALMENTE recibir un mensaje del agente ahora mismo.
 *
 * Meta abre dos ventanas distintas y el agente usa las dos:
 *   - DM libre: 24h desde el último mensaje de la persona.
 *   - Respuesta privada a un comentario: 7 días desde el comentario.
 *
 * El número honesto no es "todos los contactos de Instagram" (una tienda con
 * meses de historial tiene cientos que hoy son inalcanzables), sino la suma de
 * ambas ventanas abiertas. Es lo que alimenta el badge de la UI y el contexto
 * que recibe el modelo, para que el plan no prometa un alcance imposible.
 */
export interface AudienceStats {
  /** Contactos de Instagram con id utilizable (histórico completo). */
  instagram_total: number;
  /** Contactables ahora mismo: DM abierto + comentario dentro de 7 días. */
  reachable_now: number;
  /** Dentro de la ventana de 24h de Meta (DM libre). */
  dm_window_24h: number;
  /** Comentaristas de los últimos 7 días (respuesta privada). */
  comment_window_7d: number;
}

export async function loadAudienceStats(
  supabase: SupabaseClient,
): Promise<AudienceStats> {
  const now = Date.now();
  const commentStart = new Date(now - COMMENT_WINDOW_MS).toISOString();

  const [{ count: total }, convs] = await Promise.all([
    supabase
      .from('contacts')
      .select('id', { count: 'exact', head: true })
      .in('channel', ['instagram', 'ig_comment'])
      .not('external_id', 'is', null),
    // Una fila por conversación de Instagram con actividad en los últimos 7
    // días; la ventana concreta se decide por canal en memoria.
    traerTodo<{ contact_id: string | null; channel: string; last_message_at: string }>(
      (d, h) =>
        supabase
          .from('conversations')
          .select('contact_id, channel, last_message_at')
          .in('channel', ['instagram', 'ig_comment'])
          .gt('last_message_at', commentStart)
          .not('contact_id', 'is', null)
          .order('last_message_at', { ascending: false })
          .range(d, h),
    ),
  ]);

  const dm = new Set<string>();
  const comment = new Set<string>();
  for (const row of (convs ?? []) as Array<{
    contact_id: string;
    channel: string;
    last_message_at: string | null;
  }>) {
    if (!row.last_message_at) continue;
    const age = now - new Date(row.last_message_at).getTime();
    if (row.channel === 'instagram') {
      if (age < MESSAGING_WINDOW_MS) dm.add(row.contact_id);
    } else if (age < COMMENT_WINDOW_MS) {
      comment.add(row.contact_id);
    }
  }
  // Quien tiene DM abierto ya está contado: no lo dupliques por comentario.
  for (const id of dm) comment.delete(id);

  return {
    instagram_total: total ?? 0,
    reachable_now: dm.size + comment.size,
    dm_window_24h: dm.size,
    comment_window_7d: comment.size,
  };
}
