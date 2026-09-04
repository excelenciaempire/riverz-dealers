import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchMetaGraph, isRetryableMetaStatus } from './meta-fetch';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('fetchMetaGraph', () => {
  it('recovers an ephemeral Graph 500 in the same operation', async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce(new Response('temporary', { status: 500 }))
      .mockResolvedValueOnce(Response.json({ data: [] }));
    vi.stubGlobal('fetch', request);

    const response = await fetchMetaGraph(
      'https://graph.test/conversations',
      {},
      {
        retryDelaysMs: [0],
      }
    );

    expect(response.status).toBe(200);
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('retries a network failure without hiding a final failure', async () => {
    const request = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('socket closed'))
      .mockRejectedValueOnce(new TypeError('still down'));
    vi.stubGlobal('fetch', request);

    await expect(
      fetchMetaGraph('https://graph.test/messages', {}, { retryDelaysMs: [0] })
    ).rejects.toThrow('still down');
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('does not retry authorization or functional 4xx responses', async () => {
    const request = vi
      .fn()
      .mockResolvedValue(new Response('bad token', { status: 400 }));
    vi.stubGlobal('fetch', request);

    const response = await fetchMetaGraph(
      'https://graph.test/me',
      {},
      {
        retryDelaysMs: [0, 0],
      }
    );

    expect(response.status).toBe(400);
    expect(request).toHaveBeenCalledTimes(1);
  });
});

describe('isRetryableMetaStatus', () => {
  it('only classifies rate limits and server failures as transient', () => {
    expect(isRetryableMetaStatus(429)).toBe(true);
    expect(isRetryableMetaStatus(500)).toBe(true);
    expect(isRetryableMetaStatus(503)).toBe(true);
    expect(isRetryableMetaStatus(400)).toBe(false);
    expect(isRetryableMetaStatus(401)).toBe(false);
  });
});
