/**
 * Voz — ¿esta llave sirve?
 *
 * Nació de un día entero de teléfono roto: la clave del modelo estaba puesta,
 * el panel la mostraba como configurada, y el proveedor devolvía 402 sin saldo.
 * El agente saludaba, no podía pensar, y colgaba a los veinte segundos. Nadie
 * tenía cómo enterarse salvo leyendo los logs del worker.
 *
 * Esto hace la llamada más barata posible a cada proveedor —listar la cuenta,
 * o pedir cinco tokens— y traduce la respuesta a algo que se pueda leer: anda,
 * no tiene saldo, la llave está mal, o el modelo no existe.
 */
import type { VoiceModelResolved } from './model-config';

export type VoiceProbeCode =
  | 'ok'
  | 'no_key'
  | 'bad_key'
  | 'no_credit'
  | 'model_not_found'
  | 'rate_limited'
  | 'unreachable'
  | 'error';

export interface VoiceProbeResult {
  code: VoiceProbeCode;
  /** Lo que dijo el proveedor, recortado. Para el admin, no para el comercio. */
  detail?: string;
  /** A quién se le preguntó, para que el cartel no sea ambiguo. */
  provider?: string;
  model?: string;
}

/** La env var del worker que cubre a cada proveedor cuando no hay llave guardada. */
const ENV_POR_HOST: [string, string[]][] = [
  ['cerebras', ['CEREBRAS_API_KEY']],
  ['groq', ['GROQ_API_KEY']],
  ['googleapis', ['GEMINI_API_KEY', 'GOOGLE_API_KEY']],
  ['deepinfra', ['DEEPINFRA_API_KEY']],
  ['together', ['TOGETHER_API_KEY']],
  ['fireworks', ['FIREWORKS_API_KEY']],
  ['deepseek', ['DEEPSEEK_API_KEY']],
  ['openai.com', ['OPENAI_API_KEY']],
];

const ENV_POR_PROVEEDOR: Record<string, string[]> = {
  anthropic: ['ANTHROPIC_API_KEY'],
  deepgram: ['DEEPGRAM_API_KEY'],
  elevenlabs: ['ELEVENLABS_API_KEY', 'ELEVEN_API_KEY'],
  fish: ['FISH_API_KEY'],
  cartesia: ['CARTESIA_API_KEY'],
  google: ['GEMINI_API_KEY', 'GOOGLE_API_KEY'],
  gemini_live: ['GEMINI_API_KEY', 'GOOGLE_API_KEY'],
};

/**
 * La llave que USARÍA el worker: la guardada en la config, o la del entorno.
 *
 * Espeja `_llm_key` del worker a propósito. Si acá se resolviera distinto, el
 * panel probaría una llave y las llamadas usarían otra — el peor resultado
 * posible para un botón que existe para dar certeza.
 */
function resolverLlave(
  guardada: string | null,
  provider: string,
  baseUrl: string | null,
): string | null {
  if (guardada) return guardada;
  const host = (baseUrl || '').toLowerCase();
  if (host) {
    for (const [aguja, envs] of ENV_POR_HOST) {
      if (host.includes(aguja)) {
        for (const e of envs) if (process.env[e]) return process.env[e] as string;
      }
    }
  }
  for (const e of ENV_POR_PROVEEDOR[provider] ?? []) {
    if (process.env[e]) return process.env[e] as string;
  }
  return null;
}

/** Traduce el código HTTP + el cuerpo a un motivo que se entienda. */
function leerRespuesta(status: number, cuerpo: string): VoiceProbeResult {
  const txt = cuerpo.slice(0, 300);
  if (status === 200 || status === 201) return { code: 'ok' };
  if (status === 401 || status === 403) {
    // Cloudflare corta algunos hosts (Groq, Cerebras) por user-agent con un
    // 403 «error code: 1010». No es la llave: es el borde, y el worker no lo
    // sufre porque sale desde otro sitio.
    if (/1010/.test(txt)) return { code: 'unreachable', detail: 'bloqueado por el borde (1010)' };
    return { code: 'bad_key', detail: txt };
  }
  if (status === 402) return { code: 'no_credit', detail: txt };
  if (status === 404 && /model/i.test(txt)) return { code: 'model_not_found', detail: txt };
  if (status === 429) return { code: 'rate_limited', detail: txt };
  if (/insufficient|quota|credit|billing/i.test(txt)) return { code: 'no_credit', detail: txt };
  return { code: 'error', detail: `${status} ${txt}` };
}

