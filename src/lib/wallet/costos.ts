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

/**
 * Cómo se cobra cada cosa.
 *
 * `incluido` y `sin_cargo` existen para poder MOSTRARLOS. Un tablero que sólo
 * lista lo que descuenta deja al comercio adivinando qué más está corriendo con
 * nuestras llaves, y esa duda es peor que cualquier número.
 */
export type FormaDeCobro = 'por_uso' | 'incluido' | 'sin_cargo'

export interface CostoReal {
  concepto: string
  nombreEs: string
  nombreEn: string
  /** Centavos por unidad. Cero en lo que no se cobra. */
  centavos: number
  unidad: string
  /** Quién cobra ese consumo. */
  proveedor: string
  /** Si sale de lo que consumió ESTA cuenta, o es la tarifa de lista. */
  medido: boolean
  cobro: FormaDeCobro
  /** Dentro de qué otra línea viaja, cuando es `incluido`. */
  dentroDeEs?: string
  dentroDeEn?: string
}

/** Cuántos días de historia se miran para promediar. */
const VENTANA_DIAS = 30

/**
 * TODO lo que corre con las llaves de Riverz, se cobre o no.
 *
 * Lo que no se cobra está acá igual y dice por qué: o viaja adentro de otra
 * línea —la voz y la transcripción ya están en el minuto de llamada— o sale tan
 * poco que cobrarlo costaría más ruido que la plata que mueve. Esconderlo sería
 * dejar al comercio preguntándose qué más estamos usando en su nombre.
 */
const CATALOGO: Omit<CostoReal, 'medido'>[] = [
  {
    concepto: 'ia_respuesta',
    nombreEs: 'Respuestas de la IA',
    nombreEn: 'AI replies',
    centavos: 1.44,
    unidad: 'respuesta',
    proveedor: 'Anthropic',
    cobro: 'por_uso',
  },
  {
    concepto: 'ia_operador',
    nombreEs: 'Operador',
    nombreEn: 'Operator',
    centavos: 8,
    unidad: 'respuesta',
    proveedor: 'Anthropic',
    cobro: 'por_uso',
  },
  {
    // Telefonía + transcripción + modelo + voz, todo junto.
    concepto: 'llamada_voz',
    nombreEs: 'Llamadas',
    nombreEn: 'Calls',
    centavos: 5.5,
    unidad: 'minuto',
    proveedor: 'Telnyx + Deepgram + Fish Audio',
    cobro: 'por_uso',
  },
  {
    concepto: 'entender_publicacion',
    nombreEs: 'Entender una publicación o un anuncio',
    nombreEn: 'Understanding a post or ad',
    centavos: 1.5,
    unidad: 'publicación',
    proveedor: 'Anthropic',
    cobro: 'por_uso',
  },
  {
    // La búsqueda web de Anthropic: 10 USD cada mil búsquedas.
    concepto: 'busqueda_web',
    nombreEs: 'Búsquedas en internet',
    nombreEn: 'Web searches',
    centavos: 1,
    unidad: 'búsqueda',
    proveedor: 'Anthropic',
    cobro: 'por_uso',
  },
  {
    concepto: 'voz_tts',
    nombreEs: 'La voz con la que habla el agente',
    nombreEn: "The agent's voice",
    centavos: 5,
    unidad: '1k caracteres',
    proveedor: 'Fish Audio',
    cobro: 'incluido',
    dentroDeEs: 'Llamadas',
    dentroDeEn: 'Calls',
  },
  {
    concepto: 'voz_stt',
    nombreEs: 'Entender lo que se dice en la llamada',
    nombreEn: 'Understanding what is said on the call',
    centavos: 0.78,
    unidad: 'minuto',
    proveedor: 'Deepgram',
    cobro: 'incluido',
    dentroDeEs: 'Llamadas',
    dentroDeEn: 'Calls',
  },
  {
    concepto: 'imagen_entrante',
    nombreEs: 'Mirar la foto que manda tu cliente',
    nombreEn: "Looking at the photo your customer sends",
    centavos: 0,
    unidad: 'foto',
    proveedor: 'Anthropic',
    cobro: 'incluido',
    dentroDeEs: 'Respuestas de la IA',
    dentroDeEn: 'AI replies',
  },
  {
    // Whisper en Groq sale ~0,04 USD la HORA. El piso de un movimiento del
    // libro es un centavo: cobrarlo sería cobrar catorce veces el trabajo.
    concepto: 'transcripcion_audio',
    nombreEs: 'Transcribir notas de voz y el audio de tus videos',
    nombreEn: 'Transcribing voice notes and your videos audio',
    centavos: 0,
    unidad: 'audio',
    proveedor: 'Groq (Whisper)',
    cobro: 'sin_cargo',
  },
]

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

  return CATALOGO.map((c) => {
    const medidoCentavos =
      c.concepto === 'ia_respuesta'
        ? porRespuesta
        : c.concepto === 'llamada_voz'
          ? porMinuto
          : null
    return {
      ...c,
      centavos: medidoCentavos ?? c.centavos,
      medido: medidoCentavos !== null,
    }
  })
}
