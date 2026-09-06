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

const wallet = vi.hoisted(() => ({
  puede: true,
  motivo: null as string | null,
}));
const platform = vi.hoisted(() => ({
  livekit: true,
  workerDown: false,
  providerDown: false,
}));
vi.mock('@/lib/wallet/puerta', () => ({
  puertaDeIa: async () => ({
    puede: wallet.puede,
    motivo: wallet.motivo,
    saldoCentavos: wallet.puede ? 1000 : 0,
  }),
}));
vi.mock('./livekit', () => ({ isLiveKitConfigured: () => platform.livekit }));
vi.mock('./readiness', () => ({
  voiceWorkerDown: async () => platform.workerDown,
}));
vi.mock('./provider-health', () => ({
  voiceProviderHealth: async () => ({ blocking: platform.providerDown }),
}));

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
      q.maybeSingle = async () => ({
        data: tablas[tabla] ?? null,
        error: null,
      });
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

import { enqueueCall, voiceBalanceHoldExpiry, voiceHoldExpired } from './queue';

const AGENTE = {
  id: 'agente-1',
  name: 'Asesor',
  workspace_id: 'ws-1',
  voice_enabled: true,
  is_active: true,
  deleted_at: null,
  language: 'es',
  voice_calling_hours: {
    start: '00:00',
    end: '23:59',
    days: [1, 2, 3, 4, 5, 6, 7],
  },
  voice_max_retries: 0,
};

const CONTACTO = {
  id: 'contacto-1',
  workspace_id: 'ws-1',
  phone: '+573001112233',
  voice_opt_out: false,
};

function montar(
  config: Record<string, unknown>,
  extra: Record<string, unknown> = {}
) {
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
  wallet.puede = true;
  wallet.motivo = null;
  platform.livekit = true;
  platform.workerDown = false;
  platform.providerDown = false;
});

describe('saldo por origen', () => {
  it.each(['manual', 'test', 'operator', 'assistant'] as const)(
    '%s falla inmediatamente y deja un motivo visible',
    async (origin) => {
      montar({ phone_number: '+12099793169' });
      wallet.puede = false;
      wallet.motivo = 'sin_saldo';

      const res = await enqueueCall({ ...PEDIDO, origin, recordSkip: true });

      expect(res).toEqual({ enqueued: false, reason: 'sin_saldo' });
      expect(insertados[0]).toMatchObject({
        status: 'canceled',
        error: 'sin_saldo',
      });
    }
  );

  it.each(['automation', 'campaign'] as const)(
    '%s queda visible en espera durante 24 horas',
    async (origin) => {
      montar({ phone_number: '+12099793169' });
      wallet.puede = false;
      wallet.motivo = 'sin_saldo';

      const res = await enqueueCall({ ...PEDIDO, origin });

      expect(res).toMatchObject({ enqueued: true, held: true });
      expect(insertados[0]).toMatchObject({
        status: 'queued',
        hold_reason: 'sin_saldo',
      });
      const expiry = String(insertados[0].hold_expires_at);
      expect(new Date(expiry).getTime() - Date.now()).toBeGreaterThanOrEqual(
        24 * 60 * 60 * 1000 - 100
      );
    }
  );

  it('un reintento también queda en espera', async () => {
    montar({ phone_number: '+12099793169' });
    wallet.puede = false;
    wallet.motivo = 'sin_saldo';
    const res = await enqueueCall({ ...PEDIDO, parentCallId: 'anterior' });
    expect(res).toMatchObject({ enqueued: true, held: true });
  });

  it('vence exactamente a las 24 horas', () => {
    const now = new Date('2026-09-06T12:00:00.000Z');
    const expiry = voiceBalanceHoldExpiry(now);
    expect(
      voiceHoldExpired(
        expiry,
        new Date(now.getTime() + 24 * 60 * 60 * 1000 - 1)
      )
    ).toBe(false);
    expect(
      voiceHoldExpired(expiry, new Date(now.getTime() + 24 * 60 * 60 * 1000))
    ).toBe(true);
  });
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

describe('infraestructura compartida', () => {
  it.each([
    [
      'platform_unavailable',
      () => {
        platform.livekit = false;
      },
    ],
    [
      'worker_down',
      () => {
        platform.workerDown = true;
      },
    ],
    [
      'provider_unavailable',
      () => {
        platform.providerDown = true;
      },
    ],
  ] as const)('frena con %s antes de encolar', async (reason, arrange) => {
    montar({ phone_number: '+12099793169' });
    arrange();
    const res = await enqueueCall({ ...PEDIDO, recordSkip: true });
    expect(res).toEqual({ enqueued: false, reason });
    expect(insertados[0]).toMatchObject({ status: 'canceled', error: reason });
  });
});

describe('las otras barreras', () => {
  it('sin número de salida no promete que la prueba se encoló', async () => {
    montar({});

    const res = await enqueueCall({ ...PEDIDO, recordSkip: true });

    expect(res).toEqual({ enqueued: false, reason: 'no_number' });
    expect(insertados[0]).toMatchObject({ error: 'no_number' });
  });

  it('un agente sin la voz activada', async () => {
    montar(
      { phone_number: '+1' },
      { ai_agents: { ...AGENTE, voice_enabled: false } }
    );

    const res = await enqueueCall({ ...PEDIDO, recordSkip: true });

    expect(res).toEqual({ enqueued: false, reason: 'voice_disabled' });
    expect(insertados[0]).toMatchObject({ error: 'voice_disabled' });
  });

  it('un contacto que pidió no recibir llamadas', async () => {
    montar(
      { phone_number: '+1' },
      { contacts: { ...CONTACTO, voice_opt_out: true } }
    );

    const res = await enqueueCall({ ...PEDIDO, recordSkip: true });

    expect(res).toEqual({ enqueued: false, reason: 'opt_out' });
    expect(insertados[0]).toMatchObject({ error: 'opt_out' });
  });

  it('un teléfono ilegible guarda el valor crudo, que es lo que hay que mirar', async () => {
    montar(
      { phone_number: '+1' },
      { contacts: { ...CONTACTO, phone: 'llamar al local' } }
    );

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
    expect(insertados[0]).toMatchObject({
      status: 'queued',
      phone: '+573001112233',
    });
    expect(insertados[0].error).toBeUndefined();
  });

  it('guarda el asistente y la conversación que originaron la llamada', async () => {
    montar({ phone_number: '+12099793169' });

    await enqueueCall({
      ...PEDIDO,
      origin: 'assistant',
      sourceAssistantId: 'asistente-1',
      sourceConversationId: 'conversacion-1',
      context: { reason: 'El cliente pidió hablar' },
    });

    expect(insertados[0].context).toEqual({
      reason: 'El cliente pidió hablar',
      __riverz: {
        origin: 'assistant',
        assistant_id: 'asistente-1',
        conversation_id: 'conversacion-1',
      },
    });
  });
});
