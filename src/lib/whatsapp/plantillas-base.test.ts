import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

const creadas = vi.hoisted(() => [] as Array<Record<string, unknown>>);

vi.mock('@/lib/templates/create', () => ({
  crearPlantilla: vi.fn(async (_db: unknown, args: Record<string, unknown>) => {
    creadas.push(args);
    return { ok: true, name: String(args.nombre), estadoMeta: 'PENDING' };
  }),
}));

import { asegurarPlantillasBase, PLANTILLAS_BASE } from './plantillas-base';

beforeEach(() => {
  creadas.length = 0;
});

function dbSinPlantillas(): SupabaseClient {
  const chain: Record<string, unknown> = {};
  Object.assign(chain, {
    select: () => chain,
    eq: () => chain,
    then: (ok: (value: unknown) => unknown) =>
      Promise.resolve({ data: [], error: null }).then(ok),
  });
  return { from: () => chain } as unknown as SupabaseClient;
}

describe('plantilla base de carrito abandonado', () => {
  const plantilla = PLANTILLAS_BASE.find(
    (p) => p.nombre === 'riverz_carrito_abandonado'
  );

  it('declara el propósito comercial como Marketing', () => {
    expect(plantilla?.categoria).toBe('MARKETING');
  });

  it('deja el enlace fuera del cuerpo y ofrece una acción directa', () => {
    expect(plantilla?.bodyText).not.toMatch(/https?:\/\/|www\./i);
    expect(plantilla?.footerText).toBe(
      'Responde BAJA para no recibir más mensajes.'
    );
    expect(plantilla?.buttons).toEqual([
      {
        type: 'URL',
        text: 'Finalizar compra',
        url_variable: 'abandoned_checkout',
      },
      { type: 'QUICK_REPLY', text: 'Necesito ayuda' },
    ]);
  });

  it('pre-mapea el nombre y conserva el cuerpo legible por bloques', () => {
    expect(plantilla?.variableFields).toEqual({ '1': 'customer_name' });
    expect(plantilla?.bodyText.split('\n\n')).toHaveLength(3);
  });

  it('manda a Meta la categoría, los botones y el pre-mapeo definidos', async () => {
    await asegurarPlantillasBase(dbSinPlantillas(), {
      workspaceId: 'workspace-1',
      userId: 'user-1',
    });

    expect(creadas[0]).toMatchObject({
      nombre: 'riverz_carrito_abandonado',
      categoria: 'MARKETING',
      footerText: 'Responde BAJA para no recibir más mensajes.',
      buttons: plantilla?.buttons,
      variableFields: { '1': 'customer_name' },
    });
  });
});
