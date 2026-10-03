import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
vi.mock('server-only', () => ({}));
const mocks = vi.hoisted(() => ({ lookup: vi.fn(), get: vi.fn() }));
vi.mock('node:dns/promises', () => ({ lookup: mocks.lookup }));
vi.mock('node:https', () => ({ get: mocks.get }));
import { fetchDealerFeed, publicFeedAddress } from './feed-fetch';
beforeEach(() => vi.clearAllMocks());
describe('dealer feed network boundary', () => {
  it('rejects private, loopback, metadata and shared-address networks', () => {
    for (const ip of [
      '127.0.0.1',
      '10.1.2.3',
      '172.16.0.4',
      '192.168.1.1',
      '169.254.169.254',
      '100.64.1.1',
      '198.18.0.1',
      '::1',
    ])
      expect(publicFeedAddress(ip)).toBe(false);
    expect(publicFeedAddress('8.8.8.8')).toBe(true);
  });
  it('never connects when DNS includes a private address', async () => {
    mocks.lookup.mockResolvedValue([
      { address: '8.8.8.8', family: 4 },
      { address: '10.0.0.1', family: 4 },
    ]);
    await expect(
      fetchDealerFeed('https://inventory.example.com/feed')
    ).rejects.toThrow('feed');
    expect(mocks.get).not.toHaveBeenCalled();
  });
  it('pins the validated address, retains TLS hostname and rejects redirects', async () => {
    mocks.lookup.mockResolvedValue([{ address: '8.8.8.8', family: 4 }]);
    mocks.get.mockImplementation((url, options, callback) => {
      expect(url.hostname).toBe('inventory.example.com');
      expect(options.autoSelectFamily).toBe(false);
      options.lookup(
        url.hostname,
        {},
        (error: unknown, address: string, family: number) => {
          expect(error).toBeNull();
          expect(address).toBe('8.8.8.8');
          expect(family).toBe(4);
        }
      );
      const req = new EventEmitter() as EventEmitter & {
        destroy: (error: Error) => void;
      };
      req.destroy = (error) => queueMicrotask(() => req.emit('error', error));
      queueMicrotask(() => callback({ statusCode: 302, resume: () => {} }));
      return req;
    });
    await expect(
      fetchDealerFeed('https://inventory.example.com/feed', 'secret')
    ).rejects.toThrow('feed');
    expect(mocks.get).toHaveBeenCalledTimes(1);
  });
  it('reads a complete response within the same pinned connection', async () => {
    mocks.lookup.mockResolvedValue([{ address: '8.8.8.8', family: 4 }]);
    mocks.get.mockImplementation((_url, _options, callback) => {
      const req = new EventEmitter();
      queueMicrotask(() => {
        const res = new EventEmitter() as EventEmitter & { statusCode: number };
        res.statusCode = 200;
        callback(res);
        res.emit('data', Buffer.from('[{"stock_number":"A"}]'));
        res.emit('end');
      });
      return req;
    });
    expect(await fetchDealerFeed('https://inventory.example.com/feed')).toBe(
      '[{"stock_number":"A"}]'
    );
  });
});
