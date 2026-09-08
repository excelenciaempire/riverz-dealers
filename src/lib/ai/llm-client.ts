import { costForModel, rateFor } from '@/lib/admin/cost';
import type { BillingContext } from '@/lib/wallet/operacion';
import { cancelar, liquidar, reservar } from '@/lib/wallet/operacion';
import Anthropic from '@anthropic-ai/sdk';
import { getAnthropic } from './anthropic-client';
import { esfuerzo } from './esfuerzo';

/**
 * Provider-agnostic text completion for the Instagram brain.
 *
 * Anthropic is the primary brain. When it's unavailable — credits exhausted
 * (the exact failure that took the whole Instagram feature down), an auth/rate
 * error, or an outage — we fall back to any configured OpenAI-compatible
 * provider (Groq, OpenRouter, Gemini) so plan generation, lead scoring and DM
 * writing keep working instead of going mute. Mirrors the multi-provider
 * pattern already used for audio transcription (`transcribe.ts`).
 *
 * Every Instagram-agent LLM call is plain text-in / text-out (no tool use), so
 * a single `completeText()` surface covers them all. Set at least one fallback
 * key in the environment (GROQ_API_KEY / OPENROUTER_API_KEY / GEMINI_API_KEY)
 * for the safety net to engage; with none set, behaviour is identical to before
 * (Anthropic only). Model ids per fallback are overridable via env
 * (e.g. GROQ_MODEL_PREMIUM) so a provider renaming a model never needs a deploy.
 */

export type LlmTier = 'triage' | 'premium';

/** Anthropic models per tier (triage = fast/cheap, premium = top quality). */
const ANTHROPIC_MODELS: Record<LlmTier, string> = {
  triage: 'claude-haiku-4-5-20251001',
  premium: 'claude-opus-4-8',
};

interface OpenAICompatProvider {
  name: string;
  baseUrl: string;
  apiKey: string;
  model: Record<LlmTier, string>;
}

/** OpenAI-compatible fallbacks, in priority order, from whatever env keys exist. */
function fallbackProviders(): OpenAICompatProvider[] {
  const env = process.env;
  const out: OpenAICompatProvider[] = [];
  if (env.GROQ_API_KEY) {
    out.push({
      name: 'groq',
      baseUrl: 'https://api.groq.com/openai/v1',
      apiKey: env.GROQ_API_KEY,
      model: {
        premium: env.GROQ_MODEL_PREMIUM ?? 'llama-3.3-70b-versatile',
        triage: env.GROQ_MODEL_TRIAGE ?? 'llama-3.1-8b-instant',
      },
    });
  }
  if (env.OPENROUTER_API_KEY) {
    out.push({
      name: 'openrouter',
      baseUrl: 'https://openrouter.ai/api/v1',
      apiKey: env.OPENROUTER_API_KEY,
      model: {
        premium: env.OPENROUTER_MODEL_PREMIUM ?? 'google/gemini-2.0-flash-001',
        triage: env.OPENROUTER_MODEL_TRIAGE ?? 'google/gemini-2.0-flash-001',
      },
    });
  }
  if (env.GEMINI_API_KEY) {
    out.push({
      name: 'gemini',
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
      apiKey: env.GEMINI_API_KEY,
      model: {
        premium: env.GEMINI_MODEL_PREMIUM ?? 'gemini-2.0-flash',
        triage: env.GEMINI_MODEL_TRIAGE ?? 'gemini-2.0-flash',
      },
    });
  }
  return out;
}

/** True if ANY provider (Anthropic primary or a fallback) is configured. */
export function hasLlm(anthropicKey?: string | null): boolean {
  return Boolean(anthropicKey) || fallbackProviders().length > 0;
}

/**
 * Lo que devuelve una llamada al modelo: el texto Y lo que se gastó.
 *
 * Los tokens de caché NO vienen dentro de `prompt`: son campos aparte y se
 * pagan a otro precio (leer, una décima; escribir, un 25% más). Sumarlos al
 * prompt cobraría de más al que lee de caché y de menos al que la escribe.
 */
export interface Completado {
  text: string;
  /** 'anthropic', 'groq', … — quién atendió de verdad. */
  proveedor: string;
  modelo: string;
  uso: {
    prompt: number;
    salida: number;
    cacheLeida: number;
    cacheEscrita: number;
  };
}

export interface CompleteTextOptions {
  billing: BillingContext;
  tier: LlmTier;
  system: string;
  user: string;
  maxTokens: number;
  /** Primary Anthropic key (per-agent or workspace). Null → skip to fallbacks. */
  anthropicKey?: string | null;
  /** Anthropic effort hint (ignored by OpenAI-compatible fallbacks). */
  effort?: 'low' | 'medium' | 'high';
}

async function completeAnthropic(
  key: string,
  o: CompleteTextOptions
): Promise<Completado> {
  const client = getAnthropic(key, o.billing);
  const model = ANTHROPIC_MODELS[o.tier];
  const res = await client.messages.create({
    model,
    max_tokens: o.maxTokens,
    // El escalón `triage` es Haiku, que los rechaza con 400.
    ...esfuerzo(model, { effort: o.effort ?? 'low' }),
    system: [
      { type: 'text', text: o.system, cache_control: { type: 'ephemeral' } },
    ],
    messages: [{ role: 'user', content: o.user }],
  });
  const u = res.usage;
  return {
    text: res.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('')
      .trim(),
    proveedor: 'anthropic',
    modelo: model,
    uso: {
      prompt: u?.input_tokens ?? 0,
      salida: u?.output_tokens ?? 0,
      cacheLeida: u?.cache_read_input_tokens ?? 0,
      cacheEscrita: u?.cache_creation_input_tokens ?? 0,
    },
  };
}

