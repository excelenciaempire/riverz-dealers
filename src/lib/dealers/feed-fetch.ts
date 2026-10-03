import 'server-only';
import { lookup } from 'node:dns/promises';
import { get } from 'node:https';
import { isPublicHttpsUrl } from '@/lib/security/url-guard';
import { DealerError } from './validation';

export function publicFeedAddress(address: string) {
  const p = address.split('.').map(Number);
  return (
    p.length === 4 &&
    p.every((n) => Number.isInteger(n) && n >= 0 && n <= 255) &&
    p[0] > 0 &&
    p[0] < 224 &&
    p[0] !== 127 &&
    p[0] !== 10 &&
    !(p[0] === 100 && p[1] >= 64 && p[1] <= 127) &&
    !(p[0] === 169 && p[1] === 254) &&
    !(p[0] === 172 && p[1] >= 16 && p[1] <= 31) &&
    !(p[0] === 192 && (p[1] === 168 || p[1] === 0)) &&
    !(p[0] === 198 && (p[1] === 18 || p[1] === 19))
  );
}
/** Resolve once and pin that public address to TLS; no redirects or token leakage. */
export async function fetchDealerFeed(raw: string, token?: string | null) {
  const url = isPublicHttpsUrl(raw);
  if (!url || (url.port && url.port !== '443')) throw new DealerError('feed');
  const addresses = await lookup(url.hostname, { all: true, family: 4 });
  if (!addresses.length || addresses.some((a) => !publicFeedAddress(a.address)))
    throw new DealerError('feed');
  return new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => req.destroy(new DealerError('feed')), 30000);
    const req = get(
      url,
      {
        family: 4,
        ...{ autoSelectFamily: false },
        headers: {
          Accept: 'application/json,text/csv',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        lookup: (_host, _options, callback) =>
          callback(null, addresses[0].address, 4),
      },
      (res) => {
        if (res.statusCode !== 200) {
          res.resume();
          req.destroy(new DealerError('feed'));
          return;
        }
        const chunks: Buffer[] = [];
        let bytes = 0;
        res.on('data', (chunk: Buffer) => {
          bytes += chunk.length;
          if (bytes > 8 * 1024 * 1024) req.destroy(new DealerError('feed'));
          else chunks.push(chunk);
        });
        res.on('end', () => {
          clearTimeout(timer);
          resolve(Buffer.concat(chunks).toString('utf8'));
        });
        res.on('error', (e) => {
          clearTimeout(timer);
          reject(e);
        });
      }
    );
    req.on('error', () => {
      clearTimeout(timer);
      reject(new DealerError('feed', 502));
    });
  });
}
