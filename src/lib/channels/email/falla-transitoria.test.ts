import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  esEstadoTransitorio,
  FallaTransitoria,
  pedirAlProveedor,
} from './falla-transitoria';

describe('esEstadoTransitorio', () => {
  it('429 y 5xx se reintentan; el resto no', () => {
    expect(esEstadoTransitorio(429)).toBe(true);
    expect(esEstadoTransitorio(500)).toBe(true);
    expect(esEstadoTransitorio(503)).toBe(true);
    expect(esEstadoTransitorio(404)).toBe(false);
    expect(esEstadoTransitorio(401)).toBe(false);
    expect(esEstadoTransitorio(200)).toBe(false);
  });
});

describe('pedirAlProveedor', () => {
  afterEach(() => vi.restoreAllMocks());

  it('un límite de tasa corta la corrida en vez de parecer un correo inexistente', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('slow down', { status: 429 }),
    );
    await expect(pedirAlProveedor('https://x.test', {}, 'get')).rejects.toBeInstanceOf(
      FallaTransitoria,
    );
  });

  it('una caída de red también', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new TypeError('fetch failed'));
    await expect(pedirAlProveedor('https://x.test', {}, 'get')).rejects.toBeInstanceOf(
      FallaTransitoria,
    );
  });

  it('un 404 vuelve tal cual: lo decide quien llama', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response('', { status: 404 }));
    const res = await pedirAlProveedor('https://x.test', {}, 'get');
    expect(res.status).toBe(404);
  });
});
