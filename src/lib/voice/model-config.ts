/**
 * Voice AI — global model config (platform-wide, admin-only).
 *
 * The STT/LLM/TTS stack (or a realtime full-duplex engine) is chosen ONCE by
 * the Riverz owner and applies to every workspace. Merchants never touch it.
 *
 * Each layer can optionally point at a self-hosted OpenAI-compatible endpoint
 * (base_url + api_key) so the models can run on Modal instead of the built-in
 * providers. API keys are stored ENCRYPTED; the admin view never returns them
 * (only `has_*_key` booleans), while the worker view decrypts them.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { encrypt, decrypt } from '@/lib/whatsapp/encryption';

export type VoiceMode = 'pipeline' | 'realtime';

/** Raw row shape as stored (encrypted keys). Internal. */
interface VoiceModelRow {
  mode: VoiceMode;
  stt_provider: string;
  stt_model: string;
  stt_language: string;
  stt_base_url: string | null;
  stt_api_key_encrypted: string | null;
  llm_provider: string;
  llm_model: string;
  llm_base_url: string | null;
  llm_api_key_encrypted: string | null;
  tts_provider: string;
  tts_model: string;
  tts_default_voice_id: string | null;
  tts_base_url: string | null;
  tts_api_key_encrypted: string | null;
  realtime_provider: string | null;
  realtime_model: string | null;
  realtime_base_url: string | null;
  realtime_api_key_encrypted: string | null;
  updated_at?: string;
  updated_by?: string | null;
}

/** Admin-facing view — base URLs shown, keys replaced by has_* booleans. */
export interface VoiceModelConfig {
  mode: VoiceMode;
  stt_provider: string;
  stt_model: string;
  stt_language: string;
  stt_base_url: string | null;
  has_stt_key: boolean;
  llm_provider: string;
  llm_model: string;
  llm_base_url: string | null;
  has_llm_key: boolean;
  tts_provider: string;
  tts_model: string;
  tts_default_voice_id: string | null;
  tts_base_url: string | null;
  has_tts_key: boolean;
  realtime_provider: string | null;
  realtime_model: string | null;
  realtime_base_url: string | null;
  has_realtime_key: boolean;
  updated_at?: string;
  updated_by?: string | null;
}

/** Worker-facing view — decrypted keys, ready to build the session. */
export interface VoiceModelResolved {
  mode: VoiceMode;
  stt_provider: string;
  stt_model: string;
  stt_language: string;
  stt_base_url: string | null;
  stt_api_key: string | null;
  llm_provider: string;
  llm_model: string;
  llm_base_url: string | null;
  llm_api_key: string | null;
  tts_provider: string;
  tts_model: string;
  tts_default_voice_id: string | null;
  tts_base_url: string | null;
  tts_api_key: string | null;
  realtime_provider: string | null;
  realtime_model: string | null;
  realtime_base_url: string | null;
  realtime_api_key: string | null;
}

function defaultRow(): VoiceModelRow {
  return {
    mode: 'pipeline',
    stt_provider: 'deepgram',
    stt_model: process.env.VOICE_STT_MODEL || 'nova-3',
    stt_language: process.env.VOICE_STT_LANGUAGE || 'multi',
    stt_base_url: null,
    stt_api_key_encrypted: null,
    llm_provider: 'anthropic',
    llm_model: 'claude-haiku-4-5-20251001',
    llm_base_url: null,
    llm_api_key_encrypted: null,
    tts_provider: 'elevenlabs',
    tts_model: 'eleven_flash_v2_5',
    tts_default_voice_id: null,
    tts_base_url: null,
    tts_api_key_encrypted: null,
    realtime_provider: null,
    realtime_model: null,
    realtime_base_url: null,
    realtime_api_key_encrypted: null,
  };
}

async function getRow(db: SupabaseClient): Promise<VoiceModelRow> {
  const { data } = await db
    .from('voice_model_config')
    .select('*')
    .eq('id', 1)
    .maybeSingle();
  if (!data) return defaultRow();
  return { ...defaultRow(), ...(data as Partial<VoiceModelRow>) };
}

