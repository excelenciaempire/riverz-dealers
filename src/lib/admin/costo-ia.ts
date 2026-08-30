/**
 * Cuánto costó la IA. Una sola vez, para todo el panel.
 *
 * Hasta acá «Costo de IA» era la misma etiqueta sobre cuatro cálculos
 * distintos, y dos pantallas del mismo grupo se contradecían sobre cuánta plata
 * se había gastado:
 *
 * - Uso, la fila de cada proveedor y el reparto por bolsillo de la pantalla de
 *   IA compartían `estimateAiCostUsd`, que **tiraba la caché** y tarifaba con
 *   el modelo ACTUAL del agente en vez del que de verdad contestó.
 * - Negocio leía `billing_usage_daily`, que sí cuenta la caché.
 *
 * La caché es el 82% de lo que se paga por respuesta (el prompt del sistema va
 * cacheado y en una conversación con historia se relee entero cada vuelta), así
 * que no eran dos aproximaciones del mismo número: uno estaba mal por un factor
 * de cinco.
 *
 * **La fuente es `billing_usage_daily`.** Es la única que cuenta lectura y
 * escritura de caché, la única que filtra `status = 'sent'` —lo que no se envió
 * no se le cobra a nadie— y la única que tarifa con el modelo real de cada
 * fila. Y es la que se factura: si el panel muestra otra cosa, el panel miente.
 *
 * El reparo de siempre —«depende de un cron»— no aplica: `billing-usage` corre
 * **cada hora** y cada corrida reescribe ayer y hoy, así que el atraso máximo
 * es de una hora. Cuando no corre, esto lo dice (`confiable`) en vez de
 * recalcular en vivo: recalcular sería crear una quinta verdad justo en el
 * módulo que existe para borrar las otras tres.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

/** Lo que costó un modelo en un día, y qué parte la puso Riverz. */
export interface LineaDeModelo {
  usd: number
  /** La parte que salió con la llave de Riverz. Ver migración 230. */
  plataformaUsd: number
}

export interface CostoDeCuenta {
  conversaciones: number
  respuestas: number
  promptTokens: number
  completionTokens: number
  costoUsd: number
  /** Lo que puso Riverz. Sale del desglose, no de una regla de tres. */
  costoPlataformaUsd: number
  porModelo: Record<string, LineaDeModelo>
}

export interface CostoIa {
  porCuenta: Map<string, CostoDeCuenta>
  totalUsd: number
  totalPlataformaUsd: number
  /** Cuándo terminó bien el acumulador por última vez. Null = nunca corrió. */
  medidoAt: string | null
  /** Minutos desde esa corrida. Null si nunca corrió. */
  atrasoMin: number | null
  /**
   * Si el número se puede leer como «lo que costó».
   *
   * Falso cuando el acumulador lleva más de dos horas sin terminar bien —corre
   * cada hora, así que dos son ya un salteo—. La pantalla muestra igual lo que
   * hay, pero con la fecha de medición al lado: un tablero que presenta como
   * «el costo» un número al que le faltan seis horas es exactamente el problema
   * que este módulo vino a arreglar.
   */
  confiable: boolean
}

/** El acumulador corre cada hora; dos sin noticias ya es un salteo. */
const ATRASO_TOLERADO_MIN = 120

/** PostgREST corta en 1000 filas sin avisar. Ver `wallet` y `caja`. */
const PAGINA = 1000

const dia = (d: Date) => d.toISOString().slice(0, 10)

interface Fila {
  workspace_id: string
  dia: string
  conversaciones: number | null
  respuestas: number | null
  prompt_tokens: number | null
  completion_tokens: number | null
  costo_usd: number | null
  costo_por_modelo: Record<string, { usd?: number; plataforma_usd?: number }> | null
}

