import { expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: { id: 'owner' } } }),
    },
  }),
}));
vi.mock('@/lib/automations/admin-client', () => ({
  supabaseAdmin: () => ({
    from: () => {
      const q = {
        select: () => q,
        eq: () => q,
        single: async () => ({ data: { timezone: 'UTC' } }),
      };
      return q;
    },
  }),
}));
vi.mock('@/lib/workspaces/resolve', () => ({
  resolveWorkspaceIdForUser: async () => 'ws',
}));
vi.mock('@/lib/billing/plan', () => ({
  leerSuscripcion: async () => ({ estado: 'activa' }),
  usaSaldo: () => true,
}));
vi.mock('@/lib/billing/stripe', () => ({ stripeDisponible: () => true }));
vi.mock('@/lib/wallet/recarga', () => ({ SUGERIDOS_CENTAVOS: [1000] }));
vi.mock('@/lib/wallet/saldo', () => ({
  leerBilletera: async () => ({
    saldoCentavos: 2531,
    moneda: 'usd',
    cobrarACosto: true,
  }),
}));
vi.mock('@/lib/wallet/movimientos', () => ({
  rangoDe: () => ({}),
  movimientosDelPeriodo: async () => [],
  summarizeMovements: () => ({ gastadoCentavos: 31 }),
}));
vi.mock('@/lib/wallet/activity', () => ({ walletActivity: async () => ({}) }));
vi.mock('@/lib/wallet/service-activity', () => ({
  serviceActivity: async () => ({}),
}));
vi.mock('@/lib/wallet/tarifas', () => ({ listarTarifas: async () => [] }));
vi.mock('@/lib/wallet/costos', () => ({
  costosReales: async () => [
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
  ],
}));
import { GET } from './route';

it('exposes service prices and inclusion without revealing internal software providers', async () => {
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
