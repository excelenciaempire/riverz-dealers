/**
 * Lo que cuesta cada cosa DE VERDAD, por cuenta.
 *
 * La cuenta que paga a costo no puede ver una tabla de tarifas: la tarifa es un
 * precio de lista con margen adentro, y a ella se le prometió lo contrario.
 * Necesita ver el número que se le va a descontar, y ese número tiene dos
 * fuentes, en este orden:
 *
 * 1. **Lo que le salió a ella.** Se mide sobre su propio consumo: los tokens de
 *    sus respuestas, los minutos de sus llamadas. Es el único número que le
 *    sirve para proyectar, porque una tienda con conversaciones largas y otra
 *    que contesta en dos líneas no gastan lo mismo ni de cerca.
 * 2. **La tarifa de lista del proveedor**, mientras no tenga historia. Es una
 *    estimación y se dice que lo es: mostrar un promedio ajeno como si fuera
 *    suyo es peor que decir "todavía no lo sabemos".
 *
 * Cada concepto además dice **quién cobra**. Es la pregunta que sigue siempre
 * ("¿esto a quién se lo estoy pagando?") y contestarla de antemano es la
 * diferencia entre una factura y una caja negra.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { costForModel } from '@/lib/admin/cost'

export interface CostoReal {
  concepto: string
  /** Centavos por unidad. */
  centavos: number
  unidad: string
  /** Quién cobra ese consumo. */
  proveedor: string
  /** Si sale de lo que consumió ESTA cuenta, o es la tarifa de lista. */
  medido: boolean
}

/** Cuántos días de historia se miran para promediar. */
const VENTANA_DIAS = 30

/** Lo que cobra cada proveedor, de lista, cuando la cuenta no tiene historia. */
const LISTA: Record<string, { centavos: number; unidad: string; proveedor: string }> = {
  // Una respuesta típica del agente con su prompt cacheado. Se reemplaza por el
  // promedio real de la cuenta en cuanto tenga una sola respuesta enviada.
  ia_respuesta: { centavos: 1.44, unidad: 'respuesta', proveedor: 'Anthropic' },
  ia_operador: { centavos: 8, unidad: 'respuesta', proveedor: 'Anthropic' },
  // Telefonía + transcripción + modelo + voz, todo junto. Medido en producción
  // sobre llamadas reales: 0,055 USD el minuto.
  llamada_voz: { centavos: 5.5, unidad: 'minuto', proveedor: 'Telnyx + Deepgram + Fish Audio' },
  // La voz y la transcripción NO son líneas propias: ya están adentro del
  // minuto de llamada. Se dejan acá para poder desglosar de qué está hecho ese
  // minuto, pero sus tarifas nacen apagadas — cobrarlas aparte sería cobrar dos
  // veces lo mismo.
  voz_tts: { centavos: 5, unidad: '1k caracteres', proveedor: 'Fish Audio' },
  voz_stt: { centavos: 0.78, unidad: 'minuto', proveedor: 'Deepgram' },
  // La búsqueda web de Anthropic: 10 USD cada mil búsquedas.
  busqueda_web: { centavos: 1, unidad: 'búsqueda', proveedor: 'Anthropic' },
  // Estos dos NO existen en este producto y quedaron apagados en la tabla:
  // acá la IA MIRA imágenes (y eso ya se paga en los tokens de la respuesta),
  // no las genera; y la investigación de mercado es de la otra herramienta de
  // Riverz, no del CRM. Se dejan definidos para que, si alguien los reactiva
  // desde /admin, al menos tengan un costo y un proveedor detrás.
  imagen: { centavos: 4, unidad: 'imagen', proveedor: 'Gemini / Replicate' },
  investigacion: { centavos: 100, unidad: 'informe', proveedor: 'Anthropic' },
}

function desde(): string {
  return new Date(Date.now() - VENTANA_DIAS * 24 * 60 * 60 * 1000).toISOString()
}

/**
 * Lo que le salió a ESTA cuenta cada respuesta de la IA.
 *
 * Se calcula sobre los tokens reales —incluida la caché, que Anthropic cobra
 * aparte y no mete en `input_tokens`— y no sobre el promedio de la plataforma.
 * Null si todavía no envió ninguna.
 */
async function costoPorRespuesta(
  db: SupabaseClient,
  workspaceId: string,
): Promise<number | null> {
  const { data } = await db
    .from('ai_replies')
    .select('prompt_tokens, completion_tokens, cache_read_tokens, cache_write_tokens, model')
    .eq('workspace_id', workspaceId)
    .eq('status', 'sent')
    .gte('created_at', desde())
    .limit(2000)
  const filas = (data ?? []) as {
    prompt_tokens: number | null
    completion_tokens: number | null
    cache_read_tokens: number | null
    cache_write_tokens: number | null
    model: string | null
  }[]
  if (filas.length === 0) return null
  const usd = filas.reduce(
    (n, r) =>
      n +
      costForModel(r.model, r.prompt_tokens ?? 0, r.completion_tokens ?? 0, {
        read: r.cache_read_tokens ?? 0,
        write: r.cache_write_tokens ?? 0,
      }),
    0,
  )
  return (usd * 100) / filas.length
}

/** Lo que le salió a ESTA cuenta cada minuto hablado. Null sin llamadas. */
async function costoPorMinuto(
  db: SupabaseClient,
  workspaceId: string,
): Promise<number | null> {
  const { data } = await db
    .from('voice_calls')
    .select('duration_seconds, cost')
    .eq('workspace_id', workspaceId)
    .gte('created_at', desde())
    .not('duration_seconds', 'is', null)
    .limit(1000)
  const filas = (data ?? []) as {
    duration_seconds: number | null
    cost: { total_usd?: number } | null
  }[]
  const conDuracion = filas.filter((f) => (f.duration_seconds ?? 0) > 0)
  if (conDuracion.length === 0) return null
  const minutos = conDuracion.reduce((n, f) => n + (f.duration_seconds ?? 0) / 60, 0)
  const usd = conDuracion.reduce((n, f) => n + Number(f.cost?.total_usd ?? 0), 0)
  if (!(minutos > 0) || !(usd > 0)) return null
  return (usd * 100) / minutos
}

/** El costo real de cada concepto, para esta cuenta. */
export async function costosReales(
  db: SupabaseClient,
  workspaceId: string,
): Promise<CostoReal[]> {
  const [porRespuesta, porMinuto] = await Promise.all([
    costoPorRespuesta(db, workspaceId).catch(() => null),
    costoPorMinuto(db, workspaceId).catch(() => null),
  ])

  return Object.entries(LISTA).map(([concepto, l]) => {
    const medidoCentavos =
      concepto === 'ia_respuesta'
        ? porRespuesta
        : concepto === 'llamada_voz'
          ? porMinuto
          : null
    return {
      concepto,
      centavos: medidoCentavos ?? l.centavos,
      unidad: l.unidad,
      proveedor: l.proveedor,
      medido: medidoCentavos !== null,
    }
  })
}
