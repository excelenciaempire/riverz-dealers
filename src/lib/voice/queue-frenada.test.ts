/**
 * Cuando una barrera frena la llamada, tiene que quedar rastro.
 *
 * Esta es la regresión que costó meses de sistema de voz sin usar: el freno de
 * emergencia prendido, o un agente sin la voz activada, hacían que la llamada
 * NO existiera en ningún lado. `enqueueCall` devolvía `{ enqueued: false }` a
 * un log que nadie lee, el registro de `/voz` quedaba vacío, y la automatización
 * seguía de largo. Para el comercio: «no pasó nada», sin una sola pista.
 *
 * Se prueba contra un doble de Supabase que anota los INSERT, porque lo que
 * importa no es el valor de retorno —ese ya andaba— sino la FILA que queda para
 * que alguien pueda verla.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

/** Lo que se intentó guardar en `voice_calls` durante la prueba. */
const insertados: Record<string, unknown>[] = [];

/** Las filas que devuelve el doble, por tabla. Cada prueba las acomoda. */
const tablas: Record<string, unknown> = {};

vi.mock('@/lib/channels/admin-client', () => ({
  supabaseAdmin: () => ({
    from: (tabla: string) => {
      const q: Record<string, unknown> = {};
      for (const m of ['select', 'eq', 'gte', 'not', 'is', 'order', 'limit']) {
        q[m] = () => q;
      }
      q.maybeSingle = async () => ({ data: tablas[tabla] ?? null, error: null });
      q.single = async () => ({ data: tablas[tabla] ?? null, error: null });
      q.then = undefined;
      q.insert = (fila: Record<string, unknown>) => {
        if (tabla === 'voice_calls') insertados.push(fila);
        const ins: Record<string, unknown> = {
          select: () => ins,
          single: async () => ({ data: { id: 'llamada-nueva' }, error: null }),
          then: (res: (v: { error: null }) => unknown) => res({ error: null }),
        };
        return ins;
      };
      return q;
    },
  }),
}));

import { enqueueCall } from './queue';

const AGENTE = {
  id: 'agente-1',
  name: 'Asesor',
  workspace_id: 'ws-1',
  voice_enabled: true,
  is_active: true,
  deleted_at: null,
  language: 'es',
  voice_calling_hours: { start: '00:00', end: '23:59', days: [1, 2, 3, 4, 5, 6, 7] },
  voice_max_retries: 0,
};

const CONTACTO = {
  id: 'contacto-1',
  workspace_id: 'ws-1',
  phone: '+573001112233',
  voice_opt_out: false,
};

function montar(config: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  insertados.length = 0;
  tablas.workspaces = { timezone: 'America/Bogota' };
  tablas.channel_connections = { config, status: 'connected' };
  tablas.ai_agents = AGENTE;
  tablas.contacts = CONTACTO;
  tablas.voice_calls = null;
  Object.assign(tablas, extra);
}

const PEDIDO = {
  workspaceId: 'ws-1',
  agentId: 'agente-1',
  contactId: 'contacto-1',
  callType: 'order_confirmation' as const,
};

beforeEach(() => {
  insertados.length = 0;
});

describe('el freno de emergencia', () => {
  it('frena la llamada y deja la fila que lo explica', async () => {
    montar({ phone_number: '+12099793169', kill_switch: true });

    const res = await enqueueCall({ ...PEDIDO, recordSkip: true });

    expect(res).toEqual({ enqueued: false, reason: 'kill_switch' });
    expect(insertados).toHaveLength(1);
    // `canceled` + el motivo es lo que el registro lee como «No se llamó · …».
    expect(insertados[0]).toMatchObject({
      status: 'canceled',
      error: 'kill_switch',
      workspace_id: 'ws-1',
      agent_id: 'agente-1',
      contact_id: 'contacto-1',
    });
    // Con `ended_at` puesto: es una llamada terminada, no uná que quedó colgada
    // esperando a un worker que nunca la va a tomar.
    expect(insertados[0].ended_at).toBeTruthy();
  });

  it('sin pedirlo, sigue sin dejar rastro', async () => {
    // Los reintentos y las campañas frenan de a cientos: una fila por cada uno
    // llenaría el registro de ruido en vez de decir algo.
    montar({ phone_number: '+12099793169', kill_switch: true });

    const res = await enqueueCall(PEDIDO);

    expect(res).toEqual({ enqueued: false, reason: 'kill_switch' });
    expect(insertados).toHaveLength(0);
  });
});

describe('las otras barreras', () => {
  it('un agente sin la voz activada', async () => {
    montar({ phone_number: '+1' }, { ai_agents: { ...AGENTE, voice_enabled: false } });

    const res = await enqueueCall({ ...PEDIDO, recordSkip: true });

    expect(res).toEqual({ enqueued: false, reason: 'voice_disabled' });
    expect(insertados[0]).toMatchObject({ error: 'voice_disabled' });
  });

  it('un contacto que pidió no recibir llamadas', async () => {
    montar({ phone_number: '+1' }, { contacts: { ...CONTACTO, voice_opt_out: true } });

    const res = await enqueueCall({ ...PEDIDO, recordSkip: true });

    expect(res).toEqual({ enqueued: false, reason: 'opt_out' });
    expect(insertados[0]).toMatchObject({ error: 'opt_out' });
  });

  it('un teléfono ilegible guarda el valor crudo, que es lo que hay que mirar', async () => {
    montar({ phone_number: '+1' }, { contacts: { ...CONTACTO, phone: 'llamar al local' } });

    const res = await enqueueCall({ ...PEDIDO, recordSkip: true });

    expect(res).toEqual({ enqueued: false, reason: 'invalid_phone' });
    expect(insertados[0]).toMatchObject({
      error: 'invalid_phone',
      phone: 'llamar al local',
    });
  });

  it('sin agente no hay dónde anotar, y no se inventa una fila', async () => {
    // `voice_calls.agent_id` es NOT NULL: si el bloqueo es justamente que el
    // agente no existe, la fila no se puede escribir. Antes esto reventaba el
    // INSERT en vez de devolver el motivo.
    montar({ phone_number: '+1' }, { ai_agents: null });

    const res = await enqueueCall({ ...PEDIDO, recordSkip: true });

    expect(res).toEqual({ enqueued: false, reason: 'agent_not_found' });
    expect(insertados).toHaveLength(0);
  });
});

describe('cuando no hay barrera', () => {
  it('la llamada se encola de verdad', async () => {
    montar({ phone_number: '+12099793169' });

    const res = await enqueueCall({ ...PEDIDO, recordSkip: true });

    expect(res).toMatchObject({ enqueued: true, callId: 'llamada-nueva' });
    expect(insertados).toHaveLength(1);
    expect(insertados[0]).toMatchObject({ status: 'queued', phone: '+573001112233' });
    expect(insertados[0].error).toBeUndefined();
  });
});