export async function leerCostoIa(
  db: SupabaseClient,
  periodo: { desde: Date; hasta: Date },
): Promise<CostoIa> {
  const [filas, sello] = await Promise.all([
    leerFilas(db, periodo),
    ultimaCorrida(db),
  ])

  const porCuenta = new Map<string, CostoDeCuenta>()
  let totalUsd = 0
  let totalPlataformaUsd = 0

  for (const f of filas) {
    const acc =
      porCuenta.get(f.workspace_id) ??
      {
        conversaciones: 0,
        respuestas: 0,
        promptTokens: 0,
        completionTokens: 0,
        costoUsd: 0,
        costoPlataformaUsd: 0,
        porModelo: {} as Record<string, LineaDeModelo>,
      }

    acc.conversaciones += Number(f.conversaciones ?? 0)
    acc.respuestas += Number(f.respuestas ?? 0)
    acc.promptTokens += Number(f.prompt_tokens ?? 0)
    acc.completionTokens += Number(f.completion_tokens ?? 0)

    const costo = Number(f.costo_usd ?? 0)
    acc.costoUsd += costo
    totalUsd += costo

    // Las filas anteriores a la migración 230 no traen desglose. No se
    // inventa: sin `key_source` guardado no hay forma de saber quién puso esa
    // plata, y repartirla por tokens sería volver a la estimación que este
    // módulo reemplaza. Quedan fuera del corte por modelo y del de bolsillo, y
    // `porModelo` vacío es lo que la pantalla lee como «sin desglose».
    for (const [modelo, v] of Object.entries(f.costo_por_modelo ?? {})) {
      const linea = acc.porModelo[modelo] ?? { usd: 0, plataformaUsd: 0 }
      linea.usd += Number(v?.usd ?? 0)
      linea.plataformaUsd += Number(v?.plataforma_usd ?? 0)
      acc.porModelo[modelo] = linea
      acc.costoPlataformaUsd += Number(v?.plataforma_usd ?? 0)
      totalPlataformaUsd += Number(v?.plataforma_usd ?? 0)
    }

    porCuenta.set(f.workspace_id, acc)
  }

  const atrasoMin = sello
    ? Math.max(0, Math.round((Date.now() - new Date(sello.at).getTime()) / 60_000))
    : null

  return {
    porCuenta,
    totalUsd,
    totalPlataformaUsd,
    medidoAt: sello?.at ?? null,
    atrasoMin,
    confiable: sello?.ok === true && atrasoMin !== null && atrasoMin < ATRASO_TOLERADO_MIN,
  }
}

async function leerFilas(
  db: SupabaseClient,
  periodo: { desde: Date; hasta: Date },
): Promise<Fila[]> {
  const filas: Fila[] = []
  for (let pagina = 0; ; pagina++) {
    const { data, error } = await db
      .from('billing_usage_daily')
      .select(
        'workspace_id, dia, conversaciones, respuestas, prompt_tokens, completion_tokens, costo_usd, costo_por_modelo',
      )
      .gte('dia', dia(periodo.desde))
      .lt('dia', dia(periodo.hasta))
      .range(pagina * PAGINA, pagina * PAGINA + PAGINA - 1)
    if (error || !data?.length) break
    filas.push(...(data as Fila[]))
    if (data.length < PAGINA) break
  }
  return filas
}

/** La última corrida del acumulador, para saber si el número está al día. */
async function ultimaCorrida(
  db: SupabaseClient,
): Promise<{ at: string; ok: boolean } | null> {
  const { data } = await db
    .from('cron_runs')
    .select('started_at, status')
    .eq('name', 'billing-usage')
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  const fila = data as { started_at?: string; status?: string } | null
  if (!fila?.started_at) return null
  return { at: fila.started_at, ok: fila.status === 'ok' }
}

/**
 * A qué proveedor le corresponde un modelo.
 *
 * La fila de Anthropic sumaba TODOS los modelos del desglose, Groq y Gemini
 * incluidos: una caída al respaldo aparecía como gasto de Anthropic. Con esto
 * cada fila del panel muestra lo suyo.
 */
export function proveedorDeModelo(modelo: string): string | null {
  const id = modelo.trim().toLowerCase()
  if (id.startsWith('claude-')) return 'anthropic'
  if (id.startsWith('llama-')) return 'groq'
  if (id.startsWith('gemini-') || id.startsWith('google/')) return 'gemini'
  if (id.startsWith('gpt-') || id.startsWith('o1') || id.startsWith('o3')) return 'openai'
  return null
}

/** Lo que puso Riverz por un proveedor, en el período ya leído. */
export function plataformaUsdDe(costo: CostoIa, proveedor: string): number {
  let total = 0
  for (const cuenta of costo.porCuenta.values()) {
    for (const [modelo, linea] of Object.entries(cuenta.porModelo)) {
      if (proveedorDeModelo(modelo) === proveedor) total += linea.plataformaUsd
    }
  }
  return total
}
