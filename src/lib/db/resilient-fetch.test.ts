import { afterEach, describe, expect, it, vi } from 'vitest';
import { resilientDatabaseFetch } from './resilient-fetch';

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
const url = 'https://example.supabase.co/rest/v1/channel_connections';

describe('database read recovery', () => {
  it.each([502, 503, 504])('recovers an upstream %s without losing query or headers', async status => {
    vi.useFakeTimers();
    const fetcher = vi.fn().mockResolvedValueOnce(new Response('timeout', { status }))
      .mockResolvedValueOnce(new Response('[]'));
    vi.stubGlobal('fetch', fetcher);
    const init = { headers: { apikey: 'test' } };
    const result = resilientDatabaseFetch(url, init);
    await vi.runAllTimersAsync();
    expect((await result).status).toBe(200);
    expect(fetcher).toHaveBeenNthCalledWith(2, url, init);
  });

  it('retries known read-only health RPCs and preserves their body', async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn().mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce(new Response('[]'));
    vi.stubGlobal('fetch', fetcher);
    const rpc = 'https://example.supabase.co/rest/v1/rpc/admin_workspace_issues';
    const init = { method: 'POST', body: '{"p_workspace_id":null}' };
    const result = resilientDatabaseFetch(rpc, init);
    await vi.runAllTimersAsync();
    expect((await result).ok).toBe(true);
    expect(fetcher).toHaveBeenNthCalledWith(2, rpc, init);
  });

  it.each(['POST', 'PATCH', 'DELETE'])('never replays a %s write', async method => {
    const fetcher = vi.fn().mockResolvedValue(new Response('', { status: 504 }));
    vi.stubGlobal('fetch', fetcher);
    expect((await resilientDatabaseFetch(url, { method })).status).toBe(504);
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it.each(['POST', 'GET'])('never replays an unknown RPC using %s', async method => {
    const fetcher = vi.fn().mockRejectedValue(new TypeError('fetch failed'));
    vi.stubGlobal('fetch', fetcher);
    await expect(resilientDatabaseFetch(url.replace('channel_connections', 'rpc/claim_scheduler_tick'), { method }))
      .rejects.toThrow('fetch failed');
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it('stops after one retry and returns the actual failure', async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn().mockImplementation(async () => new Response('timeout', { status: 504 }));
    vi.stubGlobal('fetch', fetcher);
    const result = resilientDatabaseFetch(url);
    await vi.runAllTimersAsync();
    expect((await result).status).toBe(504);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('honors cancellation during recovery', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const fetcher = vi.fn().mockImplementation(async () => {
      controller.abort();
      return new Response('', { status: 504 });
    });
    vi.stubGlobal('fetch', fetcher);
    const result = resilientDatabaseFetch(url, { signal: controller.signal });
    const check = expect(result).rejects.toThrow();
    await vi.runAllTimersAsync();
    await check;
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it.each([400, 401, 403, 429, 500])('does not hide a non-transient %s', async status => {
    const fetcher = vi.fn().mockResolvedValue(new Response('', { status }));
    vi.stubGlobal('fetch', fetcher);
    expect((await resilientDatabaseFetch(url)).status).toBe(status);
    expect(fetcher).toHaveBeenCalledOnce();
  });
});
