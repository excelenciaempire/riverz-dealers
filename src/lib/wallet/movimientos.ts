/**
 * Lo que el comercio ve: en qué se le fue la plata.
 *
 * Dos lecturas sobre el mismo libro. El **resumen** contesta "¿en qué se fue?"
 * —cuánto entró, cuánto salió y repartido por concepto— y el **detalle** es la
 * lista de movimientos, uno por línea, para el que quiere ver el evento exacto.
 *
 * El rango de fechas es del cliente y llega como texto. Se valida acá: una
 * fecha inventada no puede terminar en un `gte` que devuelva el libro entero.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

export interface Fila {
  id: string
  creadoEn: string
  tipo: string
  concepto: string
  centavos: number
  saldoDespuesCentavos: number
  cantidad: number | null
  unidad: string | null
  referenciaTipo: string | null
  referenciaId: string | null
  detalle: Record<string, unknown>
}

interface FilaCruda {
  id: string
  creado_en: string
  tipo: string
  concepto: string
  centavos: number
  saldo_despues_centavos: number
  cantidad: number | null
  unidad: string | null
  referencia_tipo: string | null
  referencia_id: string | null
  detalle: Record<string, unknown> | null
}

const COLUMNAS =
  'id, creado_en, tipo, concepto, centavos, saldo_despues_centavos, cantidad, unidad, referencia_tipo, referencia_id, detalle'

function aFila(f: FilaCruda): Fila {
  return {
    id: f.id,
    creadoEn: f.creado_en,
    tipo: f.tipo,
    concepto: f.concepto,
    centavos: Number(f.centavos ?? 0),
    saldoDespuesCentavos: Number(f.saldo_despues_centavos ?? 0),
    cantidad: f.cantidad === null ? null : Number(f.cantidad),
    unidad: f.unidad,
    referenciaTipo: f.referencia_tipo,
    referenciaId: f.referencia_id,
    detalle: f.detalle ?? {},
  }
}

export interface Rango {
  desde: string
  hasta: string
}

/**
 * El rango pedido, saneado.
 *
 * Sin nada, los últimos 30 días. Con fechas inválidas, lo mismo: nunca se
 * arrastra a la consulta un texto que el cliente escribió.
 */
export function rangoDe(desde?: string | null, hasta?: string | null): Rango {
  const ahora = Date.now()
  const valida = (v: string | null | undefined): number | null => {
    if (!v) return null
    const t = Date.parse(v)
    return Number.isFinite(t) ? t : null
  }
  const h = valida(hasta) ?? ahora
  const d = valida(desde) ?? h - 30 * 24 * 60 * 60 * 1000
  return {
    desde: new Date(Math.min(d, h)).toISOString(),
    hasta: new Date(Math.max(d, h)).toISOString(),
  }
}

export interface PorConcepto {
  concepto: string
  centavos: number
  cantidad: number
  movimientos: number
}

export interface PorDia {
  dia: string
  gastadoCentavos: number
  cargadoCentavos: number
}

export interface Resumen {
  rango: Rango
  cargadoCentavos: number
  gastadoCentavos: number
  porConcepto: PorConcepto[]
  porDia: PorDia[]
  movimientos: number
}

/**
 * Cuánto entró, cuánto salió y en qué.
 *
 * Se suma en memoria y no con un `group by` en SQL a propósito: son los
 * movimientos de un comercio en un rango, no toda la tabla, y así el panel no
 * necesita una vista ni un RPC nuevo cada vez que quiero cortar distinto.
 * El techo de filas está puesto donde deja de tener sentido leer una lista.
 */
export async function resumen(
  db: SupabaseClient,
  workspaceId: string,
  rango: Rango,
): Promise<Resumen> {
  const { data, error } = await db
    .from('wallet_movimientos')
    .select('tipo, concepto, centavos, cantidad, creado_en')
    .eq('workspace_id', workspaceId)
    .gte('creado_en', rango.desde)
    .lte('creado_en', rango.hasta)
    .order('creado_en', { ascending: false })
    .limit(50_000)
  if (error) throw new Error(`[wallet] ${error.message}`)

  const filas = (data ?? []) as {
    tipo: string
    concepto: string
    centavos: number
    cantidad: number | null
    creado_en: string
  }[]

  const conceptos = new Map<string, PorConcepto>()
  const dias = new Map<string, PorDia>()
  let cargado = 0
  let gastado = 0

  for (const f of filas) {
    const c = Number(f.centavos ?? 0)
    const dia = f.creado_en.slice(0, 10)
    const d = dias.get(dia) ?? { dia, gastadoCentavos: 0, cargadoCentavos: 0 }
    if (c >= 0) {
      cargado += c
      d.cargadoCentavos += c
    } else {
      gastado += -c
      d.gastadoCentavos += -c
      const acc =
        conceptos.get(f.concepto) ??
        { concepto: f.concepto, centavos: 0, cantidad: 0, movimientos: 0 }
      acc.centavos += -c
      acc.cantidad += Number(f.cantidad ?? 0)
      acc.movimientos += 1
      conceptos.set(f.concepto, acc)
    }
    dias.set(dia, d)
  }

  return {
    rango,
    cargadoCentavos: cargado,
    gastadoCentavos: gastado,
    movimientos: filas.length,
    porConcepto: [...conceptos.values()].sort((a, b) => b.centavos - a.centavos),
    porDia: [...dias.values()].sort((a, b) => a.dia.localeCompare(b.dia)),
  }
}

/** La lista, paginada. `concepto` vacío = todos. */
export async function listar(
  db: SupabaseClient,
  workspaceId: string,
  opts: { rango: Rango; concepto?: string | null; tipo?: string | null; pagina?: number; porPagina?: number },
): Promise<{ filas: Fila[]; hayMas: boolean }> {
  const porPagina = Math.min(Math.max(opts.porPagina ?? 50, 1), 200)
  const pagina = Math.max(opts.pagina ?? 0, 0)
  const desde = pagina * porPagina

  let q = db
    .from('wallet_movimientos')
    .select(COLUMNAS)
    .eq('workspace_id', workspaceId)
    .gte('creado_en', opts.rango.desde)
    .lte('creado_en', opts.rango.hasta)
    .order('creado_en', { ascending: false })
    .range(desde, desde + porPagina) // uno de más: así se sabe si hay página siguiente

  if (opts.concepto) q = q.eq('concepto', opts.concepto)
  if (opts.tipo) q = q.eq('tipo', opts.tipo)

  const { data, error } = await q
  if (error) throw new Error(`[wallet] ${error.message}`)
  const crudas = (data ?? []) as unknown as FilaCruda[]
  return {
    filas: crudas.slice(0, porPagina).map(aFila),
    hayMas: crudas.length > porPagina,
  }
}
