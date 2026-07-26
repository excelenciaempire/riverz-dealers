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
  /**
   * Endpoint OpenAI-compatible por defecto (punto A: modelos abiertos servidos
   * por terceros, pago-por-uso, $0 ocioso). El worker lo usa si no hay base_url
   * explícito. Solo aplica a proveedores tipo OpenAI-compatible.
   */
  baseUrl?: string;
  /** Marca la opción recomendada para ecommerce (barata + buena). */
  recommended?: boolean;
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
    id: 'gemini',
    label: 'Google (Gemini)',
    models: [
      { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash (recomendado ecommerce)' },
      { id: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash' },
      { id: 'gemini-1.5-pro', label: 'Gemini 1.5 Pro' },
    ],
    note: 'Inteligente + barato + baja latencia + buen tool-calling. Ideal.',
    recommended: true,
  },
  {
    id: 'groq',
    label: 'Groq (Llama/abiertos)',
    models: [
      { id: 'llama-3.3-70b-versatile', label: 'Llama 3.3 70B (rápido + capaz)' },
      { id: 'llama-3.1-8b-instant', label: 'Llama 3.1 8B (ultra-rápido/barato)' },
    ],
    note: 'La menor latencia (500+ tok/s). 70B para ventas, 8B para lo simple.',
    recommended: true,
  },
  {
    id: 'anthropic',
    label: 'Anthropic (Claude)',
    models: [
      { id: 'claude-opus-4-8', label: 'Claude Opus 4.8 (máxima calidad)' },
      { id: 'claude-sonnet-4-5', label: 'Claude Sonnet 4.5' },
      { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5 (rápido)' },
    ],
    note: 'Mejor razonamiento de ventas (tier premium).',
  },
  {
    id: 'openai',
    label: 'OpenAI (GPT)',
    models: [
      { id: 'gpt-4o-mini', label: 'GPT-4o mini (rápido/barato)' },
      { id: 'gpt-4o', label: 'GPT-4o' },
      { id: 'gpt-4.1', label: 'GPT-4.1' },
    ],
  },
  // ── Punto A: modelos ABIERTOS servidos por terceros, pago-por-uso, $0 ocioso.
  // Todos hablan API OpenAI-compatible → el worker usa OpenAILLMService + baseUrl.
  {
    id: 'deepinfra',
    label: 'DeepInfra (abiertos)',
    models: [
      { id: 'Qwen/Qwen3-72B-Instruct', label: 'Qwen3 72B' },
      { id: 'meta-llama/Llama-3.3-70B-Instruct', label: 'Llama 3.3 70B' },
      { id: 'deepseek-ai/DeepSeek-V3', label: 'DeepSeek V3' },
    ],
    baseUrl: 'https://api.deepinfra.com/v1/openai',
    note: 'Qwen/Llama/DeepSeek pago-por-uso, muy barato, $0 ocioso.',
  },
  {
    id: 'together',
    label: 'Together AI (abiertos)',
    models: [
      { id: 'Qwen/Qwen3-72B-Instruct', label: 'Qwen3 72B' },
      { id: 'meta-llama/Llama-3.3-70B-Instruct-Turbo', label: 'Llama 3.3 70B Turbo' },
    ],
    baseUrl: 'https://api.together.xyz/v1',
    note: 'Modelos abiertos pago-por-uso.',
  },
  {
    id: 'fireworks',
    label: 'Fireworks (abiertos)',
    models: [
      { id: 'accounts/fireworks/models/qwen3-72b-instruct', label: 'Qwen3 72B' },
      { id: 'accounts/fireworks/models/llama-v3p3-70b-instruct', label: 'Llama 3.3 70B' },
    ],
    baseUrl: 'https://api.fireworks.ai/inference/v1',
    note: 'Modelos abiertos pago-por-uso, baja latencia.',
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    models: [
      { id: 'deepseek-chat', label: 'DeepSeek V3 (chat)' },
    ],
    baseUrl: 'https://api.deepseek.com',
    note: 'Muy barato y competente.',
  },
  {
    id: 'openai_compatible',
    label: 'OpenAI-compatible (custom)',
    models: [{ id: '', label: 'Escribir modelo…' }],
    note: 'Cualquier endpoint OpenAI-compatible (base_url + key). Ej. Qwen self-host en vLLM.',
  },
];

/** Texto → voz. (La capa que más pesa en el costo.) */
export const TTS_PROVIDERS: ProviderOption[] = [
  {
    id: 'cartesia',
    label: 'Cartesia (Sonic)',
    models: [
      { id: 'sonic-2', label: 'Sonic 2' },
      { id: 'sonic', label: 'Sonic' },
    ],
    voiceHint: 'voice_id de Cartesia (UUID)',
    note: 'La más rápida (~40-90ms), muy natural. ~$0.03/min. Recomendada.',
    recommended: true,
  },
  {
    id: 'deepgram',
    label: 'Deepgram (Aura-2)',
    models: [
      { id: 'aura-2-celeste-es', label: 'Aura-2 Celeste (español)' },
      { id: 'aura-2-thalia-en', label: 'Aura-2 Thalia (inglés)' },
    ],
    voiceHint: 'modelo de voz Aura (ej. aura-2-celeste-es)',
    note: 'La más barata buena (~$0.015-0.02/min). Mismo proveedor que el STT.',
    recommended: true,
  },
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
    note: 'Máxima calidad, 32 idiomas, pero la más cara (~$0.10/min). Tier premium.',
  },
  {
    id: 'hume',
    label: 'Hume (Octave)',
    models: [{ id: 'octave', label: 'Octave (expresivo)' }],
    voiceHint: 'voz/description Hume',
    note: 'Muy barato (~$7.6/1M chars), expresivo.',
  },
  {
    id: 'rime',
    label: 'Rime',
    models: [
      { id: 'mistv2', label: 'mistv2' },
      { id: 'arcana', label: 'arcana' },
    ],
    voiceHint: 'nombre de voz Rime (ej. "cove")',
    note: 'Conversacional, baja latencia.',
  },
  {
    id: 'openai',
    label: 'OpenAI',
    models: [
      { id: 'gpt-4o-mini-tts', label: 'gpt-4o-mini-tts' },
      { id: 'tts-1-hd', label: 'tts-1-hd' },
      { id: 'tts-1', label: 'tts-1 (barato)' },
    ],
    voiceHint: 'voz OpenAI (alloy, nova, shimmer…)',
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
    id: 'gemini',
    label: 'Google (Gemini TTS)',
    models: [{ id: 'gemini-2.5-flash-preview-tts', label: 'Gemini 2.5 Flash TTS' }],
    voiceHint: 'voz Gemini (ej. Kore, Puck)',
  },
];

