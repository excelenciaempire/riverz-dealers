import { describe, expect, it } from 'vitest';
import {
  isMetaRateLimited,
  isMetaRateLimitedResponse,
  isMetaRateLimitError,
  MetaRateLimitError,
} from './meta-rate-limit';

describe('isMetaRateLimited', () => {
  it('reconoce el 429 aunque el cuerpo no se pueda leer', () => {
    expect(isMetaRateLimited(429, '')).toBe(true);
    expect(isMetaRateLimited(429, '<html>')).toBe(true);
  });

  it('reconoce los límites de app, usuario y página que Meta manda como 400/403', () => {
    for (const code of [4, 17, 32, 613]) {
      expect(isMetaRateLimited(400, JSON.stringify({ error: { code } }))).toBe(true);
    }
    expect(isMetaRateLimited(403, { error: { code: 80002 } })).toBe(true);
    expect(
      isMetaRateLimited(400, { error: { message: '(#17) User request limit reached' } })
    ).toBe(true);
  });

  it('no confunde un permiso, un token vencido o un objeto borrado con un límite', () => {
    expect(isMetaRateLimited(400, { error: { code: 100, error_subcode: 33 } })).toBe(false);
    expect(isMetaRateLimited(401, { error: { code: 190 } })).toBe(false);
    expect(isMetaRateLimited(400, { error: { code: 10, message: '(#10) Permission' } })).toBe(false);
    expect(isMetaRateLimited(400, 'bad rich fields')).toBe(false);
    expect(isMetaRateLimited(500, '')).toBe(false);
  });
});

describe('isMetaRateLimitedResponse', () => {
  it('lee el cuerpo sin consumir la respuesta', async () => {
    const res = new Response(JSON.stringify({ error: { code: 4 } }), { status: 400 });
    expect(await isMetaRateLimitedResponse(res)).toBe(true);
    expect(await res.json()).toEqual({ error: { code: 4 } });
  });

  it('una respuesta sana nunca es un límite', async () => {
    expect(await isMetaRateLimitedResponse(new Response('{}'))).toBe(false);
  });
});

describe('MetaRateLimitError', () => {
  it('se distingue de cualquier otro error', () => {
    expect(isMetaRateLimitError(new MetaRateLimitError())).toBe(true);
    expect(isMetaRateLimitError(new Error('meta_rate_limited'))).toBe(false);
  });
});
