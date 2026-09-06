import { beforeEach, describe, expect, it, vi } from 'vitest';

const config = vi.hoisted(() => ({
  mode: 'pipeline',
  stt_provider: 'deepgram',
  llm_provider: 'anthropic',
  tts_provider: 'fish',
  realtime_provider: null,
}));
vi.mock('./model-config', () => ({ getVoiceModelConfig: async () => config }));

import { voiceProviderHealth } from './provider-health';

function db(states: Record<string, string>) {
  const data = Object.entries(states).map(([provider, state]) => ({
    provider,
    state,
    checked_at: new Date().toISOString(),
  }));
  return {
    from: () => ({ select: async () => ({ data }) }),
  } as never;
}

beforeEach(() => {
  config.mode = 'pipeline';
  config.stt_provider = 'deepgram';
  config.llm_provider = 'anthropic';
  config.tts_provider = 'fish';
  config.realtime_provider = null;
});

const BASE = {
  telnyx: 'ok',
  deepgram: 'ok',
  anthropic: 'ok',
  groq: 'ok',
  fish: 'ok',
  elevenlabs: 'ok',
};

describe('voice provider health', () => {
  it('treats low balance as a warning, not a block', async () => {
    const result = await voiceProviderHealth(db({ ...BASE, fish: 'bajo' }));
    expect(result).toMatchObject({ blocking: false, warning: true });
  });

  it('keeps calling when a failed primary TTS has a healthy backup', async () => {
    const result = await voiceProviderHealth(
      db({ ...BASE, fish: 'sin_saldo' })
    );
    expect(result).toMatchObject({
      aiBlocking: false,
      blocking: false,
      warning: true,
    });
  });

  it('blocks only the AI layer when both primary and backup fail', async () => {
    const result = await voiceProviderHealth(
      db({
        ...BASE,
        fish: 'sin_saldo',
        elevenlabs: 'error',
      })
    );
    expect(result).toMatchObject({
      aiBlocking: true,
      telephonyBlocking: false,
      blocking: true,
    });
  });

  it('blocks telephony when Telnyx is unavailable', async () => {
    const result = await voiceProviderHealth(
      db({ ...BASE, telnyx: 'sin_saldo' })
    );
    expect(result).toMatchObject({ telephonyBlocking: true, blocking: true });
  });
});
