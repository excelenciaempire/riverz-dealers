import { describe, it, expect } from 'vitest';
import {
  isUsableBaseUrl,
  isValidVoice,
  normalizeStack,
  resolveVoiceId,
  staleFieldsOnProviderChange,
} from './compat';
import { providerOption } from './providers';
import { buildModelUpdate, type VoiceModelConfig } from './model-config';

/** Config base coherente: el default de fábrica (Deepgram + Groq + Aura). */
function baseConfig(over: Partial<VoiceModelConfig> = {}): VoiceModelConfig {
  return {
    mode: 'pipeline',
    stt_provider: 'deepgram',
    stt_model: 'nova-3',
    stt_language: 'multi',
    stt_base_url: null,
    has_stt_key: false,
    llm_provider: 'groq',
    llm_model: 'llama-3.3-70b-versatile',
    llm_base_url: null,
    has_llm_key: false,
    tts_provider: 'deepgram',
    tts_model: 'aura-2-celeste-es',
    tts_default_voice_id: null,
    tts_base_url: null,
    has_tts_key: false,
    realtime_provider: null,
    realtime_model: null,
    realtime_base_url: null,
    has_realtime_key: false,
    ...over,
  };
}

describe('isValidVoice', () => {
  it('acepta sólo el formato de cada proveedor', () => {
    const fish = providerOption('tts', 'fish');
    expect(isValidVoice(fish, '933563129e564b19a115bedd57b7406a')).toBe(true);
    // Un voice_id de ElevenLabs en Fish = llamada muda.
    expect(isValidVoice(fish, 'XrExE9yKIg1WjnnlVkGX')).toBe(false);

    const eleven = providerOption('tts', 'elevenlabs');
    expect(isValidVoice(eleven, 'XrExE9yKIg1WjnnlVkGX')).toBe(true);
    expect(isValidVoice(eleven, '933563129e564b19a115bedd57b7406a')).toBe(false);
  });

  it('Gemini sólo acepta los nombres de su lista', () => {
    const gemini = providerOption('tts', 'gemini');
    expect(isValidVoice(gemini, 'Aoede')).toBe(true);
    expect(isValidVoice(gemini, 'XrExE9yKIg1WjnnlVkGX')).toBe(false);
  });

  it('Deepgram no usa voice_id: la voz va en el modelo', () => {
    expect(isValidVoice(providerOption('tts', 'deepgram'), 'lo-que-sea')).toBe(false);
  });

  it('un proveedor custom acepta cualquier voz', () => {
    expect(isValidVoice(providerOption('tts', 'openai_compatible'), 'x-1')).toBe(true);
    expect(isValidVoice(undefined, 'x-1')).toBe(true);
  });
});

describe('resolveVoiceId', () => {
  it('prefiere la voz del agente cuando sirve para el proveedor', () => {
    expect(resolveVoiceId('tts', 'elevenlabs', 'XrExE9yKIg1WjnnlVkGX', null)).toBe(
      'XrExE9yKIg1WjnnlVkGX',
    );
  });

  it('descarta la voz del agente si es de otro proveedor y usa la de plataforma', () => {
    const platform = '933563129e564b19a115bedd57b7406a';
    expect(resolveVoiceId('tts', 'fish', 'XrExE9yKIg1WjnnlVkGX', platform)).toBe(platform);
  });

  it('cae a la voz del catálogo cuando ninguna candidata sirve', () => {
    // Ambas son de ElevenLabs y el proveedor activo es Gemini.
    expect(resolveVoiceId('tts', 'gemini', 'XrExE9yKIg1WjnnlVkGX', 'pqHfZKP75CvOlQylNhV4')).toBe(
      'Aoede',
    );
  });

  it('devuelve null cuando el proveedor no tiene voz por defecto', () => {
    expect(resolveVoiceId('tts', 'fish', 'XrExE9yKIg1WjnnlVkGX', null)).toBeNull();
  });
});

describe('isUsableBaseUrl', () => {
  it('conserva el endpoint propio del catálogo', () => {
    expect(isUsableBaseUrl('llm', 'groq', 'https://api.groq.com/openai/v1')).toBe(true);
  });

  it('descarta un endpoint heredado de otro proveedor', () => {
    expect(isUsableBaseUrl('llm', 'anthropic', 'https://api.groq.com/openai/v1')).toBe(false);
  });

  it('respeta el endpoint de un proveedor custom', () => {
    expect(isUsableBaseUrl('tts', 'openai_compatible', 'https://x.modal.run/v1')).toBe(true);
  });

  it('sin endpoint no hay nada que descartar', () => {
    expect(isUsableBaseUrl('tts', 'fish', null)).toBe(true);
  });
});

