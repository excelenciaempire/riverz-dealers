/**
 * Voice AI — catálogo de proveedores/modelos por capa (STT · LLM · TTS · S2S).
 *
 * Fuente única para los selectores del admin (`/admin/voz`). El worker de
 * producción (`voice-worker/agent.py`, LiveKit) instancia el proveedor elegido:
 * los OpenAI-compatibles (Groq/Gemini/Cerebras/OpenAI/DeepInfra/…) van por
 * `base_url`; Anthropic es nativo. Mantené los `id`/`baseUrl` en sync con
 * `_make_stt/_make_llm/_make_tts` del worker.
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
    baseUrl: 'https://api.openai.com/v1',
  },
  {
    id: 'groq',
    label: 'Groq (Whisper)',
    models: [
      { id: 'whisper-large-v3-turbo', label: 'whisper-large-v3-turbo' },
      { id: 'whisper-large-v3', label: 'whisper-large-v3' },
    ],
    baseUrl: 'https://api.groq.com/openai/v1',
    note: 'Whisper muy rápido y barato.',
  },
  {
    id: 'openai_compatible',
    label: 'OpenAI-compatible (custom)',
    models: [{ id: 'whisper-1', label: 'Escribir modelo…' }],
    note: 'Cualquier endpoint STT OpenAI-compatible (base_url + key). Ej. Whisper self-host.',
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
    // Endpoint OpenAI-compatible de Google → el worker lo trata igual que Groq.
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai/',
    note: 'Inteligente + barato + baja latencia + buen tool-calling. Ideal.',
    recommended: true,
  },
  {
    id: 'groq',
    label: 'Groq (Llama/abiertos)',
    models: [
      { id: 'llama-3.3-70b-versatile', label: 'Llama 3.3 70B (rápido + capaz)' },
      { id: 'llama-3.1-8b-instant', label: 'Llama 3.1 8B (ultra-rápido/barato)' },
      { id: 'openai/gpt-oss-120b', label: 'GPT-OSS 120B' },
    ],
    baseUrl: 'https://api.groq.com/openai/v1',
    note: 'La menor latencia (500+ tok/s). Tier gratis ~12k tok/min (justo para demos); Dev Tier para producción.',
    recommended: true,
  },
  {
    id: 'cerebras',
    label: 'Cerebras (ultra-rápido)',
    models: [
      { id: 'gpt-oss-120b', label: 'GPT-OSS 120B (el más capaz)' },
      { id: 'zai-glm-4.7', label: 'GLM 4.7' },
      { id: 'gemma-4-31b', label: 'Gemma 4 31B' },
    ],
    baseUrl: 'https://api.cerebras.ai/v1',
    note: 'La inferencia más rápida del mercado (~2-3x Groq). Requiere saldo/billing.',
  },
  {
    id: 'anthropic',
    label: 'Anthropic (Claude)',
    models: [
      { id: 'claude-opus-4-8', label: 'Claude Opus 4.8 (máxima calidad)' },
      { id: 'claude-sonnet-4-5', label: 'Claude Sonnet 4.5' },
      { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5 (rápido)' },
    ],
    note: 'Mejor razonamiento de ventas y español. Nativo (no usa base_url).',
  },
  {
    id: 'openai',
    label: 'OpenAI (GPT)',
    models: [
      { id: 'gpt-4o-mini', label: 'GPT-4o mini (rápido/barato)' },
      { id: 'gpt-4o', label: 'GPT-4o' },
      { id: 'gpt-4.1', label: 'GPT-4.1' },
    ],
    baseUrl: 'https://api.openai.com/v1',
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
    id: 'fish',
    label: 'Fish Audio',
    models: [
      { id: 's2.1-pro', label: 'S2.1 Pro (recomendado)' },
      { id: 's2.1-pro-free', label: 'S2.1 Pro Free ($0, sin garantías)' },
      { id: 's2-pro', label: 'S2 Pro' },
      { id: 's1', label: 'S1' },
    ],
    voiceHint: 'reference_id de Fish Audio (32 hex, ej. 933563129e564b19a115bedd57b7406a)',
    note: '83 idiomas, ~100ms al primer audio y clonación de voz. S2.1 Pro Free sirve para probar sin costo.',
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
    id: 'openai',
    label: 'OpenAI',
    models: [
      { id: 'gpt-4o-mini-tts', label: 'gpt-4o-mini-tts' },
      { id: 'tts-1-hd', label: 'tts-1-hd' },
      { id: 'tts-1', label: 'tts-1 (barato)' },
    ],
    voiceHint: 'voz OpenAI (alloy, nova, shimmer…)',
    baseUrl: 'https://api.openai.com/v1',
  },
  {
    id: 'gemini',
    label: 'Google (Gemini TTS)',
    models: [{ id: 'gemini-2.5-flash-preview-tts', label: 'Gemini 2.5 Flash TTS' }],
    voiceHint: 'voz Gemini (ej. Kore, Puck)',
  },
  {
    id: 'openai_compatible',
    label: 'OpenAI-compatible (custom)',
    models: [{ id: 'tts-1', label: 'Escribir modelo…' }],
    voiceHint: 'voz del endpoint',
    note: 'Cualquier TTS OpenAI-compatible (base_url + key). Ej. VoxCPM self-host.',
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

/**
 * Motores full-duplex speech-to-speech (modo realtime). El bot escucha y habla a
 * la vez → latencia casi nula, lo más humano. Trade-off vs. pipeline: usás la voz
 * del modelo (no Celeste) y suele costar más por minuto.
 */
