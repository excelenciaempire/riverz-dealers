import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/channels/admin-client'
import { assertCronAuth } from '@/lib/auth/cron'
import { withCronRun } from '@/lib/cron/heartbeat'
import { getLogger } from '@/lib/log/logger'
import { tokenVivo, COLUMNAS_TOKEN } from '@/lib/shopify/token-vivo'

const log = getLogger('cron.shopify-token-refresh')

/**
 * GET /api/cron/shopify-token-refresh
 *
 * Renueva el acceso a Shopify antes de que venza.
 *
 * Shopify dio de baja los tokens que no expiran: los nuevos duran UNA HORA y
 * traen un `refresh_token` de noventa días (migración 194). Sin esto, una
 * tienda deja de contestar sesenta minutos después de conectarse — y lo hace en
 * silencio, porque el error llega como un 403 al primer pedido que alguien
 * consulte.
 *
 * `tokenVivo` renueva también por demanda, cuando alguien va a usar el token.
 * Este cron existe igual y es el que de verdad sostiene la conexión: la mayoría
 * de las tiendas pasan horas sin que nadie las toque, y la renovación por
 * demanda sólo llega cuando ya hay alguien esperando del otro lado. Renovar
 * antes es la diferencia entre que el comercio no se entere y que el primer
 * cliente del día espere.
 *
 * Corre seguido —cada quince minutos— porque la ventana es de una hora: con una
 * corrida diaria, cualquier tienda estaría vencida el 96% del tiempo.
 *
 * Auth: cabecera `x-cron-secret` contra `AUTOMATION_CRON_SECRET`.
 */

/** Cuánto antes de vencer se renueva. Holgado a propósito: una corrida que
 *  falla tiene que tener margen para que la siguiente lo arregle. */
const VENTANA_MS = 20 * 60 * 1000

async function cronHandler(request: Request) {
  try {
    assertCronAuth(request, 'AUTOMATION_CRON_SECRET')
  } catch (r) {
    if (r instanceof Response) return r
    throw r
  }

  const admin = supabaseAdmin()
  const limite = new Date(Date.now() + VENTANA_MS).toISOString()

  // Sólo las que expiran Y están por vencer. Las viejas —sin fecha— no se
  // tocan: no tienen refresh y forzarles algo las rompería antes de tiempo.
  const { data, error: connectionsError } = await admin
    .from('shopify_connections')
    .select(COLUMNAS_TOKEN)
    .eq('platform', 'shopify')
    .eq('status', 'active')
    .not('token_expires_at', 'is', null)
    .lte('token_expires_at', limite)
    .limit(200)
  if (connectionsError) {
    return NextResponse.json({ error: connectionsError.message }, { status: 500 })
  }

  const filas = (data ?? []) as Parameters<typeof tokenVivo>[1][]
  let renovados = 0
  let fallaron = 0

  for (const fila of filas) {
    try {
      const r = await tokenVivo(admin, fila)
      if (r.renovado) renovados += 1
      else fallaron += 1
    } catch (err) {
      // Una tienda que falla no puede llevarse la corrida entera: las que
      // vienen después también están por vencer.
      fallaron += 1
      log.warn('refresh_failed', {
        shop: fila.shop_domain,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  return NextResponse.json(
    {
      ok: fallaron === 0,
      porVencer: filas.length,
      renovados,
      fallaron,
    },
    { status: fallaron ? 207 : 200 }
  )
}

export const GET = withCronRun('shopify-token-refresh', cronHandler)
