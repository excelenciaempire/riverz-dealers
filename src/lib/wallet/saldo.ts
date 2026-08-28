/**
 * La billetera: cuánto saldo tiene una cuenta y cómo se mueve.
 *
 * Hasta ahora, para usar la IA el comercio tenía que traer su propia clave de
 * Anthropic, y la voz dependía de que alguien en Riverz recargara Anthropic,
 * Telnyx y Fish Audio a mano. El comercio no tiene por qué enterarse de que
 * existen esos tres proveedores. Acá se invierte: **todo corre con las llaves
 * de Riverz** y el comercio carga saldo.
 *
 * Dos reglas que no se rompen:
 *
 * 1. **Todo movimiento pasa por el RPC `wallet_mover`.** Bloquea la fila,
 *    calcula el saldo nuevo y escribe la línea del libro en la misma
 *    transacción. Sumar en JavaScript y guardar el resultado es la receta para
 *    que dos respuestas simultáneas lean el mismo saldo y una borre a la otra.
 *
 * 2. **Cobrar nunca puede tumbar lo que estaba haciendo.** Si el cobro falla,
 *    se registra en consola y la respuesta al cliente sale igual. Un error de
 *    contabilidad no puede convertirse en un cliente sin respuesta; se corrige
 *    después, que para eso el libro admite ajustes.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { centavosDe, tarifaDe } from './tarifas'

export interface Billetera {
  workspaceId: string
  saldoCentavos: number
  moneda: string
  /** Cuánto puede quedar en rojo antes de cortar. */
  descubiertoCentavos: number
  /** Si quedarse sin saldo apaga la operación. Nace apagado. */
  bloquearSinSaldo: boolean
  autoRecargaCentavos: number | null
  autoUmbralCentavos: number | null
}

interface FilaCuenta {
  workspace_id: string
  saldo_centavos: number
  moneda: string
  descubierto_centavos: number
  bloquear_sin_saldo: boolean
  auto_recarga_centavos: number | null
  auto_umbral_centavos: number | null
}

const COLUMNAS =
  'workspace_id, saldo_centavos, moneda, descubierto_centavos, bloquear_sin_saldo, auto_recarga_centavos, auto_umbral_centavos'

function aBilletera(f: FilaCuenta): Billetera {
  return {
    workspaceId: f.workspace_id,
    saldoCentavos: Number(f.saldo_centavos ?? 0),
    moneda: f.moneda ?? 'usd',
    descubiertoCentavos: f.descubierto_centavos ?? 0,
    bloquearSinSaldo: f.bloquear_sin_saldo === true,
    autoRecargaCentavos: f.auto_recarga_centavos,
    autoUmbralCentavos: f.auto_umbral_centavos,
  }
}

/**
 * La billetera de una cuenta, creándola si no existe.
 *
 * Idempotente: las cuentas que ya existían antes de que esto existiera no
 * tienen fila, y no por eso están sin saldo — están en cero, que es distinto de
 * no existir sólo para el código.
 */
export async function leerBilletera(
  db: SupabaseClient,
  workspaceId: string,
): Promise<Billetera> {
  const { data } = await db
    .from('wallet_accounts')
    .select(COLUMNAS)
    .eq('workspace_id', workspaceId)
    .maybeSingle()
  if (data) return aBilletera(data as unknown as FilaCuenta)

  await db
    .from('wallet_accounts')
    .upsert({ workspace_id: workspaceId }, { onConflict: 'workspace_id' })
  const { data: creada } = await db
    .from('wallet_accounts')
    .select(COLUMNAS)
    .eq('workspace_id', workspaceId)
    .maybeSingle()
  return creada
    ? aBilletera(creada as unknown as FilaCuenta)
    : {
        workspaceId,
        saldoCentavos: 0,
        moneda: 'usd',
        descubiertoCentavos: 200,
        bloquearSinSaldo: false,
        autoRecargaCentavos: null,
        autoUmbralCentavos: null,
      }
}

export interface Movimiento {
  tipo: 'recarga' | 'consumo' | 'bono' | 'ajuste' | 'reembolso'
  concepto: string
  /** Firmado: positivo suma, negativo resta. */
  centavos: number
  /** Lo que le costó a Riverz, en centavos. Sólo en consumos. */
  costoCentavos?: number
  cantidad?: number | null
  unidad?: string | null
  referenciaTipo?: string | null
  referenciaId?: string | null
  /** Id del pago de Stripe. Hace la recarga idempotente. */
  stripeId?: string | null
  detalle?: Record<string, unknown>
  creadoPor?: string | null
}

