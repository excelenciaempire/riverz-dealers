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

/**
 * Cuándo fue la última vez que ESTA conexión recibió algo POR PUSH.
 *
 * Es el dato que falta para poder bajarle la frecuencia a un recorrido
 * periódico sin adivinar. Hoy la pregunta "¿el webhook está llegando?" sólo se
 * puede contestar mirando si aparecen mensajes — y eso no distingue "no llega
 * el webhook" de "no escribió nadie", que es exactamente el error que dejó la
 * suscripción de Meta apuntando a un dominio muerto durante seis días.
 *
 * Se escribe desde los RECEPTORES, no desde la ingesta: el receptor es lo único
 * que sabe que esto vino por push y no por un recorrido. Una sola escritura por
 * entrega, no por evento.
 */
const ultimoSello = new Map<string, number>();
/** Cada cuánto se escribe, como mucho. Para el tablero alcanza de sobra. */
const CADA_MS = 5 * 60_000;

export function sellarEntregaPorPush(
  db: SupabaseClient,
  connectionId: string | null | undefined,
): void {
  if (!connectionId) return;
  const ahora = Date.now();
  const previo = ultimoSello.get(connectionId) ?? 0;
  if (ahora - previo < CADA_MS) return;
  ultimoSello.set(connectionId, ahora);
  // Sin await y sin romper nada: es telemetría, y el mensaje que viene detrás
  // importa más.
  void (async () => {
    try {
      const { data } = await db
        .from('channel_connections')
        .select('config')
        .eq('id', connectionId)
        .maybeSingle();
      const cfg = ((data as { config?: Record<string, unknown> } | null)?.config ??
        {}) as Record<string, unknown>;
      await db
        .from('channel_connections')
        .update({ config: { ...cfg, last_push_at: new Date(ahora).toISOString() } })
        .eq('id', connectionId);
    } catch {
      /* el sello no puede tumbar la entrega */
    }
  })();
}
