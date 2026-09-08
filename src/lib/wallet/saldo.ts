/** Wallet ledger. Provider usage is settled atomically by wallet_liquidar; credits and adjustments use wallet_mover. */
import type { SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { liquidar } from './operacion';

export interface Billetera {
  workspaceId: string;
  saldoCentavos: number;
  reservadoCentavos?: number;
  moneda: string;
  /** Cuánto puede quedar en rojo antes de cortar. */
  descubiertoCentavos: number;
  /** Las operaciones nuevas requieren saldo disponible. */
  bloquearSinSaldo: boolean;
  autoRecargaCentavos: number | null;
  autoUmbralCentavos: number | null;
  /** Si hay una tarjeta guardada en Stripe para cobrar sin que nadie mire. */
  tieneTarjeta: boolean;
  /** La marca, para el logo. Null si se guardó antes de que se registrara. */
  tarjetaMarca: string | null;
  /** Los últimos cuatro: lo único que hace falta para reconocerla. */
  tarjetaUltimos4: string | null;
  /**
   * El consumo se descuenta a lo que costó, sin margen. Para los primeros
   * clientes, mientras el precio todavía se está descubriendo.
   */
  cobrarACosto: boolean;
  /** Rechazos seguidos del cobro automático. A los 3 se deja de intentar. */
  autoFallos: number;
  /** Por qué falló el último intento, en el idioma de Stripe. */
  autoUltimoError: string | null;
}

interface FilaCuenta {
  workspace_id: string;
  saldo_centavos: number;
  reservado_centavos?: number;
  moneda: string;
  descubierto_centavos: number;
  bloquear_sin_saldo: boolean;
  auto_recarga_centavos: number | null;
  auto_umbral_centavos: number | null;
  stripe_payment_method_id: string | null;
  tarjeta_marca: string | null;
  tarjeta_ultimos4: string | null;
  cobrar_a_costo: boolean | null;
  auto_fallos: number | null;
  auto_ultimo_error: string | null;
}

const COLUMNAS =
  'workspace_id, saldo_centavos, reservado_centavos, moneda, descubierto_centavos, bloquear_sin_saldo, auto_recarga_centavos, auto_umbral_centavos, stripe_payment_method_id, tarjeta_marca, tarjeta_ultimos4, cobrar_a_costo, auto_fallos, auto_ultimo_error';

function aBilletera(f: FilaCuenta): Billetera {
  return {
    workspaceId: f.workspace_id,
    saldoCentavos: Number(f.saldo_centavos ?? 0),
    reservadoCentavos: Number(f.reservado_centavos ?? 0),
    moneda: f.moneda ?? 'usd',
    descubiertoCentavos: f.descubierto_centavos ?? 0,
    bloquearSinSaldo: f.bloquear_sin_saldo === true,
    autoRecargaCentavos: f.auto_recarga_centavos,
    autoUmbralCentavos: f.auto_umbral_centavos,
    tieneTarjeta: Boolean(f.stripe_payment_method_id),
    tarjetaMarca: f.tarjeta_marca ?? null,
    tarjetaUltimos4: f.tarjeta_ultimos4 ?? null,
    cobrarACosto: f.cobrar_a_costo === true,
    autoFallos: f.auto_fallos ?? 0,
    autoUltimoError: f.auto_ultimo_error ?? null,
  };
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
  workspaceId: string
): Promise<Billetera> {
  const { data, error } = await db
    .from('wallet_accounts')
    .select(COLUMNAS)
    .eq('workspace_id', workspaceId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (data) return aBilletera(data as unknown as FilaCuenta);

  await db
    .from('wallet_accounts')
    .upsert({ workspace_id: workspaceId }, { onConflict: 'workspace_id' });
  const { data: creada } = await db
    .from('wallet_accounts')
    .select(COLUMNAS)
    .eq('workspace_id', workspaceId)
    .maybeSingle();
  return creada
    ? aBilletera(creada as unknown as FilaCuenta)
    : {
        workspaceId,
        saldoCentavos: 0,
        moneda: 'usd',
        descubiertoCentavos: 0,
        bloquearSinSaldo: true,
        autoRecargaCentavos: null,
        autoUmbralCentavos: null,
        tieneTarjeta: false,
        tarjetaMarca: null,
        tarjetaUltimos4: null,
        cobrarACosto: true,
        autoFallos: 0,
        autoUltimoError: null,
      };
}

export interface Movimiento {
  tipo: 'recarga' | 'consumo' | 'bono' | 'ajuste' | 'reembolso';
  concepto: string;
  /** Firmado: positivo suma, negativo resta. */
  centavos: number;
  /** Lo que le costó a Riverz, en centavos. Sólo en consumos. */
  costoCentavos?: number;
  cantidad?: number | null;
  unidad?: string | null;
  referenciaTipo?: string | null;
  referenciaId?: string | null;
  /** Id del pago de Stripe. Hace la recarga idempotente. */
  stripeId?: string | null;
  detalle?: Record<string, unknown>;
  creadoPor?: string | null;
}

export interface Resultado {
  movimientoId: string | null;
  saldoCentavos: number;
  duplicado: boolean;
}

/** Escribe un movimiento y devuelve el saldo nuevo. Atómico, vía RPC. */
export async function mover(
  db: SupabaseClient,
  workspaceId: string,
  m: Movimiento
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
  });
  if (error) throw new Error(`[wallet] ${error.message}`);
  const fila = (Array.isArray(data) ? data[0] : data) as
    | { movimiento_id: string; saldo_centavos: number; duplicado: boolean }
    | undefined;
  return {
    movimientoId: fila?.movimiento_id ?? null,
    saldoCentavos: Number(fila?.saldo_centavos ?? 0),
    duplicado: fila?.duplicado === true,
  };
}

