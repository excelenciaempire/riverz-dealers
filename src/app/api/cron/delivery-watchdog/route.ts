import { NextResponse } from 'next/server'
import { serverError } from '@/lib/api/errors'
import { assertCronAuth } from '@/lib/auth/cron'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { pingCron } from '@/lib/cron/heartbeat'

/**
 * Watchdog de entrega de WhatsApp.
 *
 * Problema: Meta a veces NUNCA manda 'delivered' ni 'failed' — el mensaje se
 * queda en 'sent' para siempre (TTL-drop, pausa de marketing a EE.UU., número
 * no alcanzable). Sin nada que lo detecte, el comercio cree que llegó. La doc
 * oficial dice explícitamente: "si no recibís un webhook 'delivered' antes de
 * que venza el TTL, asumí que el mensaje se descartó".
 *
 * Este barrido marca `delivery_unconfirmed_at` en los salientes que llevan
 * demasiadas horas en 'sent' sin confirmarse. La bandeja los muestra como
 * "enviado, sin confirmar" (ámbar) en vez de un check gris mudo. Si Meta manda
 * un 'delivered'/'read' tardío, el webhook limpia la marca y avanza el estado.
 *
 * Idempotente: el índice parcial idx_messages_stuck_sent (migración 111) hace
 * que una fila ya marcada no vuelva a entrar al barrido.
 */

// Horas en 'sent' sin confirmar tras las cuales lo consideramos no confirmado.
// Conservador (un teléfono apagado toda la noche entrega igual al reconectarse):
// 24 h evita falsos positivos. Configurable por si se quiere más agresivo.
const STUCK_HOURS = Number(process.env.WATCHDOG_STUCK_HOURS || 24)
// Piso: no re-escanear mensajes antiquísimos (ya son historia muerta).
const MAX_AGE_DAYS = 30

export async function GET(request: Request) {
  try {
    assertCronAuth(request, 'AUTOMATION_CRON_SECRET')
  } catch (r) {
    if (r instanceof Response) return r
    throw r
  }
  void pingCron('delivery-watchdog')

  const admin = supabaseAdmin()
  const now = Date.now()
  const cutoff = new Date(now - STUCK_HOURS * 3_600_000).toISOString()
  const floor = new Date(now - MAX_AGE_DAYS * 86_400_000).toISOString()

  // Solo salientes (bot/agente) que Meta aceptó (tienen message_id) y siguen en
  // 'sent' sin confirmar. Comentarios/email tienen otra semántica de entrega;
  // acá solo nos interesa el saliente que Meta debería confirmar.
  const { data, error } = await admin
    .from('messages')
    .update({ delivery_unconfirmed_at: new Date().toISOString() })
    .eq('status', 'sent')
    .is('delivery_unconfirmed_at', null)
    .in('sender_type', ['agent', 'bot'])
    .not('message_id', 'is', null)
    .lt('created_at', cutoff)
    .gt('created_at', floor)
    .select('id')
  if (error) return serverError(error)

  const flagged = (data ?? []).length
  if (flagged > 0) {
    console.log(`[cron/delivery-watchdog] marcados ${flagged} mensajes sin confirmar`)
  }
  return NextResponse.json({ flagged, stuck_hours: STUCK_HOURS })
}
