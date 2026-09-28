import { expect, it } from 'vitest';
import { explainCharges } from './explanation';
import {
  listSnapshotMovements,
  summarizeMovements,
  type MovimientoResumen,
} from './movimientos';

const row = (
  id: string,
  cents: number,
  concept = 'ia_respuesta',
  detail: Record<string, unknown> = {}
): MovimientoResumen => ({
  id,
  tipo: 'consumo',
  concepto: concept,
  centavos: cents,
  cantidad: 1,
  creado_en: '2026-09-28T13:00:00Z',
  saldo_despues_centavos: 1000,
  detalle: detail,
});
const range = { desde: '2026-09-28T00:00:00Z', hasta: '2026-09-29T00:00:00Z' };
it('explains every cent once by recorded source and service without inventing historical channels or sends', () => {
  const rows = [
    row('wa', -754, 'ia_respuesta', {
      canal: 'whatsapp',
      para: 'respuesta',
      usage: { input_tokens: 100, output_tokens: 50 },
    }),
    row('history', -680),
    row('classify', -8, 'ia_clasificacion'),
    row('free', 0),
    { ...row('credit', 2500, 'recarga'), tipo: 'recarga' },
    row('fee', -5, 'comision_stripe'),
  ];
  const result = explainCharges(rows);
  expect(result.charges).toBe(3);
  expect(result.chargedCentavos).toBe(1442);
  expect(result.chargedCentavos).toBe(
    summarizeMovements(rows, range).gastadoCentavos
  );
  expect(
    result.sources.find((s) => s.channel === 'whatsapp')?.services[0]
  ).toMatchObject({ charges: 1, tokens: 150, chargedCentavos: 754 });
  expect(
    result.sources
      .filter((s) => s.channel === null)
      .map((s) => s.services[0].concepto)
      .sort()
  ).toEqual(['ia_clasificacion', 'ia_respuesta']);
  expect(
    result.sources.reduce(
      (sum, s) =>
        sum + s.services.reduce((n, item) => n + item.chargedCentavos, 0),
      0
    )
  ).toBe(1442);
});
it('filters the audit ledger by exactly the source and service used in the summary; retains timestamps and amounts privately', () => {
  const rows = [
    row('wa', -5, 'ia_respuesta', {
      canal: 'whatsapp',
      proveedor: 'secret-provider',
      modelo: 'secret-model',
      usage: { input_tokens: 10 },
    }),
    row('ig', -10, 'ia_respuesta', { canal: 'instagram' }),
    row('missing', -7, 'ia_respuesta'),
  ];
  const selected = listSnapshotMovements(rows, {
    concepto: 'ia_respuesta',
    channel: 'whatsapp',
  });
  expect(selected.filas.map((r) => r.id)).toEqual(['wa']);
  expect(selected.filas[0]).toMatchObject({
    creadoEn: '2026-09-28T13:00:00Z',
    centavos: -5,
    saldoDespuesCentavos: 1000,
    detalle: { canal: 'whatsapp', usage: { input_tokens: 10 } },
  });
  expect(JSON.stringify(selected)).not.toContain('secret-');
  expect(
    listSnapshotMovements(rows, { channel: 'unattributed' }).filas.map(
      (r) => r.id
    )
  ).toEqual(['missing']);
});
it('keeps stable pagination for coincident timestamps and does not mutate the financial snapshot', () => {
  const rows = Array.from({ length: 51 }, (_, n) =>
    row(String(n).padStart(2, '0'), -1)
  );
  const before = structuredClone(rows);
  const first = listSnapshotMovements(rows, {}),
    second = listSnapshotMovements(rows, { pagina: 1 });
  expect(first.filas).toHaveLength(50);
  expect(first.hayMas).toBe(true);
  expect(second.filas).toHaveLength(1);
  expect(second.hayMas).toBe(false);
  expect(new Set([...first.filas, ...second.filas].map((r) => r.id)).size).toBe(
    51
  );
  expect(rows).toEqual(before);
});
it('opens only the exact purpose included in a service subtotal', () => {
  const rows = [
    row('classify', -3, 'ia_clasificacion', {
      canal: 'whatsapp',
      para: 'escalada',
    }),
    row('check', -7, 'ia_clasificacion', {
      canal: 'whatsapp',
      para: 'cierre_sin_respuesta',
    }),
    row('old', -5, 'ia_clasificacion', { canal: 'whatsapp' }),
  ];
  expect(
    listSnapshotMovements(rows, {
      concepto: 'ia_clasificacion',
      channel: 'whatsapp',
      purpose: 'escalada',
    }).filas.map((r) => r.id)
  ).toEqual(['classify']);
  expect(
    listSnapshotMovements(rows, { purpose: '__none__' }).filas.map((r) => r.id)
  ).toEqual(['old']);
});
it('accounts for measured prompt and completion tokens in alternative usage formats', () => {
  expect(
    explainCharges([
      row('different-format', -1, 'ia_clasificacion', {
        usage: { prompt_tokens: 40, completion_tokens: 10 },
      }),
    ]).sources[0].services[0].tokens
  ).toBe(50);
});