/** Settle measured provider usage at cost. Errors propagate; callers must not discard accounting. */
export async function cobrar(
  db: SupabaseClient,
  workspaceId: string,
  args: {
    concepto: string;
    /** Cuántas unidades: 1 respuesta, 2,4 minutos, 1,8 miles de caracteres. */
    cantidad: number;
    /** Lo que le costó a Riverz, en USD. */
    costoUsd?: number;
    referenciaTipo?: string;
    referenciaId?: string | null;
    detalle?: Record<string, unknown>;
  }
): Promise<Resultado | null> {
  if (!Number.isFinite(args.costoUsd) || (args.costoUsd ?? -1) < 0) {
    throw new Error('wallet_missing_provider_cost');
  }
  const id =
    typeof args.detalle?.operacionId === 'string'
      ? args.detalle.operacionId
      : randomUUID();
  const data = await liquidar(
    { db, workspaceId, concepto: args.concepto },
    id,
    String(args.detalle?.proveedor ?? 'legacy'),
    args.costoUsd!,
    {
      ...args.detalle,
      referenciaTipo: args.referenciaTipo,
      referenciaId: args.referenciaId,
    },
    args.cantidad
  );
  const row = Array.isArray(data) ? data[0] : data;
  return {
    movimientoId: row?.movimiento_id ?? null,
    saldoCentavos: Number(row?.saldo_centavos ?? 0),
    duplicado: row?.duplicado === true,
  };
}

/** Only unreserved, positive funds authorize new usage. */
export function puedeGastar(b: Billetera): boolean {
  return b.saldoCentavos - (b.reservadoCentavos ?? 0) > 0;
}

/** Atajo para el camino caliente: una sola consulta y una decisión. */
export async function puedeGastarCuenta(
  db: SupabaseClient,
  workspaceId: string
): Promise<boolean> {
  try {
    const { data } = await db
      .from('wallet_accounts')
      .select(
        'saldo_centavos, reservado_centavos, descubierto_centavos, bloquear_sin_saldo'
      )
      .eq('workspace_id', workspaceId)
      .maybeSingle();
    if (!data) return false;
    const f = data as unknown as FilaCuenta;
    return puedeGastar(
      aBilletera({
        ...f,
        workspace_id: workspaceId,
        moneda: 'usd',
      } as FilaCuenta)
    );
  } catch {
    // Billing availability must be verified before starting paid work.
    return false;
  }
}
