import { EventEmitter } from 'node:events';
import type { RequestOptions } from 'node:https';
import type { IncomingMessage } from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => ({ dns: vi.fn(), calls: [] as Array<{ url: URL; options: RequestOptions; body?: string }>, mode: 'ok', status: 202, destroy: vi.fn() }));
vi.mock('node:dns/promises', () => ({ lookup: h.dns }));
vi.mock('node:https', () => ({ request: (url: URL, options: RequestOptions, callback: (response: IncomingMessage) => void) => {
  const call = { url, options, body: undefined as string | undefined }; h.calls.push(call);
  let closed = false;
  const emitter = Object.assign(new EventEmitter(), { end: (body: string) => {
    call.body = body;
    queueMicrotask(() => {
      if (closed) return;
      if (h.mode === 'error') { closed = true; emitter.emit('error', new Error('secret-token@example.test/private-query')); }
      else if (h.mode === 'ok') { closed = true; callback({ statusCode: h.status, headers: { location: 'https://127.0.0.1/private' }, destroy: h.destroy } as unknown as IncomingMessage); }
    });
  } });
  options.signal?.addEventListener('abort', () => { if (!closed) { closed = true; emitter.emit('error', new Error('aborted')); } }, { once: true });
  return emitter;
} }));
import { postPublicWebhook } from './post-public-webhook';
beforeEach(() => { h.calls.length = 0; h.mode = 'ok'; h.status = 202; h.destroy.mockClear(); h.dns.mockReset().mockResolvedValue([{ address: '8.8.8.8', family: 4 }]); });
afterEach(() => { vi.useRealTimers(); });
const headers = { 'content-type': 'application/json', 'x-riverz-signature': 'fixture-signature' };

describe('signed public webhook transport', () => {
  it('pins the checked DNS set while preserving hostname, certificate checks and exact UTF-8 body', async () => {
    h.dns.mockResolvedValueOnce([{ address: '2606:4700::1111', family: 6 }, { address: '8.8.8.8', family: 4 }]);
    const body = JSON.stringify({ message: 'Atención' });
    expect(await postPublicWebhook('https://receiver.test/event?q=1#ignored', body, headers)).toBe(202);
    expect(h.dns).toHaveBeenCalledOnce(); expect(h.calls).toHaveLength(1);
    const { url, options } = h.calls[0]; expect(url.hostname).toBe('receiver.test'); expect(url.hash).toBe('');
    expect(options).toMatchObject({ method: 'POST', agent: false, rejectUnauthorized: true, maxHeaderSize: 16384 });
    expect(options.headers).toMatchObject({ ...headers, 'content-length': String(Buffer.byteLength(body)) });
    expect(h.calls[0].body).toBe(body); expect(h.destroy).toHaveBeenCalledOnce();
    const callback = vi.fn(); options.lookup!('receiver.test', { all: true }, callback);
    expect(callback).toHaveBeenCalledWith(null, [{ address: '8.8.8.8', family: 4 }, { address: '2606:4700::1111', family: 6 }]);
    expect(h.dns).toHaveBeenCalledOnce();
  });
  it.each(['http://receiver.test', 'https://user:password@receiver.test', 'https://127.0.0.1', 'https://169.254.169.254', 'https://[::1]', 'https://[::ffff:7f00:1]', 'https://localhost'])('blocks a forbidden literal before connecting: %s', async url => {
    await expect(postPublicWebhook(url, '{}', headers)).rejects.toMatchObject({ code: 'webhook_destination_forbidden' });
    expect(h.calls).toHaveLength(0);
  });
  it.each(['10.0.0.1', '100.64.0.1', '192.168.1.1', '198.18.0.1', '224.0.0.1', 'fd00::1', 'fe80::1', '2001:db8::1'])('blocks an internal or special DNS answer: %s', async address => {
    h.dns.mockResolvedValue([{ address, family: address.includes(':') ? 6 : 4 }]);
    await expect(postPublicWebhook('https://receiver.test', '{}', headers)).rejects.toMatchObject({ code: 'webhook_destination_forbidden' });
    expect(h.calls).toHaveLength(0);
  });
  it('rejects mixed public/private DNS without connecting to the public answer first', async () => {
    h.dns.mockResolvedValue([{ address: '8.8.8.8', family: 4 }, { address: '10.0.0.1', family: 4 }]);
    await expect(postPublicWebhook('https://receiver.test', '{}', headers)).rejects.toMatchObject({ code: 'webhook_destination_forbidden' });
    expect(h.calls).toHaveLength(0);
  });
  it('does not resolve literal public addresses through DNS', async () => {
    expect(await postPublicWebhook('https://8.8.8.8/path', '{}', headers)).toBe(202);
    expect(h.dns).not.toHaveBeenCalled();
  });
  it('does not follow a redirect or replay the signed payload', async () => {
    h.status = 307;
    expect(await postPublicWebhook('https://receiver.test', '{}', headers)).toBe(307);
    expect(h.calls).toHaveLength(1); expect(h.destroy).toHaveBeenCalledOnce();
  });
  it('sanitizes network errors and never retries a potentially accepted POST', async () => {
    h.mode = 'error';
    await expect(postPublicWebhook('https://receiver.test', '{}', headers)).rejects.toMatchObject({ message: 'webhook_delivery_failed' });
    expect(h.calls).toHaveLength(1);
  });
  it.each(['dns', 'connection'])('bounds the entire %s wait to eight seconds', async phase => {
    vi.useFakeTimers(); if (phase === 'dns') h.dns.mockReturnValue(new Promise(() => {})); else h.mode = 'hang';
    const result = postPublicWebhook('https://receiver.test', '{}', headers).catch(error => error);
    await vi.advanceTimersByTimeAsync(8000);
    expect(await result).toMatchObject({ code: 'webhook_delivery_timeout' });
    expect(h.calls).toHaveLength(phase === 'dns' ? 0 : 1);
    expect(vi.getTimerCount()).toBe(0);
  });
  it('rejects oversized payloads before DNS or socket work', async () => {
    await expect(postPublicWebhook('https://receiver.test', 'x'.repeat(1024 * 1024 + 1), headers)).rejects.toMatchObject({ code: 'webhook_payload_too_large' });
    expect(h.dns).not.toHaveBeenCalled(); expect(h.calls).toHaveLength(0);
  });
});
