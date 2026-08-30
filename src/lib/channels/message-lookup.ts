import type { SupabaseClient } from '@supabase/supabase-js'
import type { Channel } from '@/types'

/**
 * Buscar un mensaje por el id que le puso la plataforma, SIN cruzar de comercio.
 *
 * El id externo (wamid de WhatsApp, mid de Meta, id de comentario) es único en
 * la plataforma pero NO en nuestra base: la misma página de Facebook, la misma
 * cuenta de Instagram o el mismo número pueden estar conectados en dos
 * workspaces a la vez — está soportado a propósito y el enrutador del webhook
 * entrega el evento a los dos. Entonces `.eq('message_id', …)` a secas devuelve
 * las dos filas, y peor: un UPDATE con ese filtro escribe en las dos.
 *
 * Eso pasaba en la reacción de Meta, en la reacción y el escalón de estados de
 * WhatsApp, y al marcar un comentario como oculto: una reacción del cliente de
 * un comercio aterrizaba sobre el mensaje de otro.
 *
 * PostgREST no puede filtrar un UPDATE a través de una relación embebida, que
 * es exactamente por qué esos sitios derivaron al filtro sin alcance. La salida
 * es el contrato de este módulo: **se busca acá y se devuelve `messages.id`**,
 * así que quien llama escribe por `.eq('id', …)` / `.in('id', …)` y el UPDATE
 * sin alcance deja de ser representable.
 */

export interface MessageRef {
  id: string
  conversation_id: string
}

/** Un mensaje del workspace, o null si no está (todavía) ingerido. */
export async function findMessageByExternalId<
  T extends Record<string, unknown> = Record<string, never>,
>(
  db: SupabaseClient,
  args: {
    workspaceId: string
    channel: Channel
    externalMessageId: string
    /** Columnas extra, además de `id, conversation_id`. */
    select?: string
  },
): Promise<(MessageRef & T) | null> {
  if (!args.externalMessageId) return null
  const extra = args.select ? `, ${args.select}` : ''
  const { data } = await db
    .from('messages')
    .select(`id, conversation_id${extra}, conversations!inner(workspace_id)`)
    .eq('channel', args.channel)
    .eq('message_id', args.externalMessageId)
    .eq('conversations.workspace_id', args.workspaceId)
    .limit(1)
    .maybeSingle()
  return (data as (MessageRef & T) | null) ?? null
}

/**
 * Varios de una, para los escalones de estado que llegan en lote.
 *
 * Devuelve un mapa `id externo → fila`. Los que no están simplemente no
 * aparecen: un acuse sobre un mensaje que todavía no se ingirió no es un error.
 */
export async function findMessagesByExternalIds<
  T extends Record<string, unknown> = Record<string, never>,
>(
  db: SupabaseClient,
  args: {
    workspaceId: string
    channel: Channel
    externalMessageIds: string[]
    select?: string
  },
): Promise<Map<string, MessageRef & T>> {
  const ids = [...new Set(args.externalMessageIds.filter(Boolean))]
  const out = new Map<string, MessageRef & T>()
  if (ids.length === 0) return out

  const extra = args.select ? `, ${args.select}` : ''
  const { data } = await db
    .from('messages')
    .select(`id, conversation_id, message_id${extra}, conversations!inner(workspace_id)`)
    .eq('channel', args.channel)
    .in('message_id', ids)
    .eq('conversations.workspace_id', args.workspaceId)
  for (const row of (data ?? []) as unknown as Array<
    MessageRef & T & { message_id?: string }
  >) {
    if (row.message_id) out.set(row.message_id, row)
  }
  return out
}
