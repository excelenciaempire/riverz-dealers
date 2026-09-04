import { describe, expect, it } from 'vitest';
import { listInboundVoiceAgents, listVoiceAgents } from './agents';

/**
 * El bug que motiva estas pruebas: `listVoiceAgents` filtra por `scope` y
 * ordena por `priority`, pero el llamador podía pedir sólo `id, name`. Las dos
 * columnas llegaban `undefined`, ningún agente pasaba el filtro, y
 * `voiceReadiness` informaba «ningún agente tiene la voz activada» con el
 * agente vivo y bien configurado. Un filtro sobre una columna que no se trajo
 * no explota: descarta todo en silencio.
 */

type Fila = Record<string, unknown>;

/** Supabase de mentira: guarda el `select` pedido y devuelve sólo esas columnas. */
function fakeDb(filas: Fila[]) {
  const visto = { select: '' };
  const db = {
    from(table: string) {
      return {
        select(cols: string) {
          visto.select = cols;
          const source = table === 'voice_calls' ? [] : filas;
          const pedidas = cols
            .replace(/ai_agent_channels\(channel\)/, '')
            .split(',')
            .map((c) => c.trim())
            .filter(Boolean);
          const proyectar = (f: Fila) => {
            if (pedidas.includes('*')) return { ...f };
            const out: Fila = {};
            for (const c of pedidas) if (c in f) out[c] = f[c];
            // El embed viaja siempre.
            out.ai_agent_channels = f.ai_agent_channels ?? [];
            return out;
          };
          const q: Record<string, unknown> = {
            eq: () => q,
            in: () => q,
            is: () => q,
            then: (r: (v: { data: Fila[] }) => unknown) =>
              r({ data: source.map(proyectar) }),
          };
          return q;
        },
      };
    },
  };
  return { db: db as never, visto };
}

const BASE: Fila = {
  id: 'a1',
  name: 'Asesor',
  scope: 'workspace',
  priority: 0,
  ai_agent_channels: [],
};

describe('listVoiceAgents', () => {
  it('encuentra al agente aunque el llamador pida sólo id y name', async () => {
    const { db } = fakeDb([BASE]);
    const r = await listVoiceAgents(db, 'ws1', 'id, name');
    expect(r.map((a) => a.id)).toEqual(['a1']);
  });

  it('pide scope y priority aunque no se las hayan pedido', async () => {
    const { db, visto } = fakeDb([BASE]);
    await listVoiceAgents(db, 'ws1', 'id, name');
    expect(visto.select).toContain('scope');
    expect(visto.select).toContain('priority');
  });

  it('deja pasar al de alcance por canales sólo si tiene el canal de voz', async () => {
    const conVoz = { ...BASE, id: 'con', scope: 'channels', ai_agent_channels: [{ channel: 'voice' }] };
    const sinVoz = { ...BASE, id: 'sin', scope: 'channels', ai_agent_channels: [{ channel: 'whatsapp' }] };
    const { db } = fakeDb([conVoz, sinVoz]);
    const r = await listVoiceAgents(db, 'ws1', 'id, name');
    expect(r.map((a) => a.id)).toEqual(['con']);
  });

  it('ordena por prioridad: el primero es el que atiende', async () => {
    const bajo = { ...BASE, id: 'bajo', priority: 1 };
    const alto = { ...BASE, id: 'alto', priority: 9 };
    const { db } = fakeDb([bajo, alto]);
    const r = await listVoiceAgents(db, 'ws1', 'id, name');
    expect(r.map((a) => a.id)).toEqual(['alto', 'bajo']);
  });
});

describe('listInboundVoiceAgents', () => {
  it('sólo devuelve agentes habilitados para llamadas entrantes', async () => {
    const habilitado = {
      ...BASE,
      id: 'inbound',
      voice_accepts_inbound: true,
    };
    const saliente = {
      ...BASE,
      id: 'outbound',
      voice_accepts_inbound: false,
    };
    const { db } = fakeDb([habilitado, saliente]);

    const r = await listInboundVoiceAgents(db, 'ws1');

    expect(r.map((a) => a.id)).toEqual(['inbound']);
  });

  it('conserva el ruteo anterior mientras la columna aún no existe', async () => {
    const { db } = fakeDb([BASE]);

    const r = await listInboundVoiceAgents(db, 'ws1');

    expect(r.map((a) => a.id)).toEqual(['a1']);
  });
});