/**
 * Combos recomendados para ecommerce (confirmar pedidos + servicio al cliente),
 * ordenados por costo. Todos: multi-idioma, tools (cierran pedidos), baja
 * latencia, $0 ocioso. Costos aprox. por minuto de llamada, todo incluido
 * (Telnyx + STT + LLM + TTS). Ver también src/lib/voice/README de costos.
 */
export const RECOMMENDED_COMBOS = [
  {
    id: 'economico',
    label: 'Económico',
    stt: 'deepgram',
    llm: 'gemini',
    tts: 'deepgram',
    approxPerMin: '~$0.05/min',
    note: 'Deepgram + Gemini 2.5 Flash + Aura-2. El mejor costo/calidad.',
  },
  {
    id: 'natural',
    label: 'Voz más natural',
    stt: 'deepgram',
    llm: 'gemini',
    tts: 'cartesia',
    approxPerMin: '~$0.055/min',
    note: 'Deepgram + Gemini 2.5 Flash + Cartesia Sonic (voz premium, baja latencia).',
  },
  {
    id: 'premium',
    label: 'Premium ventas',
    stt: 'deepgram',
    llm: 'anthropic',
    tts: 'elevenlabs',
    approxPerMin: '~$0.20/min',
    note: 'Deepgram + Claude Sonnet + ElevenLabs. Máximo razonamiento y voz.',
  },
] as const;

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
