import { request } from 'node:https';
import { publicMediaLookup } from './download-public-media';
import { isPublicHttpsUrl } from './url-guard';

export type WebhookPostFailure = 'webhook_destination_forbidden' | 'webhook_delivery_timeout' | 'webhook_payload_too_large' | 'webhook_delivery_failed';
export class WebhookPostError extends Error {
  constructor(readonly code: WebhookPostFailure) { super(code); this.name = 'WebhookPostError'; }
}

/** One signed POST, pinned public DNS, verified TLS, no redirects or automatic retry. */
export async function postPublicWebhook(rawUrl: string, body: string, headers: Record<string, string>): Promise<number> {
  const url = rawUrl.length <= 2048 ? isPublicHttpsUrl(rawUrl) : null;
  if (!url) throw new WebhookPostError('webhook_destination_forbidden');
  const bytes = Buffer.byteLength(body, 'utf8');
  if (bytes > 1024 * 1024) throw new WebhookPostError('webhook_payload_too_large');
  url.hash = '';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8_000);
  let onAbort: (() => void) | undefined;
  try {
    const pinned = await Promise.race([
      publicMediaLookup(url),
      new Promise<never>((_, reject) => {
        onAbort = () => reject(new WebhookPostError('webhook_delivery_timeout'));
        controller.signal.addEventListener('abort', onAbort, { once: true });
      }),
    ]).catch(error => {
      if (controller.signal.aborted || error instanceof WebhookPostError) throw error;
      throw new WebhookPostError('webhook_destination_forbidden');
    });
    if (onAbort) controller.signal.removeEventListener('abort', onAbort);
    controller.signal.throwIfAborted();
    return await new Promise<number>((resolve, reject) => {
      const outgoing = request(url, {
        method: 'POST', agent: false, lookup: pinned, signal: controller.signal,
        // Preserve the URL hostname for Host/SNI and Node's default certificate checks.
        rejectUnauthorized: true,
        headers: { ...headers, 'content-length': String(bytes), 'user-agent': 'Riverz/1.0 (+https://riverz.co)' },
        maxHeaderSize: 16 * 1024,
      }, response => {
        const status = response.statusCode;
        response.destroy(); // Only the acknowledgement status is needed; no unbounded body.
        if (!status || status < 100 || status > 599) reject(new WebhookPostError('webhook_delivery_failed'));
        else resolve(status); // 3xx is reported as failure by the caller, never followed.
      });
      // Cleanup can race socket errors; keep a handler after the promise settles.
      outgoing.on('error', reject);
      outgoing.end(body);
    });
  } catch (error) {
    if (controller.signal.aborted) throw new WebhookPostError('webhook_delivery_timeout');
    if (error instanceof WebhookPostError) throw error;
    throw new WebhookPostError('webhook_delivery_failed');
  } finally {
    clearTimeout(timer);
    if (onAbort) controller.signal.removeEventListener('abort', onAbort);
    controller.abort();
  }
}