function safeDecrypt(v: string | null): string | null {
  if (!v) return null;
  try {
    return decrypt(v);
  } catch {
    return null;
  }
}

/** Admin view (no secrets). */
export async function getVoiceModelConfig(db: SupabaseClient): Promise<VoiceModelConfig> {
  const r = await getRow(db);
  return {
    mode: r.mode,
    stt_provider: r.stt_provider,
    stt_model: r.stt_model,
    stt_language: r.stt_language,
    stt_base_url: r.stt_base_url,
    has_stt_key: !!r.stt_api_key_encrypted,
    llm_provider: r.llm_provider,
    llm_model: r.llm_model,
    llm_base_url: r.llm_base_url,
    has_llm_key: !!r.llm_api_key_encrypted,
    tts_provider: r.tts_provider,
    tts_model: r.tts_model,
    tts_default_voice_id: r.tts_default_voice_id,
    tts_base_url: r.tts_base_url,
    has_tts_key: !!r.tts_api_key_encrypted,
    realtime_provider: r.realtime_provider,
    realtime_model: r.realtime_model,
    realtime_base_url: r.realtime_base_url,
    has_realtime_key: !!r.realtime_api_key_encrypted,
    updated_at: r.updated_at,
    updated_by: r.updated_by,
  };
}

/** Worker view (decrypted keys) — used by the voice context builder only. */
export async function getVoiceModelResolved(db: SupabaseClient): Promise<VoiceModelResolved> {
  const r = await getRow(db);
  return {
    mode: r.mode,
    stt_provider: r.stt_provider,
    stt_model: r.stt_model,
    stt_language: r.stt_language,
    stt_base_url: r.stt_base_url,
    stt_api_key: safeDecrypt(r.stt_api_key_encrypted),
    llm_provider: r.llm_provider,
    llm_model: r.llm_model,
    llm_base_url: r.llm_base_url,
    llm_api_key: safeDecrypt(r.llm_api_key_encrypted),
    tts_provider: r.tts_provider,
    tts_model: r.tts_model,
    tts_default_voice_id: r.tts_default_voice_id,
    tts_base_url: r.tts_base_url,
    tts_api_key: safeDecrypt(r.tts_api_key_encrypted),
    realtime_provider: r.realtime_provider,
    realtime_model: r.realtime_model,
    realtime_base_url: r.realtime_base_url,
    realtime_api_key: safeDecrypt(r.realtime_api_key_encrypted),
  };
}

/**
 * Build the DB update for the admin PUT. Accepts the admin view plus optional
 * plaintext keys (`stt_api_key`, etc.); encrypts any provided key and leaves
 * the stored one untouched when the field is absent (empty string clears it).
 */
export function buildModelUpdate(
  body: Partial<VoiceModelConfig> & {
    stt_api_key?: string;
    llm_api_key?: string;
    tts_api_key?: string;
    realtime_api_key?: string;
  },
): Record<string, unknown> {
  const update: Record<string, unknown> = {};
  const plain: (keyof VoiceModelConfig)[] = [
    'mode',
    'stt_provider',
    'stt_model',
    'stt_language',
    'stt_base_url',
    'llm_provider',
    'llm_model',
    'llm_base_url',
    'tts_provider',
    'tts_model',
    'tts_default_voice_id',
    'tts_base_url',
    'realtime_provider',
    'realtime_model',
    'realtime_base_url',
  ];
  for (const k of plain) {
    if (k in body) update[k] = body[k];
  }
  const keyMap: Record<string, string> = {
    stt_api_key: 'stt_api_key_encrypted',
    llm_api_key: 'llm_api_key_encrypted',
    tts_api_key: 'tts_api_key_encrypted',
    realtime_api_key: 'realtime_api_key_encrypted',
  };
  for (const [plainKey, col] of Object.entries(keyMap)) {
    const v = (body as Record<string, unknown>)[plainKey];
    if (typeof v === 'string') {
      update[col] = v.trim() ? encrypt(v.trim()) : null;
    }
  }
  return update;
}
