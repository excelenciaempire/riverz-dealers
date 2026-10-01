import { request } from 'node:https';
import { publicMediaLookup } from './download-public-media';
import { isPublicHttpsUrl } from './url-guard';

export type PublicJsonFailure = 'http_destination_forbidden' | 'http_input_invalid' | 'http_timeout'
  | 'http_transport_failed' | 'http_response_invalid' | 'http_response_too_large' | 'http_status_failed';
export class PublicJsonError extends Error {
  constructor(readonly code: PublicJsonFailure, readonly dispatched = false, readonly status?: number) {
    super(code); this.name = 'PublicJsonError';
  }
}
export interface PublicJsonRequest {
  url: string;
  method: 'GET' | 'POST';
  /** Serialized JSON, only for POST. Never accept arbitrary caller headers. */
  body?: string;
  credential?: { kind: 'bearer' | 'api-key'; value: string; header?: 'x-api-key' | 'x-make-apikey' };
  idempotencyKey?: string;
}

/** A single bounded JSON exchange, with pinned public DNS and verified TLS. */
export async function requestPublicJson(input: PublicJsonRequest): Promise<{ status: number; data: unknown }> {
  const url = typeof input.url === 'string' && input.url.length <= 2048 ? isPublicHttpsUrl(input.url) : null;
  if (!url || url.href.length > 2048) throw new PublicJsonError('http_destination_forbidden');
  if (!['GET', 'POST'].includes(input.method) || (input.method === 'GET' && input.body !== undefined)
    || (input.body !== undefined && (typeof input.body !== 'string' || Buffer.byteLength(input.body, 'utf8') > 64 * 1024))) {
    throw new PublicJsonError('http_input_invalid');
  }
  if (input.body !== undefined) {
    try { JSON.parse(input.body); } catch { throw new PublicJsonError('http_input_invalid'); }
  }
  const credential = input.credential;
  if (credential && (!['bearer', 'api-key'].includes(credential.kind) || typeof credential.value !== 'string'
    || !credential.value.length || credential.value.length > 4096 || !/^[\x20-\x7e]+$/.test(credential.value)
    || (credential.header !== undefined && (credential.kind !== 'api-key' || !['x-api-key', 'x-make-apikey'].includes(credential.header)))
    || (credential.header === 'x-make-apikey' && credential.value.length > 512))) {
    throw new PublicJsonError('http_input_invalid');
  }
  if (input.idempotencyKey !== undefined && !/^[A-Za-z0-9_-]{16,128}$/.test(input.idempotencyKey)) throw new PublicJsonError('http_input_invalid');
  url.hash = '';
  const headers: Record<string, string> = { accept: 'application/json', 'accept-encoding': 'identity',
    'user-agent': 'Riverz/1.0 (+https://riverz.co)' };
  if (input.method === 'POST') {
    headers['content-type'] = 'application/json'; headers['content-length'] = String(Buffer.byteLength(input.body ?? '', 'utf8'));
  }
  if (credential) headers[credential.kind === 'bearer' ? 'authorization' : (credential.header ?? 'x-api-key')] =
    credential.kind === 'bearer' ? `Bearer ${credential.value}` : credential.value;
  if (input.idempotencyKey) headers['idempotency-key'] = input.idempotencyKey;
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 8_000);
  let onAbort: (() => void) | undefined, dispatched = false;
  try {
    const lookup = await Promise.race([publicMediaLookup(url), new Promise<never>((_, reject) => {
      onAbort = () => reject(new PublicJsonError('http_timeout'));
      controller.signal.addEventListener('abort', onAbort, { once: true });
    })]).catch(error => {
      if (controller.signal.aborted || error instanceof PublicJsonError) throw error;
      throw new PublicJsonError('http_destination_forbidden');
    });
    if (onAbort) controller.signal.removeEventListener('abort', onAbort);
    controller.signal.throwIfAborted();
    return await new Promise<{ status: number; data: unknown }>((resolve, reject) => {
      const outgoing = request(url, { method: input.method, agent: false, lookup, signal: controller.signal,
        rejectUnauthorized: true, maxHeaderSize: 16 * 1024, headers }, response => {
        let settled = false, bytes = 0;
        const chunks: Buffer[] = [];
        const fail = (code: PublicJsonFailure) => {
          if (settled) return;
          settled = true; reject(new PublicJsonError(code, dispatched, response.statusCode)); response.destroy();
        };
        // Keep handlers through close/error races; never expose headers or error text.
        response.on('error', () => fail('http_transport_failed'));
        response.on('aborted', () => fail('http_transport_failed'));
        response.on('close', () => { if (!settled) fail('http_transport_failed'); });
        const status = response.statusCode;
        if (!status || status < 200 || status >= 300) { fail('http_status_failed'); return; }
        if (status === 204 || status === 205) {
          settled = true; resolve({ status, data: null }); response.destroy(); return;
        }
        const type = String(response.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
        if (!/^application\/(?:json|[a-z0-9.+-]+\+json)$/.test(type)
          || (response.headers['content-encoding'] && response.headers['content-encoding'] !== 'identity')) {
          fail('http_response_invalid'); return;
        }
        const declared = response.headers['content-length'];
        if (declared && (!/^\d+$/.test(String(declared)) || Number(declared) > 128 * 1024)) { fail('http_response_too_large'); return; }
        response.on('data', (chunk: Buffer) => {
          if (settled) return;
          bytes += chunk.length;
          if (bytes > 128 * 1024) { fail('http_response_too_large'); return; }
          chunks.push(Buffer.from(chunk));
        });
        response.on('end', () => {
          if (settled) return;
          try {
            const data: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
            settled = true; resolve({ status, data });
          } catch { fail('http_response_invalid'); }
        });
      });
      outgoing.on('error', () => reject(new PublicJsonError('http_transport_failed', dispatched)));
      // Conservative: once end is invoked, a POST must never be replayed automatically.
      dispatched = true;
      outgoing.end(input.body);
    });
  } catch (error) {
    if (controller.signal.aborted) throw new PublicJsonError('http_timeout', dispatched);
    if (error instanceof PublicJsonError) throw error;
    throw new PublicJsonError('http_transport_failed', dispatched);
  } finally {
    clearTimeout(timer);
    if (onAbort) controller.signal.removeEventListener('abort', onAbort);
    controller.abort();
  }
}
