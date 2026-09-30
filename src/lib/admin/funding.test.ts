import { describe, expect, it } from 'vitest';
import { planFunding, type FundingSnapshot } from './funding';
import type { Proveedor } from './proveedores';

const now = Date.parse('2026-09-29T12:00:00Z');
const snapshot = (): FundingSnapshot => ({
  wallets: [],
  usage: [],
  manual: [],
  measured_at: new Date(now).toISOString(),
});
const provider = (
  id: string,
  saldo: number | null,
  unidad = 'USD'
): Proveedor => ({
  id,
  nombre: id,
  categoria: 'llm',
  recargable: true,
  estado: saldo === null ? 'desconocido' : 'ok',
  saldo,
  unidad,
  detalleKey: null,
  detalle: null,
  url: null,
});

describe('provider funding plan', () => {
  it('never uses money in another provider to offset a shortage', () => {
    const data = snapshot();
    data.usage = [
      { provider: 'fish', usd_week: 14 },
      { provider: 'telnyx', usd_week: 70 },
    ];
    const result = planFunding(
      data,
      [provider('fish', 500), provider('telnyx', 2)],
      7,
      now
    );
    expect(result.providers.find((p) => p.id === 'telnyx')).toMatchObject({
      topUpUsd: 68,
      daysLeft: 0.2,
    });
    expect(result.topUpUsd).toBe(68);
  });
  it('keeps unknown balances unknown rather than guessing a deposit', () => {
    const result = planFunding(
      snapshot(),
      [provider('anthropic', null)],
      7,
      now
    );
    expect(result.providers[0]).toMatchObject({
      saldo: null,
      topUpUsd: null,
      source: 'unknown',
      needsConfirmation: true,
    });
    expect(result.unknown).toBe(1);
  });
  it('deducts recorded usage from a recent manually confirmed balance', () => {
    const data = snapshot();
    data.manual = [
      {
        provider: 'anthropic',
        balance_usd: '20',
        spent_since_usd: '5.2',
        confirmed_at: new Date(now - 3600000).toISOString(),
      },
    ];
    data.usage = [{ provider: 'anthropic', usd_week: 35 }];
    const result = planFunding(data, [provider('anthropic', null)], 14, now);
    expect(result.providers[0]).toMatchObject({
      saldo: 14.8,
      source: 'estimate',
      topUpUsd: 56,
      targetUsd: 70,
    });
  });
  it('expires manual balances and rejects future timestamps', () => {
    for (const at of [now - 86400000, now + 1000]) {
      const data = snapshot();
      data.manual = [
        {
          provider: 'anthropic',
          balance_usd: 99,
          spent_since_usd: 1,
          confirmed_at: new Date(at).toISOString(),
        },
      ];
      expect(
        planFunding(data, [provider('anthropic', null)], 7, now).providers[0]
      ).toMatchObject({ saldo: null, topUpUsd: null, source: 'unknown' });
    }
  });
  it('does not convert quotas, characters or other currencies into USD', () => {
    const result = planFunding(
      snapshot(),
      [
        provider('elevenlabs', 10000, 'chars'),
        provider('telnyx', 50, 'EUR'),
        provider('apify', 10, 'limit_USD'),
      ],
      7,
      now
    );
    expect(result.providers.every((p) => p.topUpUsd === null)).toBe(true);
    expect(result.topUpUsd).toBe(0);
  });
  it('preserves independent merchant currency buckets and unallocated usage', () => {
    const data = snapshot();
    data.wallets = [
      {
        currency: 'USD',
        accounts: 2,
        balance_cents: '3000',
        reserved_cents: '100',
        available_cents: '2899.5',
      },
      {
        currency: 'EUR',
        accounts: 1,
        balance_cents: 500,
        reserved_cents: 0,
        available_cents: 500,
      },
    ];
    data.usage = [{ provider: 'voice_media', usd_week: 7 }];
    const result = planFunding(data, [], 30, now);
    expect(
      result.wallets.map((w) => [w.currency, w.balance, w.available])
    ).toEqual([
      ['USD', 30, 28.995],
      ['EUR', 5, 5],
    ]);
    expect(result.unallocatedUsd).toBe(7);
  });
  it('does not recommend funding from a failed or missing-key probe', () => {
    for (const estado of ['error', 'sin_llave'] as const) {
      const result = planFunding(
        snapshot(),
        [{ ...provider('fish', 0), estado }],
        7,
        now
      );
      expect(result.providers[0].topUpUsd).toBeNull();
    }
  });
  it('falls back to seven days for an invalid horizon', () => {
    expect(planFunding(snapshot(), [], NaN, now).days).toBe(7);
  });
  it('does not report known usage quotas as missing monetary balances', () => {
    const result = planFunding(
      snapshot(),
      [
        provider('firecrawl', 977, 'credits'),
        provider('elevenlabs', 9397, 'chars'),
        provider('anthropic', null),
      ],
      7,
      now
    );
    expect(result.unknown).toBe(1);
    expect(result.providers.find((p) => p.id === 'firecrawl')).toMatchObject({
      billingMode: 'quota',
      targetUsd: 0,
      topUpUsd: null,
      needsConfirmation: false,
    });
  });
  it('requires a confirmed postpaid plan and never represents it as cash', () => {
    const data = snapshot();
    data.manual = [
      {
        provider: 'groq',
        balance_usd: 0,
        spent_since_usd: 4,
        billing_mode: 'postpaid',
        confirmed_at: new Date(now - 7 * 86400000).toISOString(),
      },
    ];
    data.usage = [{ provider: 'groq', usd_week: 70 }];
    const result = planFunding(data, [provider('groq', null)], 30, now);
    expect(result.providers[0]).toMatchObject({
      source: 'postpaid',
      billingMode: 'postpaid',
      saldo: null,
      topUpUsd: 0,
      targetUsd: 0,
      daysLeft: null,
      dailyUsd: 10,
    });
    expect(result.unknown).toBe(0);
    expect(
      planFunding(snapshot(), [provider('groq', null)], 7, now).unknown
    ).toBe(1);
  });
  it('preserves billing errors even on a confirmed postpaid plan', () => {
    const data = snapshot();
    data.manual = [
      {
        provider: 'groq',
        balance_usd: 0,
        spent_since_usd: 0,
        billing_mode: 'postpaid',
        confirmed_at: new Date(now).toISOString(),
      },
    ];
    for (const estado of ['error', 'sin_saldo', 'sin_llave'] as const) {
      const row = planFunding(
        data,
        [{ ...provider('groq', null), estado }],
        7,
        now
      ).providers[0];
      expect(row.estado).toBe(estado);
      expect(row.topUpUsd).toBeNull();
    }
  });
  it('keeps a real API balance authoritative over a manual billing declaration', () => {
    const data = snapshot();
    data.manual = [
      {
        provider: 'anthropic',
        balance_usd: 0,
        spent_since_usd: 0,
        billing_mode: 'postpaid',
        confirmed_at: new Date(now).toISOString(),
      },
    ];
    expect(
      planFunding(data, [provider('anthropic', 5)], 7, now).providers[0]
    ).toMatchObject({
      saldo: 5,
      source: 'api',
      billingMode: 'prepaid',
      topUpUsd: 5,
    });
  });
  it('does not request a balance for an unconnected provider', () => {
    expect(
      planFunding(
        snapshot(),
        [{ ...provider('openai', null), estado: 'sin_llave' }],
        7,
        now
      ).providers[0].needsConfirmation
    ).toBe(false);
  });
  it('backs current merchant balances dollar for dollar rather than projecting days', () => {
    const data = snapshot();
    data.wallets = [
      {
        currency: 'USD',
        accounts: 15,
        balance_cents: 4434,
        reserved_cents: 20,
        available_cents: 4414,
      },
      {
        currency: 'EUR',
        accounts: 1,
        balance_cents: 99900,
        reserved_cents: 0,
        available_cents: 99900,
      },
    ];
    data.usage = [{ provider: 'anthropic', usd_week: 60 }];
    const result = planFunding(
      data,
      [provider('anthropic', 11.94), provider('deepgram', 500)],
      30,
      now,
      'merchants'
    );
    expect(result.backing).toEqual({
      targetUsd: 44.34,
      balanceUsd: 11.94,
      gapUsd: 32.4,
      topUpUsd: 33,
    });
    expect(result.providers.find((p) => p.id === 'anthropic')).toMatchObject({
      targetUsd: 44.34,
      topUpUsd: 33,
    });
    expect(result.topUpUsd).toBe(33);
  });
  it('recomputes backing on merchant top-ups, preserves unknown balances and never suggests a negative deposit', () => {
    const data = snapshot();
    data.wallets = [
      {
        currency: 'USD',
        accounts: 1,
        balance_cents: 5000,
        reserved_cents: 0,
        available_cents: 5000,
      },
    ];
    expect(
      planFunding(data, [provider('anthropic', 10)], 7, now, 'merchants')
        .backing.topUpUsd
    ).toBe(40);
    expect(
      planFunding(data, [provider('anthropic', 100)], 7, now, 'merchants')
        .backing.topUpUsd
    ).toBe(0);
    expect(
      planFunding(data, [provider('anthropic', null)], 7, now, 'merchants')
        .backing.topUpUsd
    ).toBeNull();
    data.wallets[0].balance_cents = 10000;
    expect(
      planFunding(data, [provider('anthropic', 10)], 7, now, 'merchants')
        .backing.topUpUsd
    ).toBe(90);
  });
});
