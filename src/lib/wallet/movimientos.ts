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
import type { SupabaseClient } from '@supabase/supabase-js';

export interface Fila {
  id: string;
  creadoEn: string;
  tipo: string;
  concepto: string;
  centavos: number;
  saldoDespuesCentavos: number;
  cantidad: number | null;
  unidad: string | null;
  referenciaTipo: string | null;
  referenciaId: string | null;
  detalle: Record<string, unknown>;
}

interface FilaCruda {
  id: string;
  creado_en: string;
  tipo: string;
  concepto: string;
  centavos: number;
  saldo_despues_centavos: number;
  cantidad: number | null;
  unidad: string | null;
  referencia_tipo: string | null;
  referencia_id: string | null;
  detalle: Record<string, unknown> | null;
}

export type MovimientoResumen = Pick<
  FilaCruda,
  'tipo' | 'concepto' | 'centavos' | 'cantidad' | 'creado_en'
> &
  Partial<
    Pick<
      FilaCruda,
      | 'id'
      | 'referencia_tipo'
      | 'referencia_id'
      | 'detalle'
      | 'saldo_despues_centavos'
      | 'unidad'
    >
  > & { stripe_id?: string | null };

export function esConsumoCobrado(f: MovimientoResumen): boolean {
  return (
    f.tipo === 'consumo' &&
    f.concepto !== 'comision_stripe' &&
    Number(f.centavos) < 0
  );
}

const COLUMNAS =
  'id, creado_en, tipo, concepto, centavos, saldo_despues_centavos, cantidad, unidad, referencia_tipo, referencia_id, detalle';

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
    detalle: merchantMovementDetail(f.detalle),
  };
}

export interface Rango {
  desde: string;
  hasta: string;
}

/**
 * El rango pedido, saneado.
 *
 * Sin nada, los últimos 30 días. Con fechas inválidas, lo mismo: nunca se
 * arrastra a la consulta un texto que el cliente escribió.
 */
export function rangoDe(desde?: string | null, hasta?: string | null): Rango {
  const ahora = Date.now();
  const valida = (v: string | null | undefined): number | null => {
    if (!v) return null;
    const t = Date.parse(v);
    return Number.isFinite(t) ? t : null;
  };
  const h = valida(hasta) ?? ahora;
  const d = valida(desde) ?? h - 30 * 24 * 60 * 60 * 1000;
  return {
    desde: new Date(Math.min(d, h)).toISOString(),
    hasta: new Date(Math.max(d, h)).toISOString(),
  };
}

export interface PorConcepto {
  concepto: string;
  centavos: number;
  cantidad: number;
  movimientos: number;
  /**
   * Lo que salió cada unidad, de verdad.
   *
   * Es el promedio medido de ESTA cuenta, no la tarifa: en la cuenta que paga a
   * costo, la tarifa no es lo que se le cobra, y en cualquier caso una
   * respuesta corta y una larga no cuestan lo mismo. Null cuando no hubo
   * cantidad que promediar.
   */
  porUnidadCentavos: number | null;
}

export interface PorDia {
  dia: string;
  gastadoCentavos: number;
  cargadoCentavos: number;
}

export interface Resumen {
  rango: Rango;
  cargadoCentavos: number;
  gastadoCentavos: number;
  ajustesCentavos: number;
  porConcepto: PorConcepto[];
  porDia: PorDia[];
  movimientos: number;
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
  timezone = 'UTC'
): Promise<Resumen> {
  return summarizeMovements(
    await movimientosDelPeriodo(db, workspaceId, rango),
    rango,
    timezone
  );
}

/** Shared snapshot for spend, activity and measured prices. Zero-charge test
 * and courtesy records remain in the audit ledger but not merchant usage. */
export async function movimientosDelPeriodo(
  db: SupabaseClient,
  workspaceId: string,
  rango: Rango
): Promise<MovimientoResumen[]> {
  const filas: MovimientoResumen[] = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await db
      .from('wallet_movimientos')
      .select(`${COLUMNAS}, stripe_id`)
      .eq('workspace_id', workspaceId)
      .gte('creado_en', rango.desde)
      .lt('creado_en', rango.hasta)
      .order('creado_en', { ascending: false })
      .order('id', { ascending: false })
      .range(offset, offset + 999);
    if (error) throw new Error(`[wallet] ${error.message}`);
    filas.push(...(data ?? []));
    if (!data || data.length < 1000) break;
    if (offset >= 99000) throw new Error('wallet_summary_range_too_large');
  }
  return filas.filter((f) => Number(f.centavos) !== 0);
}

