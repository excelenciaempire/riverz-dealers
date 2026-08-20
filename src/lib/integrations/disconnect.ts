/**
 * Cortar un canal, del lado del servidor.
 *
 * Hasta ahora esto era un UPDATE escrito desde el navegador (la tarjeta de
 * Ajustes → Canales juntaba los ids de la fila y los marcaba `disconnected`
 * contra Supabase). Funcionaba porque RLS acota a la cuenta de la sesión, pero
 * dejaba la operación encerrada en esa pantalla: ningún otro camino —un cron,
 * el chat agéntico, una futura pantalla de salud— podía desconectar nada sin
 * volver a escribir la misma regla de qué filas caen.
 *
 * Acá el recorte por cuenta es EXPLÍCITO y obligatorio: quien llama trae la
 * llave de servicio, que pasa por encima de RLS. Sin el `.eq('workspace_id')`
 * un canal mal escrito cortaría el de otro comercio.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Channel } from '@/types'

/**
 * Los mensajes privados y los comentarios de una misma cuenta de Meta comparten
 * UN token: el page token responde el DM y responde el comentario. Por eso la
 * tarjeta conecta las dos filas de una sola vez, y por eso también tienen que
 * caer juntas — dejar viva la fila de comentarios sobre una cuenta que el
 * comercio dio por desconectada es peor que cortar de más: seguiría contestando
 * en público en nombre de una marca que se creía desconectada.
 */
const HERMANO: Partial<Record<Channel, Channel>> = {
  messenger: 'fb_comment',
  fb_comment: 'messenger',
  instagram: 'ig_comment',
  ig_comment: 'instagram',
}

/** El canal y su hermano de comentarios, si tiene. */
export function canalesDelGrupo(channel: Channel): Channel[] {
  const h = HERMANO[channel]
  return h ? [channel, h] : [channel]
}

/** Lo que se ve de una conexión sin tocar nada secreto. */
export interface ConexionCanal {
  id: string
  channel: Channel
  label: string | null
  external_account_id: string | null
}

const COLUMNAS = 'id, channel, label, external_account_id'

/**
 * Las conexiones VIVAS del canal (y su hermano de comentarios).
 *
 * Sin las `disconnected`: la fila se conserva para poder reconectar, pero ya no
 * recibe ni envía, así que contarla como afectada haría prometer un corte que
 * no va a pasar.
 */
export async function listarConexionesDeCanal(
  db: SupabaseClient,
  workspaceId: string,
  channel: Channel,
): Promise<ConexionCanal[]> {
  const { data, error } = await db
    .from('channel_connections')
    .select(COLUMNAS)
    .eq('workspace_id', workspaceId)
    .in('channel', canalesDelGrupo(channel))
    .neq('status', 'disconnected')
    .order('created_at', { ascending: false })
  if (error) throw new Error(error.message)
  return (data ?? []) as ConexionCanal[]
}

/**
 * Marca el canal como desconectado en toda la cuenta.
 *
 * No borra la fila, a propósito: el histórico de la bandeja cuelga de ella y
 * reconectar la misma cuenta la revive en lugar de apilar un duplicado.
 *
 * Devuelve sólo lo que estaba vivo —el `neq` va también en el UPDATE— para que
 * el resultado diga qué se cortó de verdad y no repita filas que ya estaban
 * caídas de antes.
 */
export async function desconectarCanal(
  db: SupabaseClient,
  args: { workspaceId: string; channel: Channel },
): Promise<ConexionCanal[]> {
  const { data, error } = await db
    .from('channel_connections')
    .update({ status: 'disconnected' })
    .eq('workspace_id', args.workspaceId)
    .in('channel', canalesDelGrupo(args.channel))
    .neq('status', 'disconnected')
    .select(COLUMNAS)
  if (error) throw new Error(error.message)
  return (data ?? []) as ConexionCanal[]
}
