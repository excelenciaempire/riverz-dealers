/**
 * Voice AI — global model config (platform-wide, admin-only).
 *
 * The STT/LLM/TTS stack (or a realtime full-duplex engine) is chosen ONCE by
 * the Riverz owner and applies to every workspace. Merchants never touch it.
 * The voice context builder reads this to tell the worker which models to run;
 * env vars are the fallback when the row is missing.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

export type VoiceMode = 'pipeline' | 'realtime';

export interface VoiceModelConfig {
  mode: VoiceMode;
  stt_provider: string;
  stt_model: string;
  stt_language: string;
  llm_provider: string;
  llm_model: string;
  tts_provider: string;
  tts_model: string;
  tts_default_voice_id: string | null;
  realtime_provider: string | null;
  realtime_model: string | null;
  updated_at?: string;
  updated_by?: string | null;
}

/** Defaults (also the migration-114 seed) — used when the row is absent. */
export function defaultVoiceModelConfig(): VoiceModelConfig {
  return {
    mode: 'pipeline',
    stt_provider: 'deepgram',
    stt_model: process.env.VOICE_STT_MODEL || 'nova-3',
    stt_language: process.env.VOICE_STT_LANGUAGE || 'multi',
    llm_provider: 'anthropic',
    llm_model: 'claude-haiku-4-5-20251001',
    tts_provider: 'elevenlabs',
    tts_model: 'eleven_flash_v2_5',
    tts_default_voice_id: null,
    realtime_provider: null,
    realtime_model: null,
  };
}

export async function getVoiceModelConfig(
  db: SupabaseClient,
): Promise<VoiceModelConfig> {
  const { data } = await db
    .from('voice_model_config')
    .select('*')
    .eq('id', 1)
    .maybeSingle();
  if (!data) return defaultVoiceModelConfig();
  return { ...defaultVoiceModelConfig(), ...(data as Partial<VoiceModelConfig>) };
}
