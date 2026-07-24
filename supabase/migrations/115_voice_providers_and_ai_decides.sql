-- ============================================================
-- 115: Voice AI — provider endpoints (Modal) + "AI decides to call"
-- ============================================================
-- 1) voice_model_config: optional endpoint URL + encrypted API key per layer
--    so the platform admin can point STT/LLM/TTS/realtime at a self-hosted
--    OpenAI-compatible endpoint (e.g. models running on Modal). Empty base_url
--    = use the built-in provider with its env key.
-- 2) ai_agents.voice_ai_decides: let the chat agent itself decide when to
--    escalate a conversation to a phone call (via the escalate_to_call tool),
--    within guardrails.
-- Apply MANUALLY via the Supabase Management API.
-- ============================================================

ALTER TABLE voice_model_config
  ADD COLUMN IF NOT EXISTS stt_base_url TEXT,
  ADD COLUMN IF NOT EXISTS stt_api_key_encrypted TEXT,
  ADD COLUMN IF NOT EXISTS llm_base_url TEXT,
  ADD COLUMN IF NOT EXISTS llm_api_key_encrypted TEXT,
  ADD COLUMN IF NOT EXISTS tts_base_url TEXT,
  ADD COLUMN IF NOT EXISTS tts_api_key_encrypted TEXT,
  ADD COLUMN IF NOT EXISTS realtime_base_url TEXT,
  ADD COLUMN IF NOT EXISTS realtime_api_key_encrypted TEXT;

ALTER TABLE ai_agents
  ADD COLUMN IF NOT EXISTS voice_ai_decides BOOLEAN NOT NULL DEFAULT false;
