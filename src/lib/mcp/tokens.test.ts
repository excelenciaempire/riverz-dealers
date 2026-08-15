import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import {
  generateToken,
  hashToken,
  tokenPrefix,
  sameSecret,
  rateKey,
  resolveActor,
  type McpActor,
} from './tokens';

/**
 * Lo que estas pruebas protegen: que repartir una llave de MCP no sea repartir
 * la plataforma. La llave dice el alcance, y si eso se rompe, un comercio lee
 * la cuenta de otro.
 */

const WS = '11111111-1111-1111-1111-111111111111';

/** Cliente falso con una sola llave viva en la tabla. */
function fakeDb(row: { id: string; workspace_id: string; name: string } | null): SupabaseClient {
  return {
    from() {
      const chain: Record<string, unknown> = {};
      const self = () => chain;
      Object.assign(chain, {
        select: self,
        eq: self,
        is: self,
        update: self,
        maybeSingle: async () => ({ data: row }),
        then: (fn: (v: unknown) => unknown) => Promise.resolve(fn({ data: row })),
      });
      return chain;
    },
  } as unknown as SupabaseClient;
}

describe('generateToken', () => {
  it('no repite y lleva prefijo reconocible', () => {
    const a = generateToken();
    const b = generateToken();
    expect(a).not.toBe(b);
    expect(a.startsWith('rvz_')).toBe(true);
    // Suficiente entropía como para que no se adivine.
    expect(a.length).toBeGreaterThan(30);
  });

  it('el prefijo que se guarda no alcanza para reconstruir la llave', () => {
    const t = generateToken();
    const p = tokenPrefix(t);
    expect(t.startsWith(p)).toBe(true);
    expect(p.length).toBeLessThan(t.length / 2);
  });
});

describe('hashToken', () => {
  it('es estable y distinto por token', () => {
    const a = generateToken();
    expect(hashToken(a)).toBe(hashToken(a));
    expect(hashToken(a)).not.toBe(hashToken(generateToken()));
  });

  it('el hash no contiene el token', () => {
    const a = generateToken();
    expect(hashToken(a)).not.toContain(a.slice(4));
  });
});

describe('sameSecret', () => {
  it('compara por valor y rechaza largos distintos', () => {
    expect(sameSecret('abc', 'abc')).toBe(true);
    expect(sameSecret('abc', 'abd')).toBe(false);
    expect(sameSecret('abc', 'abcd')).toBe(false);
    expect(sameSecret('', '')).toBe(true);
  });
});

describe('resolveActor', () => {
  const previo = process.env.MCP_ADMIN_TOKEN;
  beforeEach(() => {
    process.env.MCP_ADMIN_TOKEN = 'clave-de-plataforma';
  });
  afterEach(() => {
    if (previo === undefined) delete process.env.MCP_ADMIN_TOKEN;
    else process.env.MCP_ADMIN_TOKEN = previo;
  });

  it('la clave del equipo da alcance de plataforma', async () => {
    const actor = await resolveActor(fakeDb(null), 'clave-de-plataforma');
    expect(actor?.kind).toBe('platform');
  });

  it('una llave de comercio queda atada a su cuenta', async () => {
    const actor = await resolveActor(
      fakeDb({ id: 'tok-1', workspace_id: WS, name: 'n8n' }),
      'rvz_loquesea',
    );
    expect(actor).toEqual({
      kind: 'workspace',
      workspaceId: WS,
      tokenId: 'tok-1',
      label: 'n8n',
    });
  });

  it('una llave que no existe no es nadie', async () => {
    expect(await resolveActor(fakeDb(null), 'rvz_inventada')).toBeNull();
  });

  it('sin token no es nadie', async () => {
    expect(await resolveActor(fakeDb(null), '')).toBeNull();
  });

  it('sin clave de plataforma configurada, esa puerta no se abre sola', async () => {
    delete process.env.MCP_ADMIN_TOKEN;
    expect(await resolveActor(fakeDb(null), 'clave-de-plataforma')).toBeNull();
  });
});

describe('rateKey', () => {
  it('el techo va por llave y no por lo que diga quien llama', () => {
    // La regresión que esto fija: la clave del limitador salía de la cabecera
    // `x-mcp-actor`, que la elige el que llama — bastaba variarla para que el
    // techo no existiera.
    const a: McpActor = { kind: 'workspace', workspaceId: WS, tokenId: 'tok-1', label: 'a' };
    const b: McpActor = { kind: 'workspace', workspaceId: WS, tokenId: 'tok-2', label: 'a' };
    expect(rateKey(a)).not.toBe(rateKey(b));
    expect(rateKey(a)).toContain('tok-1');
    expect(rateKey({ kind: 'platform', label: 'plataforma' })).toBe('mcp:platform');
  });
});
