import { describe, it, expect } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import {
  FEATURES,
  OPT_IN_FEATURES,
  canUsePath,
  featureForPath,
  getFeatureFlags,
  isFeatureEnabled,
  isOptInEnabled,
  isRiverz2,
  isOperatorFleet,
  type FeatureFlags,
} from './feature-flags';

/**
 * El gate de funcionalidades no tenía una sola prueba, y decide si un comercio
 * ve media aplicación. Las dos cosas que hay que fijar son la regla de ausencia
 * (sin fila = habilitada, para que sumar el sistema no apague nada) y la
 * precedencia entre el valor global y la excepción del comercio.
 */

/** Cliente falso: devuelve filas fijas por tabla. */
function fakeDb(
  global: Array<{ key: string; enabled: boolean }>,
  porComercio: Array<{ key: string; enabled: boolean }> = [],
): SupabaseClient {
  return {
    from(table: string) {
      const rows = table === 'feature_flags' ? global : porComercio;
      const res = { data: rows };
      return {
        select: () => ({
          ...res,
          eq: () => res,
          then: undefined,
        }),
      };
    },
  } as unknown as SupabaseClient;
}

describe('isFeatureEnabled', () => {
  it('sin fila, la funcionalidad está habilitada', () => {
    // Es la regla que permite sumar una feature nueva al catálogo sin apagarla
    // para todo el mundo por accidente.
    expect(isFeatureEnabled({}, 'flows')).toBe(true);
  });

  it('sólo el false explícito apaga', () => {
    expect(isFeatureEnabled({ flows: false }, 'flows')).toBe(false);
    expect(isFeatureEnabled({ flows: true }, 'flows')).toBe(true);
  });
});

describe('experiencias opt-in', () => {
  // La regla es la inversa de la de arriba, y confundirlas mandaría a toda la
  // base a la experiencia nueva de golpe. Por eso se fija acá.
  it('sin fila, la experiencia está APAGADA', () => {
    expect(isOptInEnabled({}, 'riverz_2')).toBe(false);
    expect(isOptInEnabled({}, 'future_pilot')).toBe(false);
  });

  it('sólo el true explícito la prende', () => {
    expect(isRiverz2({ riverz_2: false })).toBe(false);
    expect(isRiverz2({ riverz_2: true })).toBe(true);
  });

  it('no viven en el catálogo que gatea rutas', () => {
    // Si `riverz_2` estuviera en FEATURES, `isFeatureEnabled` lo leería con la
    // regla contraria y quedaría prendido para todos.
    for (const f of OPT_IN_FEATURES) {
      expect(FEATURES.some((x) => x.key === f.key)).toBe(false);
      expect(f.sections).toEqual([]);
    }
  });

  it('no gatean ninguna URL', () => {
    // Su gate es server-side (`isRiverz2`), no el mapa de rutas.
    expect(featureForPath('/operacion')).toBeNull();
  });
});

describe('Operador disponible para todas las generaciones de cuentas', () => {
  it.each<FeatureFlags>([{}, { riverz_2: true, operator_flota: true }])('funciona sin configuración de piloto: %j', (flags) => {
    expect(isRiverz2(flags)).toBe(true);
    expect(isOperatorFleet(flags)).toBe(true);
  });

  it('usa el mismo valor predeterminado en el panel y el servidor', () => {
    for (const key of ['riverz_2', 'operator_flota']) {
      expect(FEATURES.some(f => f.key === key)).toBe(true);
      expect(OPT_IN_FEATURES.some(f => f.key === key)).toBe(false);
      expect(isFeatureEnabled({}, key)).toBe(true);
    }
  });

  it('conserva el apagado explícito de emergencia', () => {
    expect(isRiverz2({ riverz_2: false })).toBe(false);
    expect(isOperatorFleet({ operator_flota: false })).toBe(false);
  });
});

describe('featureForPath', () => {
  it('reconoce la sección y sus sub-rutas', () => {
    expect(featureForPath('/menus')).toBe('flows');
    expect(featureForPath('/menus/abc/usos')).toBe('flows');
  });

  it('no confunde una ruta que empieza igual', () => {
    // `/menuscopia` no es una sub-ruta de `/menus`.
    expect(featureForPath('/menuscopia')).toBeNull();
  });

  it('las secciones núcleo no están gateadas', () => {
    for (const p of ['/panel', '/bandeja', '/contactos', '/ajustes']) {
      expect(featureForPath(p)).toBeNull();
    }
  });
});

describe('canUsePath', () => {
  it('el equipo de plataforma entra aunque esté apagada', () => {
    // Para poder probar una funcionalidad con el interruptor en off.
    expect(canUsePath('/menus', { flows: false }, true)).toBe(true);
  });

  it('el comercio no entra si está apagada', () => {
    expect(canUsePath('/menus', { flows: false }, false)).toBe(false);
  });

  it('una ruta sin feature siempre se puede usar', () => {
    expect(canUsePath('/bandeja', { flows: false }, false)).toBe(true);
  });
});

describe('getFeatureFlags', () => {
  it('strict refresh rejects either failed layer instead of enabling features by default', async () => {
    for (const failed of ['feature_flags', 'workspace_feature_flags']) {
      const db = {
        from(table: string) {
          const response = { data: null, error: table === failed ? { message: 'timeout' } : null };
          return { select: () => ({ ...response, eq: () => response }) };
        },
      } as unknown as SupabaseClient;
      await expect(getFeatureFlags(db, 'ws-1', { strict: true })).rejects.toThrow('feature_flags_unavailable');
    }
  });

  it('sin workspace devuelve sólo los globales', async () => {
    const flags = await getFeatureFlags(fakeDb([{ key: 'flows', enabled: false }]));
    expect(flags).toEqual({ flows: false });
  });

  it('la excepción del comercio le gana al global', async () => {
    const flags = await getFeatureFlags(
      fakeDb([{ key: 'flows', enabled: false }], [{ key: 'flows', enabled: true }]),
      'ws-1',
    );
    expect(flags.flows).toBe(true);
  });

  it('la excepción también puede apagar algo que está prendido para todos', async () => {
    const flags = await getFeatureFlags(
      fakeDb([{ key: 'voice', enabled: true }], [{ key: 'voice', enabled: false }]),
      'ws-1',
    );
    expect(flags.voice).toBe(false);
  });

  it('lo que no tiene excepción conserva el global', async () => {
    const flags = await getFeatureFlags(
      fakeDb(
        [
          { key: 'flows', enabled: false },
          { key: 'voice', enabled: false },
        ],
        [{ key: 'flows', enabled: true }],
      ),
      'ws-1',
    );
    expect(flags).toEqual({ flows: true, voice: false });
  });

  it('ante un error de lectura no apaga nada', async () => {
    const roto = {
      from() {
        throw new Error('sin conexión');
      },
    } as unknown as SupabaseClient;
    const flags = await getFeatureFlags(roto, 'ws-1');
    expect(flags).toEqual({});
    // Y con el mapa vacío, todo el catálogo sigue habilitado.
    for (const f of FEATURES) expect(isFeatureEnabled(flags, f.key)).toBe(true);
  });
});
