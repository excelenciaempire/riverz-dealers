/**
 * Cuánto consumió una cuenta, y cuánto sale.
 *
 * La unidad que se factura es la **conversación atendida por IA**: una
 * conversación distinta con al menos una respuesta de la IA ese día. Es la
 * unidad que sigue al costo real de Anthropic y la única que se le puede
 * explicar a un comercio sin hablar de tokens.
 *
 * Se acumula por día en `billing_usage_daily` y no se recalcula barriendo
 * `ai_replies` cada vez, por dos motivos: un barrido por cada carga de pantalla
 * no escala, y para facturar hace falta un número que no cambie cuando alguien
 * borra una conversación vieja. La acumulación es el registro.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { costForModel } from '@/lib/admin/cost'
import type { Suscripcion } from './plan'

export interface UsoDelPeriodo {
  desde: string
  hasta: string
  conversaciones: number
  respuestas: number
  /** Lo que nos costó a nosotros. La otra mitad del margen. */
  costoUsd: number
}

export interface Cuenta {
  uso: UsoDelPeriodo
  incluidas: number
  /** Cuántas se pasó del cupo. */
  excedidas: number
  baseCentavos: number
  excedenteCentavos: number
  totalCentavos: number
  moneda: string
}

/**
 * El período que se está facturando.
 *
 * Con suscripción activa lo dice Stripe (`periodo_desde`/`periodo_hasta`). Sin
 * ella —en prueba, en cortesía— se usa el mes corrido, que es lo que la persona
 * espera ver.
 */
export function periodoDe(s: Suscripcion | null): { desde: Date; hasta: Date } {
  if (s?.periodoDesde && s?.periodoHasta) {
    return { desde: new Date(s.periodoDesde), hasta: new Date(s.periodoHasta) }
  }
  const ahora = new Date()
  return {
    desde: new Date(Date.UTC(ahora.getUTCFullYear(), ahora.getUTCMonth(), 1)),
    hasta: new Date(Date.UTC(ahora.getUTCFullYear(), ahora.getUTCMonth() + 1, 1)),
  }
}

const dia = (d: Date) => d.toISOString().slice(0, 10)

export async function usoDelPeriodo(
  db: SupabaseClient,
  workspaceId: string,
  periodo: { desde: Date; hasta: Date },
): Promise<UsoDelPeriodo> {
  const { data } = await db
    .from('billing_usage_daily')
    .select('conversaciones, respuestas, costo_usd')
    .eq('workspace_id', workspaceId)
    .gte('dia', dia(periodo.desde))
    .lt('dia', dia(periodo.hasta))

  const filas = (data ?? []) as {
    conversaciones: number
    respuestas: number
    costo_usd: number
  }[]
  return {
    desde: periodo.desde.toISOString(),
    hasta: periodo.hasta.toISOString(),
    conversaciones: filas.reduce((n, f) => n + (f.conversaciones ?? 0), 0),
    respuestas: filas.reduce((n, f) => n + (f.respuestas ?? 0), 0),
    costoUsd: filas.reduce((n, f) => n + Number(f.costo_usd ?? 0), 0),
  }
}

/** Lo que va a salir este período, con el trato de esta cuenta. */
export function cuentaDelPeriodo(s: Suscripcion, uso: UsoDelPeriodo): Cuenta {
  const excedidas = Math.max(0, uso.conversaciones - s.incluidas)
  const excedente = excedidas * s.excedenteCentavos
  return {
    uso,
    incluidas: s.incluidas,
    excedidas,
    baseCentavos: s.precioCentavos,
    excedenteCentavos: excedente,
    totalCentavos: s.precioCentavos + excedente,
    moneda: s.plan?.moneda ?? 'usd',
  }
}

/**
 * Recalcula un día para TODAS las cuentas.
 *
 * Lo corre el cron una vez por día sobre el día anterior, y se puede volver a
 * correr sobre cualquier fecha sin duplicar: la clave es (cuenta, día) y se
 * pisa. Recalcular tiene que ser seguro o el primer error de conteo queda
 * grabado para siempre.
 */
export async function acumularDia(
  db: SupabaseClient,
  fecha: Date,
): Promise<{ cuentas: number; conversaciones: number }> {
  const desde = new Date(Date.UTC(fecha.getUTCFullYear(), fecha.getUTCMonth(), fecha.getUTCDate()))
  const hasta = new Date(desde.getTime() + 24 * 60 * 60 * 1000)

  const { data } = await db
    .from('ai_replies')
    .select('workspace_id, conversation_id, model, prompt_tokens, completion_tokens')
    .eq('status', 'sent')
    .gte('created_at', desde.toISOString())
    .lt('created_at', hasta.toISOString())
    .limit(100_000)

  const porCuenta = new Map<
    string,
    { conv: Set<string>; respuestas: number; prompt: number; completion: number; usd: number }
  >()
  for (const r of (data ?? []) as {
    workspace_id: string
    conversation_id: string | null
    model: string | null
    prompt_tokens: number | null
    completion_tokens: number | null
  }[]) {
    const acc =
      porCuenta.get(r.workspace_id) ??
      { conv: new Set<string>(), respuestas: 0, prompt: 0, completion: 0, usd: 0 }
    if (r.conversation_id) acc.conv.add(r.conversation_id)
    acc.respuestas += 1
    acc.prompt += r.prompt_tokens ?? 0
    acc.completion += r.completion_tokens ?? 0
    acc.usd += costForModel(r.model, r.prompt_tokens ?? 0, r.completion_tokens ?? 0)
    porCuenta.set(r.workspace_id, acc)
  }

  const filas = [...porCuenta.entries()].map(([workspace_id, a]) => ({
    workspace_id,
    dia: dia(desde),
    conversaciones: a.conv.size,
    respuestas: a.respuestas,
    prompt_tokens: a.prompt,
    completion_tokens: a.completion,
    costo_usd: Number(a.usd.toFixed(6)),
    actualizado_en: new Date().toISOString(),
  }))

  if (filas.length > 0) {
    const { error } = await db
      .from('billing_usage_daily')
      .upsert(filas, { onConflict: 'workspace_id,dia' })
    if (error) throw new Error(error.message)
  }

  return {
    cuentas: filas.length,
    conversaciones: filas.reduce((n, f) => n + f.conversaciones, 0),
  }
}
