/**
 * Voice AI — catálogo de proveedores/modelos por capa (STT · LLM · TTS · S2S).
 *
 * Fuente única para los selectores del admin (`/admin/voz`). El worker
 * (`voice-pipecat/bot.py`) instancia el proveedor elegido por su `id`. Mantené
 * los `id` en sync con las fábricas del worker (_build_stt/_llm/_tts + realtime).
 *
 * Los nombres son técnicos (marcas) → no se traducen. Cada opción puede fijar
 * modelos sugeridos; el admin igual permite escribir un modelo/voz custom.
 */

export interface ModelOption {
  id: string;
  label: string;
}

export interface ProviderOption {
  id: string;
  label: string;
  models: ModelOption[];
  /** Pista para el campo de voz (voice_id) donde aplica (TTS/S2S). */
  voiceHint?: string;
  /** Nota corta para el admin (ej. idioma, latencia). */
  note?: string;
}

/** Voz → texto. */
export const STT_PROVIDERS: ProviderOption[] = [
  {
    id: 'deepgram',
    label: 'Deepgram',
    models: [
      { id: 'nova-3', label: 'Nova-3 (multi-idioma)' },
      { id: 'nova-2', label: 'Nova-2' },
    ],
    note: 'Rápido, multi-idioma. Recomendado.',
  },
  {
    id: 'openai',
    label: 'OpenAI',
    models: [
      { id: 'gpt-4o-transcribe', label: 'gpt-4o-transcribe' },
      { id: 'gpt-4o-mini-transcribe', label: 'gpt-4o-mini-transcribe' },
      { id: 'whisper-1', label: 'Whisper' },
    ],
  },
  {
    id: 'groq',
    label: 'Groq (Whisper)',
    models: [
      { id: 'whisper-large-v3-turbo', label: 'whisper-large-v3-turbo' },
      { id: 'whisper-large-v3', label: 'whisper-large-v3' },
    ],
    note: 'Whisper muy rápido y barato.',
  },
  {
    id: 'assemblyai',
    label: 'AssemblyAI',
    models: [{ id: 'best', label: 'best' }],
  },
  {
    id: 'gladia',
    label: 'Gladia',
    models: [{ id: 'solaria-1', label: 'solaria-1' }],
  },
];

