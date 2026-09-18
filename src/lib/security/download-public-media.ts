import { lookup } from 'node:dns/promises';
import { request } from 'node:https';
import { BlockList, isIP, type LookupFunction } from 'node:net';
import type { IncomingMessage } from 'node:http';

const blocked = new BlockList();
for (const [network, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
  ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24],
  ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24],
  ['224.0.0.0', 4], ['240.0.0.0', 4],
] as const) blocked.addSubnet(network, prefix, 'ipv4');
for (const [network, prefix] of [
  ['2001::', 23], ['2001:db8::', 32], ['2002::', 16], ['3fff::', 20],
] as const) blocked.addSubnet(network, prefix, 'ipv6');
const globalV6 = new BlockList();
globalV6.addSubnet('2000::', 3, 'ipv6');

export function isPublicMediaAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return !blocked.check(address, 'ipv4');
  return family === 6 && globalV6.check(address, 'ipv6') && !blocked.check(address, 'ipv6');
}

/**
 * Resolve once and pin the checked addresses to the actual TLS connection.
 *
 * IPv4 va primero. El CDN de Meta (`lookaside.fbsbx.com`) publica AAAA y A,
 * y el resolver devuelve las AAAA antes; la instancia de Render no tiene
 * salida IPv6, así que conectar a la primera dirección fallaba con
 * ENETUNREACH y —como el error se tragaba— TODOS los adjuntos de Instagram
 * quedaron como URL pelada en la bandeja del 16 al 18 de septiembre de 2026.
 * `addresses` sale ordenada para que `connect` (que prueba en orden) llegue
 * por v4 y caiga a v6 sólo si hace falta.
 */
export async function publicMediaLookup(url: URL): Promise<LookupFunction & { addresses: Array<{ address: string; family: number }> }> {
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error('media_url_forbidden');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const resolved = isIP(host)
    ? [{ address: host, family: isIP(host) }]
    : await lookup(host, { all: true, verbatim: true });
  if (!resolved.length || resolved.some(row => !isPublicMediaAddress(row.address))) {
    throw new Error('media_address_forbidden');
  }
  const addresses = [...resolved].sort((a, b) => a.family - b.family);
  const fn: LookupFunction = (_hostname, options, callback) => {
    if (options.all) callback(null, addresses);
    else {
      const address = addresses.find(row => !options.family || row.family === options.family);
      if (!address) callback(new Error('media_address_family_unavailable'), []);
      else callback(null, address.address, address.family);
    }
  };
  return Object.assign(fn, { addresses });
}

/** Conecta probando cada dirección validada en orden; el primer socket que responde gana. */
async function connect(
  url: URL,
  headers: Headers,
  pinned: Awaited<ReturnType<typeof publicMediaLookup>>,
  signal: AbortSignal,
): Promise<IncomingMessage> {
  let ultimo: unknown = new Error('media_no_address');
  for (const candidate of pinned.addresses) {
    try {
      return await new Promise<IncomingMessage>((resolve, reject) => {
        const one: LookupFunction = (_hostname, options, callback) => {
          if (options.all) callback(null, [candidate]);
          else callback(null, candidate.address, candidate.family);
        };
        const outgoing = request(url, {
          method: 'GET', headers: Object.fromEntries(headers), lookup: one,
          // No connection pooling can reuse a socket outside the checked DNS set.
          agent: false, signal,
        }, resolve);
        outgoing.once('error', reject);
        outgoing.end();
      });
    } catch (err) {
      ultimo = err;
      if (signal.aborted) break;
    }
  }
  throw ultimo;
}

/** HTTPS only, pinned public DNS, bounded redirects/time/bytes, no decompression. */
export async function downloadPublicMedia(
  rawUrl: string,
  maxBytes: number,
  timeoutMs: number,
  initialHeaders?: HeadersInit,
): Promise<{ buffer: Buffer; mime: string } | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let response: IncomingMessage | undefined;
  try {
    let url = new URL(rawUrl);
    const headers = new Headers(initialHeaders);
    headers.set('accept-encoding', 'identity');
    for (let hop = 0; hop <= 5; hop++) {
      const pinned = await Promise.race([
        publicMediaLookup(url),
        new Promise<never>((_resolve, reject) => {
          if (controller.signal.aborted) reject(new Error('media_download_timeout'));
          else controller.signal.addEventListener('abort', () => reject(new Error('media_download_timeout')), { once: true });
        }),
      ]);
      controller.signal.throwIfAborted();
      response = await connect(url, headers, pinned, controller.signal);
      if ([301, 302, 303, 307, 308].includes(response.statusCode ?? 0)) {
        const location = response.headers.location;
        response.destroy();
        if (!location) return null;
        const next = new URL(location, url);
        if (next.origin !== url.origin) {
          headers.delete('authorization');
          headers.delete('cookie');
          headers.delete('proxy-authorization');
        }
        url = next;
        continue;
      }
      if (!response.statusCode || response.statusCode < 200 || response.statusCode >= 300) return null;
      if (response.headers['content-encoding'] && response.headers['content-encoding'] !== 'identity') return null;
      if (Number(response.headers['content-length']) > maxBytes) return null;
      const chunks: Buffer[] = [];
      let bytes = 0;
      for await (const chunk of response) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        bytes += buffer.length;
        if (bytes > maxBytes) return null;
        chunks.push(buffer);
      }
      return { buffer: Buffer.concat(chunks), mime: response.headers['content-type'] || 'application/octet-stream' };
    }
    return null;
  } catch (err) {
    // Antes se tragaba: dos días sin adjuntos de Instagram y ni una línea de
    // log que dijera por qué. Sin la URL entera (lleva firma).
    let donde = rawUrl;
    try { donde = new URL(rawUrl).host; } catch { /* queda tal cual */ }
    console.warn(`[download-public-media] ${donde}: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  } finally {
    clearTimeout(timeout);
    response?.destroy();
    controller.abort();
  }
}
