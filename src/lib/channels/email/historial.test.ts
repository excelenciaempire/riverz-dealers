import { describe, expect, it } from 'vitest';
import {
  DIAS_DE_HISTORIAL,
  desdeSinCursor,
  estadoDeHistorial,
  planDeHistorial,
} from './historial';

/**
 * El historial inicial de un buzón: 90 días, una sola vez, con el tramo
 * congelado para que los cursores de página sigan valiendo entre corridas.
 */

const DIA = 86_400_000;
const AHORA = Date.parse('2026-09-26T12:00:00Z');

describe('planDeHistorial', () => {
  it('un buzón recién conectado importa los 90 días previos', () => {
    const plan = planDeHistorial({}, AHORA);
    expect(plan.pendiente).toBe(true);
    expect(plan.hastaMs).toBe(AHORA);
    expect(plan.desdeMs).toBe(AHORA - DIAS_DE_HISTORIAL * DIA);
    expect(plan.config).toEqual({
      email_backfill_since: new Date(AHORA - 90 * DIA).toISOString(),
      email_backfill_until: new Date(AHORA).toISOString(),
    });
  });

  it('en las corridas siguientes el tramo no se corre', () => {
    const primera = planDeHistorial(null, AHORA);
    const despues = planDeHistorial(primera.config, AHORA + 3 * DIA);
    expect(despues.desdeMs).toBe(primera.desdeMs);
    expect(despues.hastaMs).toBe(primera.hastaMs);
  });

  it('con la marca puesta no hay historial pendiente', () => {
    const plan = planDeHistorial({ email_backfill_done: true }, AHORA);
    expect(plan.pendiente).toBe(false);
    expect(plan.config).toEqual({});
  });

  it('un buzón que ya sincronizaba antes de la marca también importa su historial', () => {
    // Conexiones viejas: tienen cursores pero nunca pasaron los 90 días.
    const plan = planDeHistorial({ last_received_at: '2026-09-25T00:00:00Z' }, AHORA);
    expect(plan.pendiente).toBe(true);
  });

  it('un tramo guardado al revés se rehace desde el corte', () => {
    const plan = planDeHistorial(
      { email_backfill_since: '2026-09-27T00:00:00Z', email_backfill_until: '2026-09-20T00:00:00Z' },
      AHORA,
    );
    expect(plan.hastaMs).toBe(Date.parse('2026-09-20T00:00:00Z'));
    expect(plan.desdeMs).toBe(plan.hastaMs - 90 * DIA);
  });
});

describe('estadoDeHistorial', () => {
  const plan = planDeHistorial({}, AHORA);

  it('mientras falta, guarda el tramo y no pone la marca', () => {
    expect(estadoDeHistorial(plan, false, ['x_next'])).toEqual(plan.config);
  });

  it('al terminar pone la marca y limpia los cursores del proveedor', () => {
    expect(estadoDeHistorial(plan, true, ['x_next', 'x_done'])).toEqual({
      ...plan.config,
      email_backfill_done: true,
      x_next: null,
      x_done: null,
    });
  });

  it('sin historial pendiente no toca nada', () => {
    expect(estadoDeHistorial(planDeHistorial({ email_backfill_done: true }), true, ['x'])).toEqual({});
  });
});

describe('desdeSinCursor', () => {
  it('con historial pendiente, el vivo arranca un día antes del corte', () => {
    const plan = planDeHistorial({}, AHORA);
    expect(desdeSinCursor(plan, AHORA)).toBe(AHORA - DIA);
  });

  it('sin historial pendiente, la semana de siempre', () => {
    const plan = planDeHistorial({ email_backfill_done: true }, AHORA);
    expect(desdeSinCursor(plan, AHORA)).toBe(AHORA - 7 * DIA);
  });
});
