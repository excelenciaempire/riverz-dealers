/**
 * Voice AI — compatibilidad entre proveedores al cambiar de modelo.
 *
 * Cambiar una capa del stack (STT · LLM · TTS · S2S) en `/admin/voz` no es sólo
 * cambiar un nombre: cada proveedor tiene SU forma de nombrar modelos y voces,
 * SU endpoint y SU api key. Lo que sobrevive del proveedor anterior es lo que
 * rompe la llamada, y rompe callado — la llamada se conecta y nadie habla:
 *
 *  - la voz vieja (un voice_id de ElevenLabs no existe en Fish ni en Gemini),
 *  - el modelo viejo (`s2.1-pro` no significa nada para ElevenLabs),
 *  - el `base_url` viejo (apuntaba a un endpoint en Modal que ya no sirve),
 *  - la api key vieja (la de Cartesia contra Fish = 401).
 *
 * Acá vive UNA sola definición de qué es coherente, y se aplica en los dos
 * momentos que importan: al GUARDAR (limpia lo que quedó del proveedor
 * anterior) y al LEER (sana filas que ya estaban torcidas). El worker tiene su
 * propia red de seguridad en runtime; esto evita que llegue a necesitarla.
 */
import {
  LAYER_PROVIDERS,
  providerOption,
  type ProviderOption,
} from './providers';
import type { VoiceModelConfig } from './model-config';

export type VoiceLayer = keyof typeof LAYER_PROVIDERS;

/** Un ajuste automático, para poder contárselo al admin. */
export interface CompatChange {
  layer: VoiceLayer;
  /** Qué campo se tocó. */
  field: 'model' | 'voice' | 'base_url' | 'api_key';
  from: string | null;
  to: string | null;
}

/** ¿El modelo pertenece al catálogo de este proveedor? */
export function isKnownModel(layer: VoiceLayer, providerId: string, model: string): boolean {
  const opt = providerOption(layer, providerId);
  if (!opt) return true; // proveedor custom → no opinamos
  if (opt.freeModel) return true; // el modelo lo dicta el endpoint
  return opt.models.some((m) => m.id === model);
}

/** Modelo al que caer cuando el guardado no es de este proveedor. */
export function defaultModelFor(layer: VoiceLayer, providerId: string): string {
  return providerOption(layer, providerId)?.models[0]?.id ?? '';
}

/** ¿La voz pertenece a este proveedor? */
export function isValidVoice(opt: ProviderOption | undefined, voice: string): boolean {
  if (!opt) return true;
  if (opt.voiceInModel) return false; // la voz va en el modelo → el campo no aplica
  if (opt.voiceIds) return opt.voiceIds.includes(voice);
  if (opt.voiceShape) return opt.voiceShape.test(voice);
  return true;
}

/**
 * Voz efectiva para una llamada: la del agente si sirve para el proveedor
 * activo, si no la default de la plataforma, si no la del catálogo, si no nada
 * (que el proveedor use la suya). Cambiar el TTS global nunca deja mudo a un
 * agente que ya había elegido voz.
 */
export function resolveVoiceId(
  layer: VoiceLayer,
  providerId: string | null | undefined,
  ...candidates: (string | null | undefined)[]
): string | null {
  const opt = providerOption(layer, providerId);
  for (const c of candidates) {
    const v = c?.trim();
    if (v && isValidVoice(opt, v)) return v;
  }
  return opt?.defaultVoice ?? null;
}

/**
 * ¿Este `base_url` guardado sigue teniendo sentido para el proveedor activo?
 * Sólo es válido si es el del propio catálogo del proveedor, o si el proveedor
 * es de los que EXISTEN para apuntar a un endpoint propio (custom). Un base_url
 * heredado de otro proveedor manda el tráfico al lugar equivocado.
 */
export function isUsableBaseUrl(
  layer: VoiceLayer,
  providerId: string | null | undefined,
  baseUrl: string | null | undefined,
): boolean {
  const url = baseUrl?.trim();
  if (!url) return true;
  const opt = providerOption(layer, providerId);
  if (!opt) return true; // proveedor custom → su endpoint es todo lo que tiene
  if (opt.freeModel) return true; // openai_compatible → el endpoint es el punto
  return !!opt.baseUrl && opt.baseUrl.replace(/\/+$/, '') === url.replace(/\/+$/, '');
}

interface LayerFields {
  provider: keyof VoiceModelConfig;
  model: keyof VoiceModelConfig;
  baseUrl: keyof VoiceModelConfig;
  voice?: keyof VoiceModelConfig;
}

/** Dónde vive cada capa dentro de la fila de config. */
export const LAYER_FIELDS: Record<VoiceLayer, LayerFields> = {
  stt: { provider: 'stt_provider', model: 'stt_model', baseUrl: 'stt_base_url' },
  llm: { provider: 'llm_provider', model: 'llm_model', baseUrl: 'llm_base_url' },
  tts: {
    provider: 'tts_provider',
    model: 'tts_model',
    baseUrl: 'tts_base_url',
    voice: 'tts_default_voice_id',
  },
  realtime: {
    provider: 'realtime_provider',
    model: 'realtime_model',
    baseUrl: 'realtime_base_url',
    // El modo realtime reusa el mismo campo de voz por defecto que el TTS.
    voice: 'tts_default_voice_id',
  },
};

