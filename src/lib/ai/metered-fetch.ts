import type { BillingContext } from '@/lib/wallet/operacion';
import { reservar, liquidar, cancelar } from '@/lib/wallet/operacion';
import { rateFor } from '@/lib/admin/cost';
import { inlineCountableMedia } from './countable-media';
import { observePlatformCredit } from '@/lib/admin/provider-credit';
import { modeloAnthropicVigente } from './model-version';

type Usage = {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_creation?: {
    ephemeral_5m_input_tokens?: number;
    ephemeral_1h_input_tokens?: number;
  };
  server_tool_use?: { web_search_requests?: number };
};
export function anthropicUsageCost(model: string, u: Usage): number {
  const r = rateFor(model);
  const read = u.cache_read_input_tokens ?? 0;
  const hour = u.cache_creation?.ephemeral_1h_input_tokens ?? 0;
  const write = (u.cache_creation_input_tokens ?? 0) - hour;
  const values = [
    u.input_tokens ?? 0,
    u.output_tokens ?? 0,
    read,
    hour,
    write,
    u.server_tool_use?.web_search_requests ?? 0,
  ];
  if (values.some((n) => !Number.isFinite(n) || n < 0))
    throw new Error('wallet_invalid_usage');
  return (
    ((u.input_tokens ?? 0) * r.input +
      (u.output_tokens ?? 0) * r.output +
      read * r.input * 0.1 +
      write * r.input * 1.25 +
      hour * r.input * 2) /
      1e6 +
    (u.server_tool_use?.web_search_requests ?? 0) * 0.01
  );
}

/** Billing at the HTTP boundary also accounts for discarded replies and individual tool-loop requests. */
export function meteredAnthropicFetch(
  ctx: BillingContext,
  transport: typeof fetch = fetch
): typeof fetch {
  return async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    if (!/\/messages(?:\?|$)/.test(url))
      return transport(input, init);
    const body = JSON.parse(String(init?.body ?? '{}'));
    const model = modeloAnthropicVigente(String(body.model ?? ''));
    if (model !== body.model) {
      body.model = model;
      const headers = new Headers(
        init?.headers ?? (input instanceof Request ? input.headers : undefined)
      );
      headers.delete('content-length');
      init = { ...init, headers, body: JSON.stringify(body) };
    }
    if (ctx.origenDeLaClave === 'agent') return transport(input, init);
    const apiKey = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined)).get('x-api-key') ?? '';
    const rate = rateFor(body.model);
    if (body.service_tier && body.service_tier !== 'standard')
      throw new Error('wallet_unsupported_service_tier');
    if (body.inference_geo) throw new Error('wallet_unsupported_inference_geo');
    if (await inlineCountableMedia(body.messages)) {
      const headers = new Headers(init?.headers);
      headers.delete('content-length');
      init = { ...init, headers, body: JSON.stringify(body) };
    }
    const count = await transport(
      url.replace(/\/messages(?=\?|$)/, '/messages/count_tokens'),
      {
        ...init,
        body: JSON.stringify({
          model: body.model,
          messages: body.messages,
          ...(body.system ? { system: body.system } : {}),
          ...(body.tools ? { tools: body.tools } : {}),
          ...(body.thinking ? { thinking: body.thinking } : {}),
        }),
      }
    );
    if (!count.ok) {
      await observePlatformCredit(ctx.db, 'anthropic', apiKey, count);
      throw new Error(`wallet_token_count_failed: ${count.status}`);
    }
    const tokens = (await count.json()).input_tokens;
    if (
      !Number.isSafeInteger(tokens) ||
      tokens < 0 ||
      !Number.isSafeInteger(body.max_tokens)
    )
      throw new Error('wallet_invalid_token_budget');
    const searches = (body.tools ?? [])
      .filter((t: { name?: string }) => t.name === 'web_search')
      .reduce(
        (n: number, t: { max_uses?: number }) => n + (t.max_uses ?? 5),
        0
      );
    const reserveUsd =
      (tokens * rate.input * 2 + body.max_tokens * rate.output) / 1e6 +
      searches * 0.01;
    const id = await reservar(ctx, 'anthropic', reserveUsd, {
      modelo: body.model,
    });
    // Network errors leave the reservation intact: the provider may have processed the request.
    const response = await transport(input, init);
    await observePlatformCredit(ctx.db, 'anthropic', apiKey, response);
    if (!response.ok) {
      if ([400, 401, 403, 404, 413, 422, 429].includes(response.status))
        await cancelar(ctx, id);
      return response;
    }
    const settle = (usage: Usage, providerId?: string) =>
      liquidar(ctx, id, 'anthropic', anthropicUsageCost(body.model, usage), {
        modelo: body.model,
        usage,
        providerId,
      });
    if (!body.stream) {
      const json = await response.clone().json();
      if (!json.usage) throw new Error('wallet_missing_usage');
      await settle(json.usage, json.id);
      return response;
    }
    if (!response.body) throw new Error('wallet_missing_stream');
    let usage: Usage | undefined;
    let providerId: string | undefined;
    let completed = false;
    let pending = '';
    const decoder = new TextDecoder();
    const parse = (text: string) => {
      pending += text;
      const lines = pending.split('\n');
      pending = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = JSON.parse(line.slice(6));
        if (data.type === 'message_stop') completed = true;
        if (data.type === 'message_start') {
          usage = data.message.usage;
          providerId = data.message.id;
        }
        if (data.type === 'message_delta' && data.usage)
          usage = { ...usage, ...data.usage };
      }
    };
    const stream = response.body.pipeThrough(
      new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) {
          parse(decoder.decode(chunk, { stream: true }));
          controller.enqueue(chunk);
        },
        async flush() {
          parse(decoder.decode() + '\n');
          if (!usage || !completed) throw new Error('wallet_incomplete_usage');
          await settle(usage, providerId);
        },
      })
    );
    return new Response(stream, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  };
}
