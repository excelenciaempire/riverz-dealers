import type { BillingContext } from '@/lib/wallet/operacion';
import { reservar, liquidar, cancelar } from '@/lib/wallet/operacion';

/** Usage credits only. Never derive a unit cost from a monthly subscription. */
export function ttsCost(provider: string, text: string): number {
  if (provider === 'fish') return (Buffer.byteLength(text, 'utf8') * 15) / 1e6;
  const rate = Number(process.env.ELEVENLABS_USAGE_USD_PER_CHARACTER);
  if (provider !== 'elevenlabs' || !Number.isFinite(rate) || rate <= 0)
    throw new Error('wallet_tts_rate_not_configured');
  return text.length * rate;
}

export async function synthesizeBilled(
  ctx: BillingContext,
  opts: {
    provider: string;
    key: string;
    model: string;
    voice: string;
    text: string;
    format?: string;
  }
) {
  const usd = ttsCost(opts.provider, opts.text);
  const id = await reservar(ctx, opts.provider, usd, { modelo: opts.model });
  const fish = opts.provider === 'fish';
  const response = await fetch(
    fish
      ? 'https://api.fish.audio/v1/tts'
      : `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(opts.voice)}`,
    {
      method: 'POST',
      headers: fish
        ? {
            authorization: `Bearer ${opts.key}`,
            'content-type': 'application/json',
            model: opts.model,
          }
        : {
            'xi-api-key': opts.key,
            'content-type': 'application/json',
            accept: 'audio/mpeg',
          },
      body: JSON.stringify(
        fish
          ? {
              text: opts.text,
              reference_id: opts.voice,
              format: opts.format === 'opus' ? 'opus' : opts.format === 'wav' ? 'wav' : 'mp3',
            }
          : { text: opts.text, model_id: opts.model }
      ),
      signal: AbortSignal.timeout(60000),
    }
  );
  if (!response.ok) {
    if ([400, 401, 402, 403, 404, 422, 429].includes(response.status))
      await cancelar(ctx, id);
    throw new Error(`tts_provider_failed: ${response.status}`);
  }
  await liquidar(ctx, id, opts.provider, usd, {
    modelo: opts.model,
    utf8Bytes: Buffer.byteLength(opts.text, 'utf8'),
    characters: opts.text.length,
  });
  return response;
}
