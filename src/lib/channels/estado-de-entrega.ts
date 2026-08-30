import type { SupabaseClient } from '@supabase/supabase-js'
import type { Channel } from '@/types'
import { findMessagesByExternalIds } from './message-lookup'

/**
 * El escalón por el que sube un mensaje que sale: enviado → entregado → leído.
 *
 * SÓLO HACIA ADELANTE. Meta entrega los tres como eventos separados y el
 * webhook los procesa en paralelo, así que sin este freno un `sent` que termina
 * tarde pisa el `delivered` que ya había llegado y el mensaje se queda en una
 * raya para siempre. El `.in(...)` hace que la regresión no encuentre fila.
 *
 * `sending` es el estado optimista del compositor y es el peldaño cero.
 */
export const ESCALON = ['sent', 'delivered', 'read'] as const
export type EstadoDeEntrega = (typeof ESCALON)[number]

export function rangoDeEstado(estado: string): number {
  return (ESCALON as readonly string[]).indexOf(estado)
}

/** Los estados desde los que SÍ se puede avanzar a `estado`. */
export function desdeDonde(estado: string): string[] {
  const rango = rangoDeEstado(estado)
  if (rango < 0) return []
  return ['sending', ...ESCALON.slice(0, rango)]
}

/**
 * Sube de escalón los mensajes que la plataforma dice que llegaron.
 *
 * Dos formas de decirlo, y Meta usa las dos:
 *
 *   - **Por id**: `delivery.mids` trae los mensajes concretos.
 *   - **Por marca de tiempo**: `watermark` significa "todo lo que te mandé
 *     antes de este instante". Los acuses de LECTURA vienen casi siempre así,
 *     sin ningún id, y por eso no alcanza con la vía de arriba.
 *
 * Devuelve cuántas filas cambió, para poder distinguir "no llegó el evento" de
 * "llegó y no encontró a qué mensaje aplicarlo".
 */
export async function marcarEntrega(
  db: SupabaseClient,
  input: {
    workspaceId: string
    channel: Channel
    estado: EstadoDeEntrega
    /** Ids externos concretos, cuando la plataforma los da. */
    externalMessageIds?: string[]
    /** Milisegundos: todo lo saliente anterior a esto llegó. */
    watermarkMs?: number
    /** El hilo, para acotar la marca de tiempo a UNA conversación. */
    conversationId?: string
  },
): Promise<number> {
  const anteriores = desdeDonde(input.estado)
  if (anteriores.length === 0) return 0
  const parche: Record<string, unknown> = { status: input.estado }
  // Entrega confirmada: se caen las marcas de "no confirmada" y de retención.
  parche.delivery_unconfirmed_at = null

  const ids = (input.externalMessageIds ?? []).filter(Boolean)
  if (ids.length > 0) {
    const filas = await findMessagesByExternalIds(db, {
      workspaceId: input.workspaceId,
      channel: input.channel,
      externalMessageIds: ids,
    })
    if (filas.size === 0) return 0
    const { data } = await db
      .from('messages')
      .update(parche)
      .in('id', [...filas.values()].map((f) => f.id))
      .in('status', anteriores)
      .select('id')
    return (data ?? []).length
  }

  if (!input.watermarkMs || !input.conversationId) return 0
  // Por marca de tiempo, dentro de UNA conversación: el `watermark` de Meta es
  // por hilo, no global. Sin acotar, un acuse de lectura de una persona daría
  // por leídos los mensajes de todas.
  const { data } = await db
    .from('messages')
    .update(parche)
    .eq('conversation_id', input.conversationId)
    .in('sender_type', ['agent', 'bot'])
    .lte('created_at', new Date(input.watermarkMs).toISOString())
    .in('status', anteriores)
    .select('id')
  return (data ?? []).length
}
