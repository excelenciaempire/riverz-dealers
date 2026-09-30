import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
vi.mock('@/lib/attribution/informe', () => ({ leerAtribucion: vi.fn() }));
vi.mock('@/lib/dashboard/cortes', () => ({ leerCortes: vi.fn() }));
vi.mock('@/lib/dashboard/queries', () => ({ loadMetrics: vi.fn() }));
import { METRICS_CAPABILITIES } from './metrics';

describe('attribution operator view', () => {
  it('renders the real handler categories without summing assisted and proven sales', async () => {
    const cap = METRICS_CAPABILITIES.find(c => c.key === 'metricas.atribucion')!;
    const ctx = { db: {} as SupabaseClient, workspaceId: 'w1', actor: { type: 'operator' as const, id: 'u1' }, locale: 'en' as const };
    const result = { periodo: { dias: 7 }, moneda: 'USD', venta_total: 900, pedidos_totales: 9,
      probada: { revenue: 300, orders: 3, currency: 'USD' }, influida: { revenue: 200, orders: 2, currency: 'USD' },
      quien_lo_cerro: { ia: { revenue: 100, orders: 1 }, humano: { revenue: 200, orders: 2 } } };
    const view = await cap.vista!(ctx, {}, result);
    expect(view).toMatchObject({ kind: 'cifras', tiles: expect.arrayContaining([
      expect.objectContaining({ etiqueta: 'Handled by AI', valor: '$100.00' }),
      expect.objectContaining({ etiqueta: 'Handled by a person', valor: '$200.00' }),
      expect.objectContaining({ etiqueta: 'Proven', valor: '$300.00' }),
    ]) });
  });
});