export function summarizeMovements(
  filas: MovimientoResumen[],
  rango: Rango,
  timezone = 'UTC'
): Resumen {
  const conceptos = new Map<string, PorConcepto>();
  const dias = new Map<string, PorDia>();
  let cargado = 0;
  let gastado = 0;
  let ajustes = 0;
  let movimientos = 0;
  const dateFormat = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });

  for (const f of filas) {
    const c = Number(f.centavos ?? 0);
    if (!c) continue;
    movimientos++;
    const parts = dateFormat.formatToParts(new Date(f.creado_en));
    const part = (key: string) => parts.find((p) => p.type === key)?.value;
    const dia = `${part('year')}-${part('month')}-${part('day')}`;
    const d = dias.get(dia) ?? { dia, gastadoCentavos: 0, cargadoCentavos: 0 };
    if (f.tipo === 'recarga' && c > 0) {
      cargado += c;
      d.cargadoCentavos += c;
    } else if (esConsumoCobrado(f)) {
      gastado += -c;
      d.gastadoCentavos += -c;
      const acc = conceptos.get(f.concepto) ?? {
        concepto: f.concepto,
        centavos: 0,
        cantidad: 0,
        movimientos: 0,
        porUnidadCentavos: null,
      };
      acc.centavos += -c;
      acc.cantidad += Number(f.cantidad ?? 0);
      acc.movimientos += 1;
      conceptos.set(f.concepto, acc);
    } else {
      ajustes += c;
    }
    dias.set(dia, d);
  }

  return {
    rango,
    cargadoCentavos: cargado,
    gastadoCentavos: gastado,
    ajustesCentavos: ajustes,
    movimientos,
    porConcepto: [...conceptos.values()]
      .map((c) => ({
        ...c,
        porUnidadCentavos: c.cantidad > 0 ? c.centavos / c.cantidad : null,
      }))
      .sort((a, b) => b.centavos - a.centavos),
    porDia: [...dias.values()]
      .filter((d) => d.gastadoCentavos > 0 || d.cargadoCentavos > 0)
      .sort((a, b) => a.dia.localeCompare(b.dia)),
  };
}

/** La lista, paginada. `concepto` vacío = todos. */
export async function listar(
  db: SupabaseClient,
  workspaceId: string,
  opts: {
    rango: Rango;
    concepto?: string | null;
    tipo?: string | null;
    pagina?: number;
    porPagina?: number;
  }
): Promise<{ filas: Fila[]; hayMas: boolean }> {
  const porPagina = Math.min(Math.max(opts.porPagina ?? 50, 1), 200);
  const pagina = Math.max(opts.pagina ?? 0, 0);
  const desde = pagina * porPagina;

  let q = db
    .from('wallet_movimientos')
    .select(COLUMNAS)
    .eq('workspace_id', workspaceId)
    .gte('creado_en', opts.rango.desde)
    .lt('creado_en', opts.rango.hasta)
    .neq('centavos', 0)
    .order('creado_en', { ascending: false })
    .order('id', { ascending: false })
    .range(desde, desde + porPagina); // uno de más: así se sabe si hay página siguiente

  if (opts.concepto) q = q.eq('concepto', opts.concepto);
  if (opts.tipo) q = q.eq('tipo', opts.tipo);

  const { data, error } = await q;
  if (error) throw new Error(`[wallet] ${error.message}`);
  const crudas = (data ?? []) as unknown as FilaCruda[];
  const ids = crudas
    .filter(
      (f) => f.referencia_tipo === 'provider_operation' && f.referencia_id
    )
    .map((f) => f.referencia_id!);
  if (ids.length) {
    const operations = await db
      .from('wallet_operaciones')
      .select('id,detalle')
      .eq('workspace_id', workspaceId)
      .in('id', ids);
    if (operations.error)
      throw new Error(`[wallet] ${operations.error.message}`);
    const details = new Map(
      (operations.data ?? []).map((o) => [o.id, o.detalle])
    );
    for (const f of crudas)
      if (f.referencia_id)
        f.detalle = { ...details.get(f.referencia_id), ...f.detalle };
  }
  return {
    filas: crudas.slice(0, porPagina).map(aFila),
    hayMas: crudas.length > porPagina,
  };
}

/** Only business evidence leaves the server; provider/model/credentials stay private. */
export function merchantMovementDetail(
  detail: Record<string, unknown> | null | undefined
) {
  const allowed = [
    'para',
    'canal',
    'channel',
    'conversacion',
    'billingContactId',
    'superficie',
    'usage',
    'segundos',
    'callId',
    'mensaje',
  ];
  return Object.fromEntries(
    allowed
      .filter((key) => detail?.[key] !== undefined)
      .map((key) => [key, detail![key]])
  );
}

/** Pagination and filters over the same immutable snapshot used by all totals. */
export function listSnapshotMovements(
  rows: MovimientoResumen[],
  opts: {
    concepto?: string | null;
    channel?: string | null;
    purpose?: string | null;
    pagina?: number;
  }
) {
  const size = 50;
  const page = Math.max(
    0,
    Math.floor(Number.isFinite(opts.pagina) ? opts.pagina! : 0)
  );
  const filtered = rows
    .filter(
      (row) =>
        (!opts.concepto || row.concepto === opts.concepto) &&
        (!opts.purpose || (row.detalle?.para ?? '__none__') === opts.purpose) &&
        (!opts.channel ||
          (row.detalle?.canal ?? row.detalle?.channel ?? 'unattributed') ===
            opts.channel)
    )
    .sort(
      (a, b) =>
        Date.parse(b.creado_en) - Date.parse(a.creado_en) ||
        (b.id ?? '').localeCompare(a.id ?? '')
    );
  return {
    filas: filtered.slice(page * size, (page + 1) * size).map((row) =>
      aFila({
        ...row,
        id: row.id!,
        saldo_despues_centavos: row.saldo_despues_centavos ?? 0,
        unidad: row.unidad ?? null,
        referencia_tipo: row.referencia_tipo ?? null,
        referencia_id: row.referencia_id ?? null,
        detalle: row.detalle ?? {},
      })
    ),
    hayMas: filtered.length > (page + 1) * size,
  };
}