/** La columna cifrada de la api key de cada capa. */
export const LAYER_KEY_COLUMN: Record<VoiceLayer, string> = {
  stt: 'stt_api_key_encrypted',
  llm: 'llm_api_key_encrypted',
  tts: 'tts_api_key_encrypted',
  realtime: 'realtime_api_key_encrypted',
};

/**
 * Deja el stack coherente consigo mismo: cada capa con un modelo, una voz y un
 * endpoint que su proveedor entienda. NO toca api keys (no las ve) ni inventa
 * proveedores: un proveedor fuera del catálogo se respeta tal cual.
 */
export function normalizeStack<T extends Partial<VoiceModelConfig>>(
  config: T,
): { config: T; changes: CompatChange[] } {
  const out = { ...config };
  const changes: CompatChange[] = [];

  for (const layer of Object.keys(LAYER_FIELDS) as VoiceLayer[]) {
    const f = LAYER_FIELDS[layer];
    const provider = (out[f.provider] as string | null) ?? '';
    // Sin proveedor (realtime apagado) o fuera del catálogo → no opinamos.
    if (!provider || !providerOption(layer, provider)) continue;

    const model = (out[f.model] as string | null) ?? '';
    if (!isKnownModel(layer, provider, model)) {
      const to = defaultModelFor(layer, provider);
      (out as Record<string, unknown>)[f.model] = to;
      changes.push({ layer, field: 'model', from: model || null, to });
    }

    const baseUrl = (out[f.baseUrl] as string | null) ?? null;
    if (!isUsableBaseUrl(layer, provider, baseUrl)) {
      (out as Record<string, unknown>)[f.baseUrl] = null;
      changes.push({ layer, field: 'base_url', from: baseUrl, to: null });
    }

    // La voz sólo se corrige en la capa que la manda: en modo pipeline el TTS,
    // en modo realtime el motor S2S. Si no, las dos capas pelean por el mismo
    // campo y una le pisa el valor a la otra.
    const voiceOwner = out.mode === 'realtime' ? 'realtime' : 'tts';
    if (f.voice && layer === voiceOwner) {
      const voice = (out[f.voice] as string | null) ?? null;
      const opt = providerOption(layer, provider);
      if (voice && !isValidVoice(opt, voice)) {
        const to = opt?.defaultVoice ?? null;
        (out as Record<string, unknown>)[f.voice] = to;
        changes.push({ layer, field: 'voice', from: voice, to });
      }
    }
  }

  return { config: out, changes };
}

/**
 * Qué hay que limpiar cuando una capa CAMBIA de proveedor: el endpoint y la api
 * key del anterior no sirven para el nuevo, y dejarlos puestos es peor que no
 * tener nada (un 401 en medio de la llamada en vez de usar la key del entorno).
 * Devuelve las columnas a poner en null, salvo las que el propio request ya
 * está seteando a propósito.
 */
export function staleFieldsOnProviderChange(
  layer: VoiceLayer,
  previousProvider: string | null | undefined,
  nextProvider: string | null | undefined,
  explicitlySet: { baseUrl: boolean; apiKey: boolean },
): { columns: string[]; changes: CompatChange[] } {
  const prev = (previousProvider ?? '').trim();
  const next = (nextProvider ?? '').trim();
  if (!prev || !next || prev === next) return { columns: [], changes: [] };

  const columns: string[] = [];
  const changes: CompatChange[] = [];
  if (!explicitlySet.baseUrl) {
    columns.push(LAYER_FIELDS[layer].baseUrl as string);
    changes.push({ layer, field: 'base_url', from: prev, to: null });
  }
  if (!explicitlySet.apiKey) {
    columns.push(LAYER_KEY_COLUMN[layer]);
    changes.push({ layer, field: 'api_key', from: prev, to: null });
  }
  return { columns, changes };
}

/** Texto corto por cambio, para mostrarle al admin qué se ajustó solo. */
export function describeChange(c: CompatChange, locale: 'es' | 'en'): string {
  const layer = c.layer.toUpperCase();
  const field: Record<CompatChange['field'], { es: string; en: string }> = {
    model: { es: 'modelo', en: 'model' },
    voice: { es: 'voz', en: 'voice' },
    base_url: { es: 'endpoint', en: 'endpoint' },
    api_key: { es: 'API key', en: 'API key' },
  };
  const what = field[c.field][locale];
  if (c.to) return `${layer}: ${what} → ${c.to}`;
  return locale === 'es'
    ? `${layer}: se limpió ${what} del proveedor anterior`
    : `${layer}: cleared the previous provider's ${what}`;
}
