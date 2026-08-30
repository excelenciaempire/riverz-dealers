import type { SupabaseClient } from '@supabase/supabase-js'
import type { Channel, ChannelConnection } from '@/types'
import { selectAll } from '@/lib/db/paginate'

/**
 * Los estados que SIGUEN recibiendo webhooks y siguen teniendo trabajo.
 *
 * La suscripción de Meta es a nivel de app, no de token: una conexión con el
 * token vencido sigue recibiendo lo que entra, y el token no hace falta para
 * ingerir el texto. Excluir `error`/`expired` es perder mensajes reales hasta
 * que alguien reconecte a mano — que es justo lo que hacían los recorridos de
 * Gmail y Outlook, donde un buzón marcado en error no volvía nunca solo.
 *
 * Sólo quedan afuera `disconnected` (el comercio la apagó) y `pending` (a
 * medio configurar).
 */
export const ESTADOS_VIVOS = ['connected', 'error', 'expired'] as const

/**
 * Las conexiones que matchean, TODAS.
 *
 * Existe porque doce lecturas de esta tabla no paginaban, y PostgREST corta en
 * 1000 filas sin decirlo. Pasada esa marca, una conexión simplemente dejaba de
 * existir para el enrutador del webhook o para el cron que le renueva la
 * suscripción — y el síntoma parecía una cuenta mal configurada.
 */
export async function listConnections(
  db: SupabaseClient,
  opts: {
    channel?: Channel
    channels?: Channel[]
    workspaceId?: string
    /** Por defecto, {@link ESTADOS_VIVOS}. */
    statuses?: readonly string[]
    select?: string
  },
): Promise<ChannelConnection[]> {
  const statuses = opts.statuses ?? ESTADOS_VIVOS
  return selectAll<ChannelConnection>(
    db,
    'channel_connections',
    (q) => {
      let out = q
      if (opts.channel) out = out.eq('channel', opts.channel)
      if (opts.channels?.length) out = out.in('channel', opts.channels)
      if (opts.workspaceId) out = out.eq('workspace_id', opts.workspaceId)
      if (statuses.length) out = out.in('status', statuses)
      return out
    },
    { select: opts.select },
  )
}
