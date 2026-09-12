import { beforeEach, expect, it, vi } from 'vitest';
import { Readable, PassThrough } from 'node:stream';
import { EventEmitter } from 'node:events';
import type { IncomingMessage, RequestOptions } from 'node:http';

const mocks = vi.hoisted(() => ({ lookup: vi.fn(), request: vi.fn() }));
vi.mock('node:dns/promises', () => ({ lookup: mocks.lookup }));
vi.mock('node:https', () => ({ request: mocks.request }));
import { downloadPublicMedia, isPublicMediaAddress, publicMediaLookup } from './download-public-media';

function reply(status = 200, headers = {}, chunks = [Buffer.from('photo')]) {
  return Object.assign(Readable.from(chunks), { statusCode: status, headers }) as IncomingMessage;
}
function serve(responses: IncomingMessage[]) {
  mocks.request.mockImplementation((_url: URL, options: RequestOptions, callback: (r: IncomingMessage) => void) => {
    const outgoing = new EventEmitter();
    const incoming = responses.shift();
    if (!incoming) throw Error('unexpected request');
    options.signal?.addEventListener('abort', () => {
      incoming.destroy(new Error('aborted'));
      outgoing.emit('error', new Error('aborted'));
    }, { once: true });
    return Object.assign(outgoing, { end: () => callback(incoming) });
  });
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.lookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
});

it.each(['127.0.0.1', '10.1.2.3', '169.254.169.254', '172.16.2.3', '192.168.1.2',
  '100.100.100.200', '0.1.2.3', '224.1.2.3', '240.1.2.3', '198.18.0.1',
  '::', '::1', 'fd00::1', 'fe90::1', '::ffff:127.0.0.1', '2002:7f00:1::', '2001:db8::1', 'invalid'])
('rejects nonpublic address %s', address => expect(isPublicMediaAddress(address)).toBe(false));

it.each(['93.184.216.34', '2606:4700:4700::1111', '2001:4860:4860::8888'])
('accepts public address %s', address => expect(isPublicMediaAddress(address)).toBe(true));

it.each(['http://example.test/photo', 'https://user:password@example.test/photo',
  'https://127.1/photo', 'https://2130706433/photo', 'https://[::ffff:127.0.0.1]/photo'])
('does not connect to an unsafe URL: %s', async url => {
  expect(await downloadPublicMedia(url, 1024, 1000)).toBeNull();
  expect(mocks.request).not.toHaveBeenCalled();
});

it('rejects public-looking DNS names resolving to private or mixed addresses', async () => {
  mocks.lookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }, { address: '10.0.0.1', family: 4 }]);
  expect(await downloadPublicMedia('https://rebind.test/photo', 1024, 1000)).toBeNull();
  expect(mocks.request).not.toHaveBeenCalled();
});

it('pins the validated DNS results instead of resolving again during connection', async () => {
  const pinned = await publicMediaLookup(new URL('https://rebind.test/photo'));
  mocks.lookup.mockResolvedValue([{ address: '127.0.0.1', family: 4 }]);
  const callback = vi.fn();
  pinned('rebind.test', { all: true }, callback);
  expect(callback).toHaveBeenCalledWith(null, [{ address: '93.184.216.34', family: 4 }]);
  expect(mocks.lookup).toHaveBeenCalledTimes(1);
});

it('downloads a normal asset at the exact byte limit with pinned lookup', async () => {
  serve([reply(200, { 'content-type': 'image/png' })]);
  expect(await downloadPublicMedia('https://cdn.test/photo', 5, 1000)).toEqual({ buffer: Buffer.from('photo'), mime: 'image/png' });
  expect(mocks.request.mock.calls[0][1]).toMatchObject({ agent: false, lookup: expect.any(Function) });
});

it('stops actual streaming bytes even when Content-Length is false', async () => {
  const response = reply(200, { 'content-length': '1' }, Array.from({ length: 20 }, () => Buffer.alloc(64)));
  serve([response]);
  expect(await downloadPublicMedia('https://cdn.test/photo', 100, 1000)).toBeNull();
  expect(response.destroyed).toBe(true);
});

it('rechecks redirect destinations and never connects to metadata', async () => {
  serve([reply(302, { location: 'https://169.254.169.254/latest/meta-data/' })]);
  expect(await downloadPublicMedia('https://cdn.test/photo', 1024, 1000)).toBeNull();
  expect(mocks.request).toHaveBeenCalledTimes(1);
});

it('drops credentials on a cross-origin redirect', async () => {
  serve([reply(302, { location: 'https://other-cdn.test/photo' }), reply()]);
  expect(await downloadPublicMedia('https://cdn.test/photo', 1024, 1000, { authorization: 'Bearer synthetic', cookie: 'synthetic=1' })).not.toBeNull();
  expect(mocks.request.mock.calls[0][1].headers.authorization).toBe('Bearer synthetic');
  expect(mocks.request.mock.calls[1][1].headers).not.toHaveProperty('authorization');
  expect(mocks.request.mock.calls[1][1].headers).not.toHaveProperty('cookie');
});

it('bounds redirect loops', async () => {
  serve(Array.from({ length: 6 }, () => reply(302, { location: '/again' })));
  expect(await downloadPublicMedia('https://cdn.test/photo', 1024, 1000)).toBeNull();
  expect(mocks.request).toHaveBeenCalledTimes(6);
});

it('times out a DNS resolution that never completes', async () => {
  mocks.lookup.mockReturnValue(new Promise(() => undefined));
  expect(await downloadPublicMedia('https://slow.test/photo', 1024, 10)).toBeNull();
  expect(mocks.request).not.toHaveBeenCalled();
});

it('times out a body that stops sending', async () => {
  const response = Object.assign(new PassThrough(), { statusCode: 200, headers: {} }) as unknown as IncomingMessage;
  serve([response]);
  expect(await downloadPublicMedia('https://slow.test/photo', 1024, 10)).toBeNull();
  expect(response.destroyed).toBe(true);
});