async function pedir(
  url: string,
  init: RequestInit,
): Promise<VoiceProbeResult> {
  try {
    const res = await fetch(url, {
      ...init,
      signal: AbortSignal.timeout(12_000),
      cache: 'no-store',
    });
    return leerRespuesta(res.status, await res.text());
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { code: 'unreachable', detail: msg.slice(0, 200) };
  }
}

/** Un chat mínimo contra cualquier endpoint OpenAI-compatible. */
function probarChatCompatible(
  baseUrl: string,
  key: string,
  model: string,
): Promise<VoiceProbeResult> {
  const cuerpo: Record<string, unknown> = {
    model,
    max_tokens: 5,
    messages: [{ role: 'user', content: 'ok' }],
  };
  // Los `gpt-oss` razonan antes de contestar y se comen el presupuesto: mismo
  // trato que en el worker, o la prueba sale vacía y parece un fallo.
  if (model.toLowerCase().includes('gpt-oss')) cuerpo.reasoning_effort = 'low';
  return pedir(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(cuerpo),
  });
}

export type VoiceLayer = 'stt' | 'llm' | 'tts' | 'realtime';

/**
 * Prueba una capa del stack de voz tal como está configurada hoy.
 *
 * Sólo lee: ninguna prueba consume saldo apreciable (cinco tokens, o el
 * endpoint de la cuenta).
 */
export async function probarCapa(
  cfg: VoiceModelResolved,
  capa: VoiceLayer,
): Promise<VoiceProbeResult> {
  const provider = (cfg[`${capa}_provider`] as string | null) || '';
  const model = (cfg[`${capa}_model`] as string | null) || '';
  const anthropicModel = model || 'claude-sonnet-5-5';
  const baseUrl = (cfg[`${capa}_base_url`] as string | null) ?? null;
  // `getVoiceModelResolved` ya descifró lo que hubiera guardado; si no hay,
  // se cae a la env var igual que el worker.
  const key = resolverLlave(cfg[`${capa}_api_key`] as string | null, provider, baseUrl);
  const marca = { provider, model };
  if (!key) return { ...marca, code: 'no_key' };

  // Un endpoint propio (Modal, vLLM, Groq, Cerebras) se prueba por el
  // protocolo OpenAI, que es lo que va a usar el worker.
  if (baseUrl && (capa === 'llm' || capa === 'stt' || capa === 'tts')) {
    if (capa === 'llm') return { ...marca, ...(await probarChatCompatible(baseUrl, key, model)) };
    return { ...marca, ...(await pedir(`${baseUrl.replace(/\/$/, '')}/models`, {
      headers: { Authorization: `Bearer ${key}` },
    })) };
  }

  switch (provider) {
    case 'anthropic':
      return { ...marca, ...(await pedir('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': key,
          'anthropic-version': '2023-06-01',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: anthropicModel,
          max_tokens: 5,
          ...(anthropicModel === 'claude-sonnet-5-5'
            ? {
                thinking: { type: 'between_tools' },
                output_config: { effort: 'low' },
              }
            : {}),
          messages: [{ role: 'user', content: 'ok' }],
        }),
      })) };

    case 'deepgram':
      return { ...marca, ...(await pedir('https://api.deepgram.com/v1/projects', {
        headers: { Authorization: `Token ${key}` },
      })) };

    case 'elevenlabs':
      return { ...marca, ...(await pedir('https://api.elevenlabs.io/v1/user/subscription', {
        headers: { 'xi-api-key': key },
      })) };

    case 'fish':
      return { ...marca, ...(await pedir('https://api.fish.audio/wallet/self/api-credit', {
        headers: { Authorization: `Bearer ${key}` },
      })) };

    case 'cartesia':
      return { ...marca, ...(await pedir('https://api.cartesia.ai/voices', {
        headers: { 'X-API-Key': key, 'Cartesia-Version': '2024-06-10' },
      })) };

    case 'google':
    case 'gemini_live':
      return { ...marca, ...(await pedir(
        'https://generativelanguage.googleapis.com/v1beta/models',
        { headers: { 'x-goog-api-key': key } },
      )) };

    default:
      return { ...marca, code: 'error', detail: `no sé cómo probar «${provider}»` };
  }
}