async function completeOpenAICompat(
  p: OpenAICompatProvider,
  o: CompleteTextOptions
): Promise<Completado> {
  const rate = rateFor(p.model[o.tier]);
  const id = await reservar(
    o.billing,
    p.name,
    ((Buffer.byteLength(o.system + o.user, 'utf8') + 256) * rate.input +
      o.maxTokens * rate.output) /
      1e6,
    { modelo: p.model[o.tier] }
  );
  const res = await fetch(`${p.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${p.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: p.model[o.tier],
      max_tokens: o.maxTokens,
      messages: [
        { role: 'system', content: o.system },
        { role: 'user', content: o.user },
      ],
    }),
    signal: AbortSignal.timeout(45_000),
  });
  if (!res.ok) {
    if ([400, 401, 403, 404, 422, 429].includes(res.status))
      await cancelar(o.billing, id);
    const detail = await res.text().catch(() => '');
    throw new Error(`${p.name} ${res.status}: ${detail.slice(0, 200)}`);
  }
  const json = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    usage?: {
      prompt_tokens?: number;
      completion_tokens?: number;
      cost?: number;
    };
  };
  if (!json.usage) throw new Error('wallet_missing_usage');
  await liquidar(
    o.billing,
    id,
    p.name,
    p.name === 'openrouter' && typeof json.usage.cost === 'number'
      ? json.usage.cost
      : costForModel(
          p.model[o.tier],
          json.usage.prompt_tokens ?? 0,
          json.usage.completion_tokens ?? 0
        ),
    { modelo: p.model[o.tier], usage: json.usage }
  );
  return {
    text: (json.choices?.[0]?.message?.content ?? '').trim(),
    proveedor: p.name,
    modelo: p.model[o.tier],
    uso: {
      prompt: json.usage?.prompt_tokens ?? 0,
      salida: json.usage?.completion_tokens ?? 0,
      cacheLeida: 0,
      cacheEscrita: 0,
    },
  };
}

export type ImageMediaType =
  | 'image/jpeg'
  | 'image/png'
  | 'image/gif'
  | 'image/webp';

/** Normalize an HTTP content-type to a media type the vision API accepts. */
export function toImageMediaType(contentType: string | null): ImageMediaType {
  const t = (contentType ?? '').toLowerCase();
  if (t.includes('png')) return 'image/png';
  if (t.includes('gif')) return 'image/gif';
  if (t.includes('webp')) return 'image/webp';
  return 'image/jpeg';
}

/**
 * One-shot vision description of a single image (Anthropic only — the fallback
 * providers aren't wired for vision). Used to derive a short, non-sensitive
 * interest hint from a contact's own profile picture. Requires an Anthropic
 * key; callers degrade gracefully (no hint) when it's absent or errors.
 */
export async function describeImage(o: {
  billing: BillingContext;
  base64: string;
  mediaType: ImageMediaType;
  system: string;
  user: string;
  maxTokens: number;
  anthropicKey: string;
}): Promise<Completado> {
  const client = getAnthropic(o.anthropicKey, o.billing);
  const res = await client.messages.create({
    model: ANTHROPIC_MODELS.triage,
    max_tokens: o.maxTokens,
    ...esfuerzo(ANTHROPIC_MODELS.triage),
    system: [{ type: 'text', text: o.system }],
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source: { type: 'base64', media_type: o.mediaType, data: o.base64 },
          },
          { type: 'text', text: o.user },
        ],
      },
    ],
  });
  const u = res.usage;
  return {
    text: res.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('')
      .trim(),
    proveedor: 'anthropic',
    modelo: ANTHROPIC_MODELS.triage,
    uso: {
      prompt: u?.input_tokens ?? 0,
      salida: u?.output_tokens ?? 0,
      cacheLeida: u?.cache_read_input_tokens ?? 0,
      cacheEscrita: u?.cache_creation_input_tokens ?? 0,
    },
  };
}

/**
 * Run a single text completion, trying Anthropic first then each configured
 * fallback in priority order. Throws only if EVERY provider fails (or none is
 * configured) — callers with their own graceful degrade (name-merge DM, empty
 * scores) should catch and use it.
 */
export async function completeText(o: CompleteTextOptions): Promise<string> {
  return (await completeTextConUso(o)).text;
}

/**
 * Lo mismo, pero diciendo QUÉ SE GASTÓ.
 *
 * Sin esto no hay forma de cobrarle al comercio lo que el proveedor le cobró a
 * Riverz: `completeText` devolvía sólo texto, así que todo lo que pasa por acá
 * —clasificar si hay que escalar, puntuar un lead, decidir si conviene abrir el
 * privado— tenía que caer a una tarifa de lista, que es un promedio y no el
 * gasto. Ahora sale el número exacto.
 */
export async function completeTextConUso(
  o: CompleteTextOptions
): Promise<Completado> {
  const errors: string[] = [];

  if (o.anthropicKey) {
    try {
      const r = await completeAnthropic(o.anthropicKey, o);
      if (r.text) return r;
      errors.push('anthropic: empty response');
    } catch (err) {
      errors.push(`anthropic: ${err instanceof Error ? err.message : 'error'}`);
    }
  }

  for (const p of fallbackProviders()) {
    try {
      const r = await completeOpenAICompat(p, o);
      if (r.text) {
        if (errors.length) {
          console.warn(
            `[llm] Anthropic unavailable, served by ${p.name}. (${errors.join(' | ')})`
          );
        }
        return r;
      }
      errors.push(`${p.name}: empty response`);
    } catch (err) {
      errors.push(`${p.name}: ${err instanceof Error ? err.message : 'error'}`);
    }
  }

  throw new Error(
    `No LLM provider available. ${errors.join(' | ') || 'no keys configured'}`
  );
}