/** Cerebro. */
export const LLM_PROVIDERS: ProviderOption[] = [
  {
    id: 'anthropic',
    label: 'Anthropic (Claude)',
    models: [
      { id: 'claude-opus-4-8', label: 'Claude Opus 4.8 (máxima calidad)' },
      { id: 'claude-sonnet-4-5', label: 'Claude Sonnet 4.5' },
      { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5 (rápido)' },
    ],
    note: 'Mejor razonamiento de ventas.',
  },
  {
    id: 'openai',
    label: 'OpenAI (GPT)',
    models: [
      { id: 'gpt-4o', label: 'GPT-4o' },
      { id: 'gpt-4o-mini', label: 'GPT-4o mini (rápido)' },
      { id: 'gpt-4.1', label: 'GPT-4.1' },
    ],
  },
  {
    id: 'gemini',
    label: 'Google (Gemini)',
    models: [
      { id: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash' },
      { id: 'gemini-1.5-pro', label: 'Gemini 1.5 Pro' },
    ],
  },
  {
    id: 'groq',
    label: 'Groq (Llama)',
    models: [
      { id: 'llama-3.3-70b-versatile', label: 'Llama 3.3 70B' },
      { id: 'llama-3.1-8b-instant', label: 'Llama 3.1 8B (ultra-rápido)' },
    ],
    note: 'La más rápida y barata.',
  },
  {
    id: 'openai_compatible',
    label: 'OpenAI-compatible (custom)',
    models: [{ id: '', label: 'Escribir modelo…' }],
    note: 'Cualquier endpoint OpenAI-compatible (base_url + key).',
  },
];

/** Texto → voz. */
export const TTS_PROVIDERS: ProviderOption[] = [
  {
    id: 'elevenlabs',
    label: 'ElevenLabs',
    models: [
      { id: 'eleven_flash_v2_5', label: 'Flash v2.5 (baja latencia)' },
      { id: 'eleven_turbo_v2_5', label: 'Turbo v2.5' },
      { id: 'eleven_multilingual_v2', label: 'Multilingual v2 (calidad)' },
      { id: 'eleven_v3', label: 'v3' },
    ],
    voiceHint: 'voice_id de ElevenLabs (ej. XrExE9yKIg1WjnnlVkGX)',
    note: 'Estándar de calidad, 32 idiomas.',
  },
  {
    id: 'cartesia',
    label: 'Cartesia (Sonic)',
    models: [
      { id: 'sonic-2', label: 'Sonic 2' },
      { id: 'sonic', label: 'Sonic' },
    ],
    voiceHint: 'voice_id de Cartesia (UUID)',
    note: 'La más rápida (~40-90ms), muy natural.',
  },
  {
    id: 'rime',
    label: 'Rime',
    models: [
      { id: 'mistv2', label: 'mistv2' },
      { id: 'arcana', label: 'arcana' },
    ],
    voiceHint: 'nombre de voz Rime (ej. "cove")',
    note: 'Conversacional, ideal ventas.',
  },
  {
    id: 'playht',
    label: 'PlayHT',
    models: [
      { id: 'Play3.0-mini', label: 'Play 3.0 mini' },
      { id: 'PlayHT2.0-turbo', label: 'PlayHT 2.0 turbo' },
    ],
    voiceHint: 'voice URL/id de PlayHT',
  },
  {
    id: 'deepgram',
    label: 'Deepgram (Aura)',
    models: [{ id: 'aura-2-thalia-en', label: 'Aura 2' }],
    voiceHint: 'modelo de voz Aura (ej. aura-2-celeste-es)',
    note: 'Mismo proveedor que el STT.',
  },
  {
    id: 'openai',
    label: 'OpenAI',
    models: [
      { id: 'gpt-4o-mini-tts', label: 'gpt-4o-mini-tts' },
      { id: 'tts-1-hd', label: 'tts-1-hd' },
      { id: 'tts-1', label: 'tts-1' },
    ],
    voiceHint: 'voz OpenAI (alloy, nova, shimmer…)',
  },
  {
    id: 'gemini',
    label: 'Google (Gemini TTS)',
    models: [{ id: 'gemini-2.5-flash-preview-tts', label: 'Gemini 2.5 Flash TTS' }],
    voiceHint: 'voz Gemini (ej. Kore, Puck)',
  },
  {
    id: 'hume',
    label: 'Hume (Octave)',
    models: [{ id: 'octave', label: 'Octave (expresivo)' }],
    voiceHint: 'voz/description Hume',
  },
];

/** Motores full-duplex speech-to-speech (modo realtime). */
export const REALTIME_PROVIDERS: ProviderOption[] = [
  {
    id: 'openai_realtime',
    label: 'OpenAI Realtime',
    models: [
      { id: 'gpt-realtime', label: 'gpt-realtime' },
      { id: 'gpt-4o-realtime-preview', label: 'gpt-4o-realtime-preview' },
    ],
    voiceHint: 'voz (alloy, marin, cedar…)',
    note: 'S2S natural, cualquier idioma. El más humano.',
  },
  {
    id: 'gemini_live',
    label: 'Google (Gemini Live)',
    models: [
      { id: 'gemini-2.0-flash-live-001', label: 'Gemini 2.0 Flash Live' },
      { id: 'gemini-2.0-flash-exp', label: 'Gemini 2.0 Flash (exp)' },
    ],
    voiceHint: 'voz Gemini (Puck, Charon, Kore…)',
    note: 'S2S natural, multi-idioma.',
  },
  {
    id: 'aws_nova_sonic',
    label: 'Amazon Nova Sonic',
    models: [{ id: 'amazon.nova-sonic-v1:0', label: 'Nova Sonic v1' }],
    voiceHint: 'voz (matthew, tiffany, amy…)',
    note: 'S2S de AWS. Requiere credenciales Bedrock.',
  },
  {
    id: 'personaplex',
    label: 'PersonaPlex (Modal)',
    models: [{ id: 'personaplex-7b', label: 'PersonaPlex 7B' }],
    voiceHint: 'voz PP (NATF2, NATM1…)',
    note: 'Full-duplex self-host. Solo inglés, experimental.',
  },
];

export const LAYER_PROVIDERS = {
  stt: STT_PROVIDERS,
  llm: LLM_PROVIDERS,
  tts: TTS_PROVIDERS,
  realtime: REALTIME_PROVIDERS,
} as const;

/** Modelos de una capa+proveedor (para poblar el segundo selector). */
export function modelsFor(
  layer: keyof typeof LAYER_PROVIDERS,
  providerId: string | null | undefined,
): ModelOption[] {
  const p = LAYER_PROVIDERS[layer].find((x) => x.id === providerId);
  return p?.models ?? [];
}

export function providerOption(
  layer: keyof typeof LAYER_PROVIDERS,
  providerId: string | null | undefined,
): ProviderOption | undefined {
  return LAYER_PROVIDERS[layer].find((x) => x.id === providerId);
}
