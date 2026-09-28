import { describe, expect, it, vi } from 'vitest';
import { listTopupHistory, topupOrigin } from './topup-history';

const row = (over: Record<string, unknown> = {}) => ({
  id: 'credit',
  creado_en: '2026-07-01T03:02:05Z',
  centavos: '2500',
  saldo_despues_centavos: '2600',
  stripe_id: 'pi_credit',
  detalle: { porWebhook: true },
  ...over,
});
function database(
  rows: Record<string, unknown>[],
  attempts: Record<string, unknown>[] = []
) {
  const ledger = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    gt: vi.fn().mockReturnThis(),
    gte: vi.fn().mockReturnThis(),
    lt: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    range: vi.fn().mockResolvedValue({ data: rows, error: null }),
  };
  const auto = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    in: vi.fn().mockResolvedValue({ data: attempts, error: null }),
  };
  const from = vi.fn((table: string) =>
    table === 'wallet_movimientos' ? ledger : auto
  );
  return { db: { from } as never, ledger, auto, from };
}

describe('credited top-up history', () => {
  it('applies the exact selected period to recharge history queries', async () => {
    const { db, ledger } = database([]);
    await listTopupHistory(db, 'ws', 0, undefined, {
      desde: '2026-09-28T05:00:00Z',
      hasta: '2026-09-29T05:00:00Z',
    });
    expect(ledger.gte).toHaveBeenCalledWith(
      'creado_en',
      '2026-09-28T05:00:00Z'
    );
    expect(ledger.lt).toHaveBeenCalledWith('creado_en', '2026-09-29T05:00:00Z');
  });
  it('uses the same supplied financial snapshot without rereading a different period', async () => {
    const { db, from } = database([]);
    const result = await listTopupHistory(db, 'ws', 0, undefined, undefined, [
      {
        id: 'credit',
        tipo: 'recarga',
        concepto: 'recarga',
        centavos: 2500,
        cantidad: 1,
        creado_en: '2026-09-28T12:00:00Z',
        saldo_despues_centavos: 3000,
        detalle: { origen: 'manual' },
      },
      {
        id: 'consumption',
        tipo: 'consumo',
        concepto: 'ia_respuesta',
        centavos: -5,
        cantidad: 1,
        creado_en: '2026-09-28T12:01:00Z',
      },
    ]);
    expect(result.filas).toHaveLength(1);
    expect(result.filas[0]).toMatchObject({
      id: 'credit',
      centavos: 2500,
      origen: 'manual',
    });
    expect(from).not.toHaveBeenCalled();
  });
  it('does not confuse webhook delivery with automatic payment', () => {
    expect(topupOrigin({ porWebhook: true })).toBe('desconocida');
    expect(topupOrigin({ automatica: true })).toBe('automatica');
    expect(topupOrigin({ origen: 'automatica' })).toBe('automatica');
    expect(topupOrigin({ sesion: 'cs_manual' })).toBe('manual');
    expect(topupOrigin({ origen: 'manual' })).toBe('manual');
  });
  it('scopes actual credits to the resolved workspace, with stable all-time pagination', async () => {
    const { db, ledger } = database([row({ detalle: { origen: 'manual' } })]);
    const result = await listTopupHistory(db, 'my-workspace', 2.9);
    expect(ledger.eq.mock.calls).toEqual([
      ['workspace_id', 'my-workspace'],
      ['tipo', 'recarga'],
    ]);
    expect(ledger.gt).toHaveBeenCalledWith('centavos', 0);
    expect(ledger.order.mock.calls).toEqual([
      ['creado_en', { ascending: false }],
      ['id', { ascending: false }],
    ]);
    expect(ledger.range).toHaveBeenCalledWith(40, 60);
    expect(result).toEqual({
      filas: [
        {
          id: 'credit',
          creadoEn: '2026-07-01T03:02:05Z',
          centavos: 2500,
          saldoDespuesCentavos: 2600,
          origen: 'manual',
        },
      ],
      hayMas: false,
    });
    expect(JSON.stringify(result)).not.toContain('pi_credit');
  });
  it('recovers old automatic origins even when the webhook won the credit race', async () => {
    const { db, auto } = database(
      [row()],
      [{ payment_intent_id: 'pi_credit' }]
    );
    const read = vi.fn();
    expect((await listTopupHistory(db, 'ws', 0, read)).filas[0].origen).toBe(
      'automatica'
    );
    expect(auto.eq).toHaveBeenCalledWith('workspace_id', 'ws');
    expect(read).not.toHaveBeenCalled();
  });
  it.each([
    ['automatica', 'automatica'],
    [undefined, 'manual'],
    ['manual', 'manual'],
  ])(
    'reads a legacy payment receipt with origin %s without rewriting the ledger',
    async (origin, expected) => {
      const { db } = database([row()]);
      const read = vi.fn().mockResolvedValue({
        metadata: {
          workspace_id: 'ws',
          tipo: 'recarga_billetera',
          origen: origin,
        },
      });
      expect((await listTopupHistory(db, 'ws', 0, read)).filas[0].origen).toBe(
        expected
      );
      expect(read).toHaveBeenCalledWith('pi_credit');
    }
  );
  it('does not trust receipts from another account or label unavailable evidence as manual', async () => {
    const { db } = database([row()]);
    for (const read of [
      vi.fn().mockRejectedValue(new Error('timeout')),
      vi.fn().mockResolvedValue({
        metadata: { workspace_id: 'other', tipo: 'recarga_billetera' },
      }),
      vi.fn().mockResolvedValue({
        metadata: { workspace_id: 'ws', tipo: 'subscription' },
      }),
    ]) {
      expect(
        (await listTopupHistory(db, 'ws', 0, read)).filas[0]
      ).toMatchObject({ origen: 'desconocida', centavos: 2500 });
    }
  });
  it('shows 20 rows and retains the next-page flag without enriching the extra row', async () => {
    const { db, ledger } = database(
      Array.from({ length: 21 }, (_, i) =>
        row({ id: String(i), detalle: { origen: 'manual' } })
      )
    );
    const result = await listTopupHistory(db, 'ws', Infinity);
    expect(result.filas).toHaveLength(20);
    expect(result.hayMas).toBe(true);
    expect(ledger.range).toHaveBeenCalledWith(0, 20);
  });
  it('reports database failures rather than presenting an empty history', async () => {
    const { db, ledger } = database([]);
    ledger.range.mockResolvedValue({
      data: null,
      error: { message: 'unavailable' },
    } as never);
    await expect(listTopupHistory(db, 'ws')).rejects.toThrow(
      'wallet_topup_history_unavailable'
    );
  });
});
