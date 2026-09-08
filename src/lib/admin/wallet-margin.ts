export type WalletMarginProviderRow = {
  proveedor: string;
  movimientos: number | string;
  costo_centavos: number | string;
  cobrado_centavos: number | string;
  ultimo_movimiento: string | null;
};

export type WalletPendingRow = {
  id: string;
  workspace_id: string;
  concepto: string;
  proveedor: string;
  reserva_centavos: number;
  created_at: string;
};

export type WalletMargin = {
  costoVariableUsd: number;
  cobradoUsd: number;
  fraccionPendienteUsd: number;
  diferenciaUsd: number;
  reservasUsd: number;
  pendientes: number;
  pendientesVencidas: number;
  pendienteMasAntigua: string | null;
  proveedores: Array<{
    proveedor: string;
    movimientos: number;
    costoUsd: number;
    cobradoUsd: number;
    diferenciaUsd: number;
    ultimoMovimiento: string | null;
  }>;
};

const number = (value: number | string | null | undefined) => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};

export function summarizeWalletMargin(
  rows: WalletMarginProviderRow[],
  pending: WalletPendingRow[],
  remainders: Array<{ resto_costo_centavos: number | string }> = [],
  nowMs = Date.now()
): WalletMargin {
  const proveedores = rows
    .map((row) => {
      const costoUsd = number(row.costo_centavos) / 100;
      const cobradoUsd = number(row.cobrado_centavos) / 100;
      return {
        proveedor: row.proveedor,
        movimientos: number(row.movimientos),
        costoUsd,
        cobradoUsd,
        diferenciaUsd: cobradoUsd - costoUsd,
        ultimoMovimiento: row.ultimo_movimiento,
      };
    })
    .sort((a, b) => b.costoUsd - a.costoUsd);

  const costoVariableUsd = proveedores.reduce(
    (sum, row) => sum + row.costoUsd,
    0
  );
  const cobradoUsd = proveedores.reduce((sum, row) => sum + row.cobradoUsd, 0);
  const fraccionPendienteUsd =
    remainders.reduce((sum, row) => sum + number(row.resto_costo_centavos), 0) /
    100;

  return {
    costoVariableUsd,
    cobradoUsd,
    fraccionPendienteUsd,
    diferenciaUsd: cobradoUsd + fraccionPendienteUsd - costoVariableUsd,
    reservasUsd:
      pending.reduce((sum, row) => sum + number(row.reserva_centavos), 0) / 100,
    pendientes: pending.length,
    pendientesVencidas: pending.filter(
      (row) => nowMs - new Date(row.created_at).getTime() > 15 * 60 * 1000
    ).length,
    pendienteMasAntigua: pending[0]?.created_at ?? null,
    proveedores,
  };
}
