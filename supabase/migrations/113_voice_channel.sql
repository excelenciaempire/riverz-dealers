-- ============================================================
-- 113: Voice AI — canal 'voice' + configuración de voz + voice_calls
-- ============================================================
-- Agentes de voz telefónicos (Telnyx SIP ↔ LiveKit ↔ worker Python).
-- 1) 'voice' en los 4 CHECK de channel (patrón 097/099).
-- 2) Config de voz 1:1 en ai_agents (columnas incrementales, patrón 024+).
-- 3) contacts.voice_opt_out (cumplimiento: "no llamar").
-- 4) voice_calls: máquina de estados / cola / metering. El transcript vive
--    como messages normales en una conversation channel='voice'.
-- Apply MANUALLY via the Supabase Management API (not on Render deploy), and
-- BEFORE shipping code that inserts channel='voice'.
-- ============================================================

-- ── 1. Canal 'voice' ─────────────────────────────────────────
ALTER TABLE contacts DROP CONSTRAINT IF EXISTS contacts_channel_check;
ALTER TABLE contacts ADD CONSTRAINT contacts_channel_check
  CHECK (channel IN ('whatsapp','instagram','messenger','gmail','outlook','fb_comment','ig_comment','mercadolibre','tiktok_comment','voice'));

ALTER TABLE conversations DROP CONSTRAINT IF EXISTS conversations_channel_check;
ALTER TABLE conversations ADD CONSTRAINT conversations_channel_check
  CHECK (channel IN ('whatsapp','instagram','messenger','gmail','outlook','fb_comment','ig_comment','mercadolibre','tiktok_comment','voice'));

ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_channel_check;
ALTER TABLE messages ADD CONSTRAINT messages_channel_check
  CHECK (channel IN ('whatsapp','instagram','messenger','gmail','outlook','fb_comment','ig_comment','mercadolibre','tiktok_comment','voice'));

ALTER TABLE channel_connections DROP CONSTRAINT IF EXISTS channel_connections_channel_check;
ALTER TABLE channel_connections ADD CONSTRAINT channel_connections_channel_check
  CHECK (channel IN ('whatsapp','instagram','messenger','gmail','outlook','fb_comment','ig_comment','mercadolibre','tiktok_comment','voice'));

-- ── 2. Configuración de voz en ai_agents (1:1) ───────────────
ALTER TABLE ai_agents
  ADD COLUMN IF NOT EXISTS voice_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS voice_provider TEXT NOT NULL DEFAULT 'elevenlabs'
    CHECK (voice_provider IN ('elevenlabs')),
  ADD COLUMN IF NOT EXISTS voice_id TEXT,
  ADD COLUMN IF NOT EXISTS voice_greeting TEXT,
  -- { order_confirmation|cart_recovery|followup|manual|inbound:
  --     { enabled: bool, objective: text, extra_instructions?: text } }
  ADD COLUMN IF NOT EXISTS voice_objectives JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS voice_max_call_seconds INT NOT NULL DEFAULT 300,
  -- Ventana horaria para llamadas salientes (timezone = workspace.timezone).
  ADD COLUMN IF NOT EXISTS voice_calling_hours JSONB
    DEFAULT '{"start":"09:00","end":"20:00","days":[1,2,3,4,5,6]}'::jsonb,
  ADD COLUMN IF NOT EXISTS voice_max_retries INT NOT NULL DEFAULT 2,
  ADD COLUMN IF NOT EXISTS voice_retry_delay_minutes INT NOT NULL DEFAULT 120;

-- ── 3. Opt-out de llamadas por contacto ──────────────────────
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS voice_opt_out BOOLEAN NOT NULL DEFAULT false;

-- ── 4. voice_calls: estado / cola / metering ─────────────────
CREATE TABLE IF NOT EXISTS voice_calls (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  agent_id UUID NOT NULL REFERENCES ai_agents(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
  automation_id UUID REFERENCES automations(id) ON DELETE SET NULL,
  direction TEXT NOT NULL DEFAULT 'outbound' CHECK (direction IN ('outbound','inbound')),
  call_type TEXT NOT NULL CHECK (call_type IN
    ('order_confirmation','cart_recovery','followup','manual','inbound')),
  phone TEXT NOT NULL,                -- E.164
  language TEXT NOT NULL DEFAULT 'es',
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN
    ('queued','dialing','in_progress','completed','failed','no_answer','busy','voicemail','canceled')),
  outcome TEXT CHECK (outcome IN
    ('confirmed','cancelled_by_customer','rescheduled','recovered','declined',
     'callback_requested','opt_out','no_outcome')),
  outcome_details JSONB,              -- estructurado por call_type
  summary TEXT,                       -- resumen 2-3 frases (worker)
  context JSONB NOT NULL DEFAULT '{}'::jsonb,  -- pedido/carrito/objetivo
  scheduled_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  attempt INT NOT NULL DEFAULT 1,
  max_attempts INT NOT NULL DEFAULT 3,
  parent_call_id UUID REFERENCES voice_calls(id) ON DELETE SET NULL,
  room_name TEXT,
  started_at TIMESTAMPTZ,
  answered_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  duration_seconds INT,
  cost JSONB,   -- {stt_usd, llm_usd, tts_usd, telephony_usd, total_usd, minutes}
  recording_url TEXT,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_voice_calls_ws_created ON voice_calls(workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_voice_calls_queue ON voice_calls(scheduled_at) WHERE status = 'queued';
CREATE INDEX IF NOT EXISTS idx_voice_calls_conversation ON voice_calls(conversation_id);

ALTER TABLE voice_calls ENABLE ROW LEVEL SECURITY;
-- Lectura para miembros del workspace; escrituras solo service role (APIs internas).
DROP POLICY IF EXISTS "Members read voice_calls" ON voice_calls;
CREATE POLICY "Members read voice_calls" ON voice_calls FOR SELECT
  USING (is_workspace_member(workspace_id));
