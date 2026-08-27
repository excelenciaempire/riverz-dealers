import { NextResponse } from 'next/server'
import { serverError } from '@/lib/api/errors'
import { assertCronAuth } from '@/lib/auth/cron'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { withCronRun } from '@/lib/cron/heartbeat'
import { reintentarConversiones } from '@/lib/marketing/reintentar-conversiones'

/**
 * Las ventas del chat que no le llegaron a Meta, otra vez.
 *
 * La 197 dejó el índice de pendientes y no había nada que los leyera: lo que
 * fallaba se quedaba fallado. Ver `reintentar-conversiones.ts` para el tope de
 * intentos, la espera creciente y por qué se reusa el cuerpo original.
 *
 * Corre cada 15 minutos y sale barato: sin filas pendientes es una consulta
 * contra un índice parcial que casi siempre está vacío.
 */
async function cronHandler(request: Request) {
  try {
    assertCronAuth(request, 'AUTOMATION_CRON_SECRET')
  } catch (r) {
    if (r instanceof Response) return r
    throw r
  }

  try {
    return NextResponse.json(await reintentarConversiones(supabaseAdmin()))
  } catch (err) {
    return serverError(err)
  }
}

export const GET = withCronRun('conversion-retry', cronHandler)
