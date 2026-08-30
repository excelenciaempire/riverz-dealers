/**
 * Cuánto sale cada cosa que consume la IA.
 *
 * Las tarifas son filas (`wallet_tarifas`), no constantes: en esta etapa el
 * precio del minuto o de la respuesta se descubre probando, y tenerlo
 * compilado significa un despliegue por cada prueba. Se editan desde /admin.
 *
 * El precio se guarda en **milésimas de centavo** porque una respuesta de la IA
 * cuesta fracciones de centavo: con el precio en centavos enteros, la tarifa
 * más barata que se puede expresar es 1 centavo, que es ~5 veces lo que
 * realmente cuesta una respuesta corta.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

/** Todo lo que la billetera sabe cobrar. */
export type Concepto =
  | 'ia_respuesta'
  | 'ia_operador'
  | 'ia_seguimiento'
  | 'ia_resumen'
  | 'ia_clasificacion'
  | 'entender_publicacion'
  | 'llamada_voz'
  | 'voz_tts'
  | 'voz_stt'
  | 'busqueda_web'
  | 'imagen'
  | 'investigacion'

export interface Tarifa {
  concepto: string
  nombreEs: string
  nombreEn: string
  unidad: string
  precioMilicentavos: number
  activo: boolean
  orden: number
}

interface FilaTarifa {
  concepto: string
  nombre_es: string
  nombre_en: string
  unidad: string
  precio_milicentavos: number
  activo: boolean
  orden: number
}

export async function listarTarifas(db: SupabaseClient): Promise<Tarifa[]> {
  const { data } = await db
    .from('wallet_tarifas')
    .select('concepto, nombre_es, nombre_en, unidad, precio_milicentavos, activo, orden')
    .order('orden', { ascending: true })
  return ((data ?? []) as FilaTarifa[]).map((f) => ({
    concepto: f.concepto,
    nombreEs: f.nombre_es,
    nombreEn: f.nombre_en,
    unidad: f.unidad,
    precioMilicentavos: f.precio_milicentavos,
    activo: f.activo,
    orden: f.orden,
  }))
}

export async function tarifaDe(
  db: SupabaseClient,
  concepto: string,
): Promise<Tarifa | null> {
  const { data } = await db
    .from('wallet_tarifas')
    .select('concepto, nombre_es, nombre_en, unidad, precio_milicentavos, activo, orden')
    .eq('concepto', concepto)
    .maybeSingle()
  const f = data as FilaTarifa | null
  if (!f || !f.activo) return null
  return {
    concepto: f.concepto,
    nombreEs: f.nombre_es,
    nombreEn: f.nombre_en,
    unidad: f.unidad,
    precioMilicentavos: f.precio_milicentavos,
    activo: f.activo,
    orden: f.orden,
  }
}

/**
 * Lo que se cobra por `cantidad` unidades, en **milésimas de centavo**.
 *
 * No en centavos enteros, que es como estaba: el piso de un centavo cobraba
 * catorce veces lo que vale entender una consulta, y redondear cobraba de menos
 * un seguimiento siempre en la misma dirección. Lo que sale de acá lo acumula
 * `wallet_acumular` hasta que llega a un centavo, así que el resto no se pierde
 * ni se infla (migración 221).
 */
export function milicentavosDe(tarifa: Tarifa, cantidad: number): number {
  if (!(cantidad > 0)) return 0
  return Math.round(tarifa.precioMilicentavos * cantidad)
}
