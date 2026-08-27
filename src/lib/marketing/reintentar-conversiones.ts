import type { SupabaseClient } from '@supabase/supabase-js'
import { reenviarEvento } from './meta-conversions'
import { getLogger } from '@/lib/log/logger'

/**
 * Volver a intentar las ventas que no le llegaron a Meta.
 *
 * Casi todo lo que falla acá se arregla solo o en un rato: un 500 de Meta, un
 * corte de red, o un token de la API de Conversiones vencido que el comercio
 * renueva a la mañana siguiente. Sin este barrido, cada uno de esos ratos es
 * una venta que el algoritmo nunca supo que ocurrió — y como la campaña se
 * juzga por lo que Meta ve, es una venta que juega en contra.
 */

const log = getLogger('marketing.reintento')

/**
 * Tope de intentos. Un token ilegible falla igual la vez mil: reintentar cada
 * quince minutos durante una semana son 672 llamadas inútiles por evento.
 */
const MAX_INTENTOS = 5

/**
 * Espera creciente por intento: 15 min, 30 min, 1 h, 2 h, 4 h. Cubre tanto el
 * bache de red como el token que alguien arregla en la mañana.
 */
function esperaMs(intentos: number): number {
  return 15 * 60_000 * 2 ** Math.max(0, intentos - 1)
}

/**
 * Meta descarta cualquier evento con más de 7 días.
 *
 * Después de eso el reintento no es que falle: entra, contesta que sí, y no
 * cuenta nada. Peor que no mandarlo, porque deja la fila en verde.
 */
const VENTANA_DIAS = 7

/** Cuántas caben en una corrida. El barrido es cada 15 minutos. */
const POR_CORRIDA = 100

export interface ResumenReintento {
  mirados: number
  enviados: number
  fallidos: number
  rendidos: number
}

export async function reintentarConversiones(
  db: SupabaseClient,
  ahora = Date.now(),
): Promise<ResumenReintento> {
  const piso = new Date(ahora - VENTANA_DIAS * 86_400_000).toISOString()

  const { data, error } = await db
    .from('conversion_events')
    .select('id, workspace_id, event_name, event_id, payload, intentos, sent_at, created_at')
    .neq('status', 'enviado')
    .lt('intentos', MAX_INTENTOS)
    .gt('created_at', piso)
    .order('created_at', { ascending: true })
    .limit(POR_CORRIDA)
  if (error) {
    log.warn('no_pude_leer', { error: error.message })
    return { mirados: 0, enviados: 0, fallidos: 0, rendidos: 0 }
  }

  const filas = (data ?? []) as Array<{
    id: string
    workspace_id: string
    event_name: string
    event_id: string
    payload: unknown
    intentos: number
    sent_at: string | null
    created_at: string
  }>

  const res: ResumenReintento = { mirados: filas.length, enviados: 0, fallidos: 0, rendidos: 0 }

  for (const f of filas) {
    // La espera se cuenta desde el ÚLTIMO intento, no desde la venta: si no,
    // una fila vieja se reintentaría en cada corrida sin respetar el respiro.
    const ultimo = new Date(f.sent_at ?? f.created_at).getTime()
    if (ahora - ultimo < esperaMs(f.intentos)) continue

    const r = await reenviarEvento(db, f)
    if (r.ok) {
      res.enviados += 1
      continue
    }
    // Sin píxel no se gastó un intento: el comercio lo desconectó y, si lo
    // vuelve a conectar, esta venta todavía puede contarse.
    if (r.motivo === 'sin_pixel') continue
    res.fallidos += 1
    if (f.intentos + 1 >= MAX_INTENTOS) res.rendidos += 1
  }

  if (res.enviados || res.rendidos) {
    log.info('reintento', res as unknown as Record<string, unknown>)
  }
  return res
}
