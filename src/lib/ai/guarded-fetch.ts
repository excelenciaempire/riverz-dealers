import { secureSystemPrompt, UNTRUSTED_CONTENT_POLICY } from './input-security';

/** Covers every shared Anthropic client, including streaming and merchant keys.
 * Runs before billing so token counting includes the actual protected prompt.
 * This is instruction hardening, not a substitute for tool authorization.
 */
export function guardedAnthropicFetch(transport: typeof fetch): typeof fetch {
  return async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    if (!/\/messages(?:\?|$)/.test(url)) return transport(input, init);
    const request = new Request(input, init);
    if (request.method !== 'POST') return transport(input, init);
    const body = await request.clone().json();
    if (Array.isArray(body.system)) {
      const last = body.system.at(-1);
      if (typeof last?.text !== 'string' || !last.text.endsWith(UNTRUSTED_CONTENT_POLICY)) {
        body.system = [...body.system, { type: 'text', text: UNTRUSTED_CONTENT_POLICY }];
      }
    } else {
      body.system = secureSystemPrompt(typeof body.system === 'string' ? body.system : '');
    }
    const headers = new Headers(request.headers);
    headers.delete('content-length');
    return transport(request, { ...init, method: request.method, headers,
      signal: request.signal, body: JSON.stringify(body) });
  };
}