describe('normalizeStack', () => {
  it('deja en paz un stack coherente', () => {
    const { changes } = normalizeStack(baseConfig());
    expect(changes).toEqual([]);
  });

  it('corrige el modelo que quedó del proveedor anterior', () => {
    const { config, changes } = normalizeStack(
      baseConfig({ tts_provider: 'fish', tts_model: 'eleven_flash_v2_5' }),
    );
    expect(config.tts_model).toBe('s2.1-pro');
    expect(changes).toContainEqual({
      layer: 'tts',
      field: 'model',
      from: 'eleven_flash_v2_5',
      to: 's2.1-pro',
    });
  });

  it('limpia la voz que no es del proveedor activo', () => {
    const { config } = normalizeStack(
      baseConfig({
        tts_provider: 'fish',
        tts_model: 's2.1-pro',
        tts_default_voice_id: 'XrExE9yKIg1WjnnlVkGX',
      }),
    );
    expect(config.tts_default_voice_id).toBeNull();
  });

  it('usa la voz por defecto del proveedor cuando la tiene', () => {
    const { config } = normalizeStack(
      baseConfig({
        tts_provider: 'gemini',
        tts_model: 'gemini-2.5-flash-preview-tts',
        tts_default_voice_id: 'XrExE9yKIg1WjnnlVkGX',
      }),
    );
    expect(config.tts_default_voice_id).toBe('Aoede');
  });

  it('descarta el endpoint heredado', () => {
    const { config, changes } = normalizeStack(
      baseConfig({ llm_provider: 'anthropic', llm_base_url: 'https://api.groq.com/openai/v1' }),
    );
    expect(config.llm_base_url).toBeNull();
    expect(changes.some((c) => c.layer === 'llm' && c.field === 'base_url')).toBe(true);
  });

  it('no toca un proveedor fuera del catálogo', () => {
    const { config, changes } = normalizeStack(
      baseConfig({ tts_provider: 'mi-tts', tts_model: 'lo-que-sea' }),
    );
    expect(config.tts_model).toBe('lo-que-sea');
    expect(changes).toEqual([]);
  });

  it('en realtime la voz se valida contra el motor S2S, no contra el TTS', () => {
    const { config } = normalizeStack(
      baseConfig({
        mode: 'realtime',
        realtime_provider: 'openai_realtime',
        realtime_model: 'gpt-realtime',
        // Una voz de Gemini: válida para el TTS de Google, no para OpenAI.
        tts_default_voice_id: 'Aoede',
      }),
    );
    expect(config.tts_default_voice_id).toBe('marin');
  });
});

describe('staleFieldsOnProviderChange', () => {
  it('barre endpoint y key del proveedor anterior', () => {
    const { columns } = staleFieldsOnProviderChange('tts', 'cartesia', 'fish', {
      baseUrl: false,
      apiKey: false,
    });
    expect(columns).toEqual(['tts_base_url', 'tts_api_key_encrypted']);
  });

  it('no pisa lo que el mismo request está seteando', () => {
    const { columns } = staleFieldsOnProviderChange('tts', 'cartesia', 'fish', {
      baseUrl: true,
      apiKey: true,
    });
    expect(columns).toEqual([]);
  });

  it('sin cambio de proveedor no toca nada', () => {
    const { columns } = staleFieldsOnProviderChange('tts', 'fish', 'fish', {
      baseUrl: false,
      apiKey: false,
    });
    expect(columns).toEqual([]);
  });
});

describe('buildModelUpdate', () => {
  it('al cambiar de proveedor guarda un stack coherente y sin restos', () => {
    const current = baseConfig({
      tts_provider: 'cartesia',
      tts_model: 'sonic-2',
      tts_default_voice_id: '694f9389-aac1-45b6-b726-9d9369183238',
      tts_base_url: 'https://voz.modal.run/v1',
      has_tts_key: true,
    });
    // El admin sólo cambia el proveedor; el resto llega tal cual estaba.
    const { update, changes } = buildModelUpdate(
      { ...current, tts_provider: 'fish' },
      current,
    );

    expect(update.tts_api_key_encrypted).toBeNull();
    expect(update.tts_base_url).toBeNull();
    expect(update.tts_model).toBe('s2.1-pro');
    expect(update.tts_default_voice_id).toBeNull();
    expect(changes.length).toBeGreaterThan(0);
  });

  it('sin `current` se comporta como antes (sólo copia lo que llega)', () => {
    const { update, changes } = buildModelUpdate({ tts_provider: 'fish' });
    expect(update).toEqual({ tts_provider: 'fish' });
    expect(changes).toEqual([]);
  });

  it('una key nueva en el mismo request sobrevive al cambio de proveedor', () => {
    const current = baseConfig({ tts_provider: 'cartesia', tts_model: 'sonic-2' });
    const { update } = buildModelUpdate(
      { ...current, tts_provider: 'fish', tts_api_key: 'fish-key-nueva' },
      current,
    );
    expect(update.tts_api_key_encrypted).toBeTruthy();
  });
});
