-- ============================================================
-- 114: Voice AI — global model config (platform-admin only)
-- ============================================================
-- The voice model stack (STT/LLM/TTS, or a realtime full-duplex engine) is a
-- PLATFORM-WIDE choice set by the Riverz owner — merchants never change it.
-- Single-row table (id fixed to 1). RLS enabled with NO policies → readable /
-- writable only via the service role (the admin API gates by platform-admin
-- email; the voice context builder reads it with the admin client).
-- Apply MANUALLY via the Supabase Management API.
-- ============================================================

CREATE TABLE IF NOT EXISTS voice_model_config (
  id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  -- 'pipeline' = STT→LLM→TTS (default, controllable, swappable).
  -- 'realtime'  = full-duplex speech-to-speech engine (e.g. PersonaPlex).
  mode TEXT NOT NULL DEFAULT 'pipeline' CHECK (mode IN ('pipeline','realtime')),
  stt_provider TEXT NOT NULL DEFAULT 'deepgram',
  stt_model TEXT NOT NULL DEFAULT 'nova-3',
  stt_language TEXT NOT NULL DEFAULT 'multi',
  llm_provider TEXT NOT NULL DEFAULT 'anthropic',
  llm_model TEXT NOT NULL DEFAULT 'claude-haiku-4-5-20251001',
  tts_provider TEXT NOT NULL DEFAULT 'elevenlabs',
  tts_model TEXT NOT NULL DEFAULT 'eleven_flash_v2_5',
  -- Platform default voice used when an agent hasn't picked one.
  tts_default_voice_id TEXT,
  -- Realtime (full-duplex) engine, used only when mode='realtime'.
  realtime_provider TEXT,   -- e.g. 'personaplex'
  realtime_model TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID
);

-- Seed the single row with today's proven default stack.
INSERT INTO voice_model_config (id) VALUES (1)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE voice_model_config ENABLE ROW LEVEL SECURITY;
-- No policies: service-role only.
