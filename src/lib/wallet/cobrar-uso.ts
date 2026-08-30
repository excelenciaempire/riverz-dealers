import type { SupabaseClient } from '@supabase/supabase-js'
import { costForModel } from '@/lib/admin/cost'
import { cobrar } from './saldo'

/**
 * Lo que devolvió el proveedor sobre lo que se gastó.
 *
 * La caché va aparte y no dentro del prompt: leerla sale una décima y
 * escribirla un 25% más. Hoy la escritura es el 82% de lo que cuesta una
 * respuesta, así que sumarla al prompt no es un detalle contable.
 */
export interface UsoDelModelo {
  prompt?: number
  salida?: number
  cacheLeida?: number
  cacheEscrita?: number
}

/**
 * Cobrar una llamada al modelo a lo que COSTÓ.
 *
 * Existe para que no haya que repetir `costoUsd: costForModel(...)` en cada
 * sitio: repetirlo es cómo se olvidó tres veces, y un cobro sin costo cae a la
 * tarifa de lista, que es un promedio y no el gasto.
 *
 * No cobra cuando la clave es del comercio: a ese ya le cobra el proveedor.
 * Nunca lanza — la contabilidad no puede tumbar lo que está observando.
 */
export async function cobrarUsoDeIa(
  db: SupabaseClient,
  workspaceId: string,
  args: {
    concepto: string
    modelo: string | null | undefined
    uso: UsoDelModelo
    /** `'agent'` = la clave la puso el comercio. Cualquier otra cosa, se cobra. */
    origenDeLaClave?: string | null
    cantidad?: number
    referenciaTipo?: string
    referenciaId?: string | null
    detalle?: Record<string, unknown>
  },
): Promise<void> {
  if (args.origenDeLaClave === 'agent') return
  const costoUsd = costForModel(
    args.modelo,
    args.uso.prompt ?? 0,
    args.uso.salida ?? 0,
    { read: args.uso.cacheLeida ?? 0, write: args.uso.cacheEscrita ?? 0 },
  )
  await cobrar(db, workspaceId, {
    concepto: args.concepto,
    cantidad: args.cantidad ?? 1,
    costoUsd,
    referenciaTipo: args.referenciaTipo,
    referenciaId: args.referenciaId ?? null,
    detalle: { ...args.detalle, modelo: args.modelo ?? null },
  })
}

/**
 * Cobrar un consumo de un proveedor que cobra POR UNIDAD y no por tokens:
 * una transcripción por minuto, una página leída, un perfil consultado.
 *
 * Es el mismo traspaso, con el precio de lista del proveedor en vez del cálculo
 * sobre tokens. El precio vive junto al cliente que lo llama, no acá, para que
 * el día que cambie se cambie donde se lee la documentación.
 */
export async function cobrarUsoPorUnidad(
  db: SupabaseClient,
  workspaceId: string,
  args: {
    concepto: string
    cantidad: number
    /** Lo que cobra el proveedor por UNA unidad. */
    usdPorUnidad: number
    referenciaTipo?: string
    referenciaId?: string | null
    detalle?: Record<string, unknown>
  },
): Promise<void> {
  if (args.cantidad <= 0 || args.usdPorUnidad <= 0) return
  await cobrar(db, workspaceId, {
    concepto: args.concepto,
    cantidad: args.cantidad,
    costoUsd: args.cantidad * args.usdPorUnidad,
    referenciaTipo: args.referenciaTipo,
    referenciaId: args.referenciaId ?? null,
    detalle: args.detalle,
  })
}
