import { beforeEach, expect, it, vi } from 'vitest';
import { GET } from './route';
import type { MovimientoResumen } from '@/lib/wallet/movimientos';
const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  resolve: vi.fn(),
  movements: vi.fn(),
  evidence: vi.fn(),
  service: vi.fn(),
  topups: vi.fn(),
  costs: vi.fn(),
  db: { from: vi.fn() },
}));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: mocks.getUser } }),
}));
vi.mock('@/lib/automations/admin-client', () => ({
  supabaseAdmin: () => mocks.db,
}));
vi.mock('@/lib/workspaces/resolve', () => ({
  resolveWorkspaceIdForUser: mocks.resolve,
}));
vi.mock('@/lib/wallet/movimientos', async (original) => ({
  ...(await original<typeof import('@/lib/wallet/movimientos')>()),
  movimientosDelPeriodo: mocks.movements,
}));
vi.mock('@/lib/wallet/activity', async (original) => ({
  ...(await original<typeof import('@/lib/wallet/activity')>()),
  resolveBillingEvidence: mocks.evidence,
}));
vi.mock('@/lib/wallet/service-activity', () => ({
  serviceActivity: mocks.service,
}));
vi.mock('@/lib/wallet/topup-history', () => ({
  cachedTopupReader: (reader: unknown) => reader,
  listTopupHistory: mocks.topups,
}));
vi.mock('@/lib/wallet/costos', () => ({ costosReales: mocks.costs }));
vi.mock('@/lib/wallet/tarifas', () => ({ listarTarifas: async () => [] }));
vi.mock('@/lib/wallet/saldo', () => ({
  leerBilletera: async () => ({
    saldoCentavos: 2531,
    moneda: 'usd',
    bloquearSinSaldo: true,
  }),
}));
vi.mock('@/lib/billing/plan', () => ({
  leerSuscripcion: async () => ({ estado: 'activo' }),
  usaSaldo: () => true,
}));
vi.mock('@/lib/billing/stripe', () => ({
  stripeDisponible: () => false,
  stripe: vi.fn(),
}));
vi.mock('@/lib/i18n/server', () => ({ getLocale: async () => 'es' }));
beforeEach(() => {
  vi.clearAllMocks();
  mocks.getUser.mockResolvedValue({ data: { user: { id: 'owner' } } });
  mocks.resolve.mockResolvedValue('merchant');
  const query = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    single: vi
      .fn()
      .mockResolvedValue({ data: { timezone: 'America/Bogota' }, error: null }),
  };
  mocks.db.from.mockReturnValue(query);
  mocks.service.mockResolvedValue({
    contacts: 1,
    aiContacts: 1,
    sent: 2,
    aiMessages: 2,
    automated: 0,
    human: 0,
    other: 0,
    comments: 0,
    byChannel: [],
  });
  mocks.topups.mockResolvedValue({ filas: [], hayMas: false });
  mocks.costs.mockResolvedValue([]);
});
it('exposes service prices and inclusion without revealing internal software providers', async () => {
  const rows: MovimientoResumen[] = [
    {
      id: 'paid',
      tipo: 'consumo',
      concepto: 'ia_respuesta',
      centavos: -31,
      cantidad: 1,
      creado_en: '2026-09-27T12:00:00Z',
      detalle: { proveedor: 'Internal AI vendor', modelo: 'Internal model' },
    },
  ];
  mocks.movements.mockResolvedValue(rows);
  mocks.evidence.mockResolvedValue(rows);
  mocks.costs.mockResolvedValue([
    {
      concepto: 'ia_respuesta',
      nombreEs: 'Respuestas de la IA',
      nombreEn: 'AI replies',
      centavos: 2.531,
      unidad: 'respuesta',
      proveedor: 'Internal AI vendor',
      medido: true,
      cobro: 'por_uso',
    },
    {
      concepto: 'voz_stt',
      nombreEs: 'Transcripción',
      nombreEn: 'Transcription',
      centavos: 0.78,
      unidad: 'minuto',
      proveedor: 'Internal voice vendor',
      medido: false,
      cobro: 'incluido',
      dentroDeEs: 'Llamadas',
      dentroDeEn: 'Calls',
    },
    {
      concepto: 'comision_stripe',
      nombreEs: 'Vendor fee',
      proveedor: 'Internal payment vendor',
      centavos: 59,
    },
  ]);
  const response = await GET(
    new Request('https://riverz.test/api/wallet/estado')
  );
  const data = await response.json();
  expect(response.status).toBe(200);
  expect(data.saldoCentavos).toBe(2531);
  expect(data.resumen.gastadoCentavos).toBe(31);
  expect(data.costos).toHaveLength(2);
  expect(data.costos[0]).toEqual({
    concepto: 'ia_respuesta',
    nombreEs: 'Respuestas de la IA',
    nombreEn: 'AI replies',
    centavos: 2.531,
    unidad: 'respuesta',
    medido: true,
    cobro: 'por_uso',
  });
  expect(data.costos[1]).toMatchObject({
    cobro: 'incluido',
    dentroDeEs: 'Llamadas',
    dentroDeEn: 'Calls',
  });
  expect(JSON.stringify(data)).not.toContain('proveedor');
  expect(JSON.stringify(data)).not.toContain('Internal');
});
it('uses one resolved merchant, one selected range and one ledger snapshot for all monetary views', async () => {
  const rows: MovimientoResumen[] = [
    {
      id: 'charge',
      tipo: 'consumo',
      concepto: 'ia_respuesta',
      centavos: -12,
      cantidad: 1,
      creado_en: '2026-09-27T15:00:00Z',
      saldo_despues_centavos: 1000,
      detalle: {},
    },
    {
      id: 'credit',
      tipo: 'recarga',
      concepto: 'recarga',
      centavos: 2500,
      cantidad: 1,
      creado_en: '2026-09-27T13:00:00Z',
      saldo_despues_centavos: 1012,
      detalle: { origen: 'manual' },
    },
  ];
  mocks.movements.mockResolvedValue(rows);
  mocks.evidence.mockResolvedValue([
    {
      ...rows[0],
      detalle: {
        canal: 'whatsapp',
        para: 'respuesta',
        usage: { input_tokens: 15 },
      },
    },
  ]);
  const response = await GET(
    new Request(
      'https://riverz.co/api/wallet/estado?desde=2026-09-27T05:00:00Z&hasta=2026-09-28T05:00:00Z&concepto=ia_respuesta&canal=whatsapp&workspace_id=attacker'
    )
  );
  const result = await response.json();
  expect(response.status).toBe(200);
  expect(result.resumen.gastadoCentavos).toBe(12);
  expect(result.billedActivity.chargedCentavos).toBe(12);
  expect(result.explanation.chargedCentavos).toBe(12);
  expect(result.resumen.cargadoCentavos).toBe(2500);
  expect(result.ledger.filas.map((r: { id: string }) => r.id)).toEqual([
    'charge',
  ]);
  expect(mocks.movements).toHaveBeenCalledTimes(1);
  expect(mocks.evidence).toHaveBeenCalledWith(
    mocks.db,
    'merchant',
    result.resumen.rango,
    rows
  );
  expect(mocks.service).toHaveBeenCalledWith(
    mocks.db,
    'merchant',
    result.resumen.rango
  );
  expect(mocks.topups).toHaveBeenCalledWith(
    mocks.db,
    'merchant',
    0,
    undefined,
    result.resumen.rango,
    expect.arrayContaining([
      expect.objectContaining({ id: 'credit' }),
      expect.objectContaining({
        id: 'charge',
        detalle: expect.objectContaining({ canal: 'whatsapp' }),
      }),
    ])
  );
  expect(result.workspaceId).toBe('merchant');
  expect(response.headers.get('Cache-Control')).toBe('no-store');
});
it('returns a failure instead of zero spend when evidence cannot be read', async () => {
  mocks.movements.mockResolvedValue([]);
  mocks.evidence.mockRejectedValue(new Error('read failed'));
  const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
  const response = await GET(
    new Request('https://riverz.co/api/wallet/estado')
  );
  expect(response.status).toBe(503);
  expect(await response.json()).not.toHaveProperty('resumen');
  spy.mockRestore();
});
it('rejects unsigned access before reading a merchant ledger', async () => {
  mocks.getUser.mockResolvedValue({ data: { user: null } });
  expect(
    (await GET(new Request('https://riverz.co/api/wallet/estado'))).status
  ).toBe(401);
  expect(mocks.movements).not.toHaveBeenCalled();
});