export const REALTIME_PROVIDERS: ProviderOption[] = [
  {
    id: 'gemini_live',
    label: 'Google (Gemini Live)',
    models: [
      { id: 'gemini-2.0-flash-live-001', label: 'Gemini 2.0 Flash Live' },
      { id: 'gemini-2.5-flash-preview-native-audio-dialog', label: 'Gemini 2.5 Flash (audio nativo)' },
    ],
    voiceHint: 'voz Gemini (Puck, Charon, Kore…)',
    note: 'S2S hosteado, multi-idioma (habla español). Barato + rápido. Recomendado.',
    recommended: true,
  },
  {
    id: 'openai_realtime',
    label: 'OpenAI Realtime',
    models: [
      { id: 'gpt-realtime', label: 'gpt-realtime' },
      { id: 'gpt-4o-realtime-preview', label: 'gpt-4o-realtime-preview' },
    ],
    voiceHint: 'voz (alloy, marin, cedar…)',
    note: 'S2S hosteado, cualquier idioma. El más humano. Más caro.',
  },
  {
    id: 'qwen_omni',
    label: 'Qwen-Omni (self-host)',
    models: [
      { id: 'qwen3-omni', label: 'Qwen3-Omni' },
      { id: 'qwen2.5-omni', label: 'Qwen2.5-Omni' },
    ],
    voiceHint: 'voz del endpoint',
    note: 'S2S multilingüe self-host (RunPod/Modal). Server listo (runpod/qwen-omni); adapter LiveKit en progreso → por ahora cae al pipeline. $0 por minuto de API a escala.',
  },
  {
    id: 'personaplex',
    label: 'PersonaPlex (self-host)',
    models: [{ id: 'personaplex-7b', label: 'PersonaPlex 7B' }],
    voiceHint: 'voz PP (NATF2, NATM1…)',
    note: 'Full-duplex self-host (Modal/RunPod). Solo inglés, experimental. Sin tools.',
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

/**
 * base_url efectivo de una capa: el guardado en la config o, si no hay, el del
 * catálogo del proveedor. Así seleccionar Groq/Gemini/Cerebras/OpenAI enruta por
 * el camino OpenAI-compatible del worker sin tener que tipear la URL. Anthropic
 * es nativo (sin baseUrl en el catálogo) → devuelve null y usa su plugin propio.
 */
/**
 * ¿Este `voice_id` pertenece al proveedor de TTS activo? Cada proveedor tiene su
 * propio formato: Fish usa un `reference_id` de 32 hex, ElevenLabs un id de 20
 * caracteres, Deepgram/Gemini nombres de voz. Pasarle a uno el id de otro no
 * falla "suave": el proveedor rechaza la petición y la llamada queda MUDA.
 * Sólo validamos los formatos que sabemos reconocer; el resto pasa tal cual.
 */
const VOICE_ID_SHAPE: Record<string, RegExp> = {
  fish: /^[0-9a-f]{32}$/i,
};

/**
 * Voz efectiva para una llamada: la del agente si es válida para el proveedor,
 * si no la default de la plataforma, si no nada (el proveedor usa la suya). Así
 * cambiar el TTS global no deja mudos a los agentes que ya eligieron una voz.
 */
export function resolveTtsVoiceId(
  providerId: string | null | undefined,
  agentVoiceId: string | null | undefined,
  defaultVoiceId: string | null | undefined,
): string | null {
  const shape = VOICE_ID_SHAPE[(providerId || '').toLowerCase()];
  const candidates = [agentVoiceId, defaultVoiceId]
    .map((v) => v?.trim())
    .filter((v): v is string => !!v);
  const valid = shape ? candidates.filter((v) => shape.test(v)) : candidates;
  return valid[0] ?? null;
}

export function effectiveBaseUrl(
  layer: keyof typeof LAYER_PROVIDERS,
  providerId: string | null | undefined,
  storedBaseUrl: string | null | undefined,
): string | null {
  if (storedBaseUrl && storedBaseUrl.trim()) return storedBaseUrl.trim();
  return providerOption(layer, providerId)?.baseUrl ?? null;
}
