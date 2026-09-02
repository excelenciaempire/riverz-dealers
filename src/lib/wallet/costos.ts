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
    // 6,05 ¢ medido en producción sobre 25 respuestas (2026-08-30), con el
    // modelo por defecto, que es Opus 5. El número viejo —1,44— era el de
    // Haiku, y ningún agente nace en Haiku: le mostraba al comercio la cuarta
    // parte de lo que iba a pagar. Es sólo la semilla: en cuanto la cuenta
    // tiene historia se le muestra SU costo medido.
    concepto: 'ia_respuesta',
    nombreEs: 'Respuestas de la IA',
    nombreEn: 'AI replies',
    centavos: 6,
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
    // Mismo camino y mismo modelo que una respuesta.
    concepto: 'ia_seguimiento',
    nombreEs: 'Seguimientos cuando el cliente se calla',
    nombreEn: 'Follow-ups when the customer goes quiet',
    centavos: 6,
    unidad: 'seguimiento',
    proveedor: 'Anthropic',
    cobro: 'por_uso',
  },
  {
    concepto: 'ia_resumen',
    nombreEs: 'Memoria de tus conversaciones',
    nombreEn: 'Conversation memory',
    centavos: 0.6,
    unidad: 'resumen',
    proveedor: 'Anthropic',
    cobro: 'por_uso',
  },
  {
    concepto: 'ia_clasificacion',
    nombreEs: 'Entender qué te pidieron',
    nombreEn: 'Understanding what was asked',
    centavos: 0.15,
    unidad: 'consulta',
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
    // Se cobra desde 2026-08-30. Whisper sale ~0,04 USD la HORA en Groq, o sea
    // fracciones de centavo por audio: antes se dejaba gratis porque el piso
    // del libro era un centavo entero y cobrarlo habría sido cobrar catorce
    // veces el trabajo. Desde que el acumulador guarda milésimas (migración
    // 221) eso ya no pasa, y un consumo de un proveedor conectado no tiene por
    // qué pagarlo Riverz.
    concepto: 'transcripcion',
    nombreEs: 'Pasar audio a texto',
    nombreEn: 'Audio to text',
    centavos: 0.067,
    unidad: 'minuto',
    proveedor: 'Groq / OpenAI (Whisper)',
    cobro: 'por_uso',
  },
  {
    // Las siete pantallas donde una persona le pide algo a la IA: mejorar un
    // texto, escribir un borrador, probar el agente, leer una web, redactar
    // una plantilla, armar un plan. Frenaban sin saldo y no cobraban nada.
    concepto: 'ia_asistencia',
    nombreEs: 'Ayuda de la IA en el panel',
    nombreEn: 'AI help in the app',
    centavos: 2,
    unidad: 'uso',
    proveedor: 'Anthropic',
    cobro: 'por_uso',
  },
  {
    concepto: 'investigacion',
    nombreEs: 'Análisis de comentarios',
    nombreEn: 'Comment analysis',
    centavos: 8,
    unidad: 'análisis',
    proveedor: 'Anthropic',
    cobro: 'por_uso',
  },
  {
    concepto: 'lectura_de_pagina',
    nombreEs: 'Leer una página web',
    nombreEn: 'Reading a web page',
    centavos: 0.1,
    unidad: 'página',
    proveedor: 'Firecrawl',
    cobro: 'por_uso',
  },
  {
    // Sólo si la consulta salió con la llave de Riverz: el comercio que conecta
    // su propio Apify en Integraciones le paga directo a Apify.
    concepto: 'perfil_externo',
    nombreEs: 'Consultar un perfil público',
    nombreEn: 'Looking up a public profile',
    centavos: 0.23,
    unidad: 'perfil',
    proveedor: 'Apify',
    cobro: 'por_uso',
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

/**
 * Lo que le salió a ESTA cuenta cada unidad de todo lo demás, leído del libro.
 *
 * Las respuestas y los minutos tienen su propia medición porque se calculan
 * sobre los tokens y los segundos, que son más finos. El resto —el
 * seguimiento, el resumen, la clasificación, entender una publicación— ya
 * quedó anotado en `wallet_movimientos` con el costo real de cada evento: no
 * hace falta volver a medirlo, alcanza con promediar lo que la cuenta ya
 * gastó. Es la diferencia entre mostrarle su número y mostrarle el nuestro.
 */
async function costoPorConcepto(
  db: SupabaseClient,
  workspaceId: string,
): Promise<Record<string, number>> {
  // PostgREST corta en 1000 filas sin avisar: se pide de a páginas hasta
  // juntar un mes o quedarse sin filas.
  const filas: { concepto: string; costo_centavos: number; cantidad: number | null }[] = []
  for (let pagina = 0; pagina < 3; pagina++) {
    const { data } = await db
      .from('wallet_movimientos')
      .select('concepto, costo_centavos, cantidad')
      .eq('workspace_id', workspaceId)
      .eq('tipo', 'consumo')
      .gte('creado_en', desde())
      .order('creado_en', { ascending: false })
      .range(pagina * 1000, pagina * 1000 + 999)
    const lote = (data ?? []) as typeof filas
    filas.push(...lote)
    if (lote.length < 1000) break
  }

  const acum = new Map<string, { usd: number; unidades: number }>()
  for (const f of filas) {
    const a = acum.get(f.concepto) ?? { usd: 0, unidades: 0 }
    a.usd += Number(f.costo_centavos ?? 0)
    a.unidades += Number(f.cantidad ?? 0)
    acum.set(f.concepto, a)
  }

  const out: Record<string, number> = {}
  for (const [concepto, a] of acum) {
    // Sin costo anotado no hay nada que promediar: mejor la tarifa de lista
    // que un cero que se leería como "esto es gratis".
    if (a.unidades > 0 && a.usd > 0) out[concepto] = a.usd / a.unidades
  }
  return out
}

/** El costo real de cada concepto, para esta cuenta. */
export async function costosReales(
  db: SupabaseClient,
  workspaceId: string,
): Promise<CostoReal[]> {
  const [porRespuesta, porMinuto, porConcepto] = await Promise.all([
    costoPorRespuesta(db, workspaceId).catch(() => null),
    costoPorMinuto(db, workspaceId).catch(() => null),
    costoPorConcepto(db, workspaceId).catch(() => ({}) as Record<string, number>),
  ])

  return CATALOGO.map((c) => {
    const medidoCentavos =
      c.concepto === 'ia_respuesta'
        ? porRespuesta
        : c.concepto === 'llamada_voz'
          ? porMinuto
          : (porConcepto[c.concepto] ?? null)
    return {
      ...c,
      centavos: medidoCentavos ?? c.centavos,
      medido: medidoCentavos !== null,
    }
  })
}

/**
 * Los conceptos que la billetera sabe mostrar.
 *
 * Existe para el test que impide cobrar algo que el comercio no puede ver: la
 * pantalla lista `CATALOGO`, así que un concepto cobrado y ausente de acá es
 * plata descontada a ciegas.
 */
export const CONCEPTOS_DEL_CATALOGO: ReadonlySet<string> = new Set(
  CATALOGO.map((c) => c.concepto),
)