export interface Resultado {
  movimientoId: string | null
  saldoCentavos: number
  duplicado: boolean
}

/** Escribe un movimiento y devuelve el saldo nuevo. Atómico, vía RPC. */
export async function mover(
  db: SupabaseClient,
  workspaceId: string,
  m: Movimiento,
): Promise<Resultado> {
  const { data, error } = await db.rpc('wallet_mover', {
    p_workspace: workspaceId,
    p_tipo: m.tipo,
    p_concepto: m.concepto,
    p_centavos: Math.round(m.centavos),
    p_costo: m.costoCentavos ?? 0,
    p_cantidad: m.cantidad ?? null,
    p_unidad: m.unidad ?? null,
    p_referencia_tipo: m.referenciaTipo ?? null,
    p_referencia_id: m.referenciaId ?? null,
    p_stripe_id: m.stripeId ?? null,
    p_detalle: m.detalle ?? {},
    p_creado_por: m.creadoPor ?? null,
  })
  if (error) throw new Error(`[wallet] ${error.message}`)
  const fila = (Array.isArray(data) ? data[0] : data) as
    | { movimiento_id: string; saldo_centavos: number; duplicado: boolean }
    | undefined
  return {
    movimientoId: fila?.movimiento_id ?? null,
    saldoCentavos: Number(fila?.saldo_centavos ?? 0),
    duplicado: fila?.duplicado === true,
  }
}

/**
 * Cobra un consumo, con la tarifa vigente del concepto.
 *
 * **Nunca lanza.** Se llama desde el camino que le contesta a un cliente y un
 * error de contabilidad no puede dejar a ese cliente sin respuesta. Si algo
 * falla queda en consola y el libro se corrige con un ajuste.
 */
export async function cobrar(
  db: SupabaseClient,
  workspaceId: string,
  args: {
    concepto: string
    /** Cuántas unidades: 1 respuesta, 2,4 minutos, 1,8 miles de caracteres. */
    cantidad: number
    /** Lo que le costó a Riverz, en USD. */
    costoUsd?: number
    referenciaTipo?: string
    referenciaId?: string | null
    detalle?: Record<string, unknown>
  },
): Promise<Resultado | null> {
  try {
    const tarifa = await tarifaDe(db, args.concepto)
    if (!tarifa) return null
    const centavos = centavosDe(tarifa, args.cantidad)
    if (centavos <= 0) return null
    return await mover(db, workspaceId, {
      tipo: 'consumo',
      concepto: args.concepto,
      centavos: -centavos,
      costoCentavos: Math.round((args.costoUsd ?? 0) * 100 * 1e6) / 1e6,
      cantidad: args.cantidad,
      unidad: tarifa.unidad,
      referenciaTipo: args.referenciaTipo ?? null,
      referenciaId: args.referenciaId ?? null,
      detalle: args.detalle,
    })
  } catch (e) {
    console.error('[wallet] no se pudo cobrar', args.concepto, e)
    return null
  }
}

/**
 * ¿Esta cuenta puede seguir consumiendo?
 *
 * Mientras `bloquear_sin_saldo` esté apagado —como nace— la respuesta es
 * siempre que sí y el saldo puede quedar negativo. Eso es a propósito: el día
 * que la billetera se estrena hay comercios andando con saldo cero, y dejarlos
 * mudos con SUS clientes sería cobrarles el estreno a ellos.
 */
export function puedeGastar(b: Billetera): boolean {
  if (!b.bloquearSinSaldo) return true
  return b.saldoCentavos > -Math.abs(b.descubiertoCentavos)
}

/** Atajo para el camino caliente: una sola consulta y una decisión. */
export async function puedeGastarCuenta(
  db: SupabaseClient,
  workspaceId: string,
): Promise<boolean> {
  try {
    const { data } = await db
      .from('wallet_accounts')
      .select('saldo_centavos, descubierto_centavos, bloquear_sin_saldo')
      .eq('workspace_id', workspaceId)
      .maybeSingle()
    if (!data) return true
    const f = data as unknown as FilaCuenta
    return puedeGastar(
      aBilletera({ ...f, workspace_id: workspaceId, moneda: 'usd' } as FilaCuenta),
    )
  } catch {
    // Ante la duda, se atiende al cliente. Un error nuestro no puede
    // convertirse en silencio para el cliente del comercio.
    return true
  }
}
