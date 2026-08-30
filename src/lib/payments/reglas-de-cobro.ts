/**
 * Con qué pruebas se da un pedido por cobrado sin que nadie lo mire.
 *
 * Los cuatro cortes existían y estaban bien pensados, pero escritos en el
 * código: la política de cobro de todos los comercios era la nuestra. Y no es
 * la misma en todos lados. Un negocio que vende cuatro precios repetidos —el
 * caso medido en Pilar: cuatro montos cubren el 79% de 558 pedidos, y el precio
 * está en el anuncio— necesita las cuatro pruebas, porque acertar el número no
 * prueba nada. Uno que factura presupuestos únicos tiene en el monto una prueba
 * de verdad, y exigirle además el número de operación sólo le manda a una
 * persona un cobro que era evidente.
 *
 * Las reglas son de la CUENTA y no del agente, igual que el tope de descuento:
 * cuándo se da la plata por recibida es una decisión del negocio, y no cambia
 * porque el cliente haya escrito por Instagram en vez de WhatsApp.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

export interface ReglasDeCobro {
  /** Exigir una imagen o un documento. Sin esto, alcanza con que lo diga. */
  exigeComprobante: boolean
  /** No cobrar solo si tiene más de un pedido pendiente. */
  unSoloPendiente: boolean
  /** Exigir el número de operación (lo que impide cobrar dos veces con uno). */
  exigeReferencia: boolean
  /** Cuánto puede diferir el monto del total, en porcentaje. */
  toleranciaPct: number
}

/**
 * Lo que hacía el código antes de que esto se pudiera configurar. Es el punto
 * de partida de toda cuenta: dar control no es cambiarle el agente a nadie.
 */
export const REGLAS_POR_DEFECTO: ReglasDeCobro = {
  exigeComprobante: true,
  unSoloPendiente: true,
  exigeReferencia: true,
  toleranciaPct: 0.1,
}

/** Más que esto ya no es un redondeo del banco: es otro pago. */
export const TOLERANCIA_MAXIMA = 5

export function normalizarTolerancia(n: unknown): number {
  const v = Number(n)
  if (!Number.isFinite(v) || v < 0) return REGLAS_POR_DEFECTO.toleranciaPct
  return Math.min(TOLERANCIA_MAXIMA, Math.round(v * 100) / 100)
}

/** La fila tal como viene de la base, a reglas. */
export function reglasDesdeFila(fila: Record<string, unknown> | null): ReglasDeCobro {
  if (!fila) return REGLAS_POR_DEFECTO
  const bool = (v: unknown, porDefecto: boolean) =>
    typeof v === 'boolean' ? v : porDefecto
  return {
    exigeComprobante: bool(fila.pago_exige_comprobante, true),
    unSoloPendiente: bool(fila.pago_un_solo_pendiente, true),
    exigeReferencia: bool(fila.pago_exige_referencia, true),
    toleranciaPct: normalizarTolerancia(fila.pago_tolerancia_pct),
  }
}

/**
 * Las reglas de esa cuenta. Sin fila de configuración —que es lo normal hasta
 * que alguien toca la pantalla— devuelve las de siempre.
 */
export async function leerReglasDeCobro(
  db: SupabaseClient,
  workspaceId: string,
): Promise<ReglasDeCobro> {
  const { data } = await db
    .from('workspace_checkout_config')
    .select(
      'pago_exige_comprobante, pago_un_solo_pendiente, pago_exige_referencia, pago_tolerancia_pct',
    )
    .eq('workspace_id', workspaceId)
    .maybeSingle()
  return reglasDesdeFila(data as Record<string, unknown> | null)
}
