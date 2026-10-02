-- ============================================================
-- 129 — Re-otorgar SELECT de columnas agregadas DESPUÉS de la 078
-- ============================================================
--
-- La 078 revocó el SELECT a nivel de TABLA para `authenticated` y volvió a
-- otorgarlo columna por columna. Consecuencia no prevista: toda columna
-- agregada después nace SIN permiso para el cliente del navegador. Y en
-- Postgres, una columna sin SELECT rompe la consulta completa (42501) — no
-- devuelve la columna en null: no devuelve NADA.
--
-- Roto en producción por esto:
--   * /integraciones no mostraba NINGUNA conexión (el panel pide las 5
--     columnas health_* de la migración 111) → la cuenta parecía sin canales
--     aunque WhatsApp, Meta, Instagram, Outlook y Mercado Libre estaban
--     conectados.
--   * /voz, /campanas/voz y el nodo de voz del constructor de automatizaciones
--     traían la lista de agentes vacía: filtran por `voice_enabled`, y filtrar
--     por una columna también exige SELECT sobre ella.
--
-- Las columnas secretas siguen fuera del grant (es el punto de la 078):
--   channel_connections.secrets / .webhook_secret
--   ai_agents.api_key_encrypted
--   whatsapp_config.access_token / .verify_token
--   workspace_integrations.api_key_encrypted
--   shopify_connections.access_token / .webhook_secret / .api_secret
--
-- REGLA para futuras migraciones: si agregás una columna NO secreta a una de
-- esas cinco tablas, agregá su GRANT SELECT (...) TO authenticated acá mismo.
--
-- Idempotente: GRANT es repetible.
-- ============================================================

-- channel_connections — snapshot de salud de WhatsApp (migración 111).
GRANT SELECT (
  health_can_send, health_review_status, health_blockers,
  quality_rating, health_checked_at
) ON public.channel_connections TO authenticated;

-- ai_agents — modo de envío proactivo + configuración de voz
-- (migraciones 113/114/115/116). Ninguna es secreta.
-- Production originally created this column manually. Ensure it exists before
-- granting it when replaying migrations into an independent empty database.
ALTER TABLE public.ai_agents ADD COLUMN IF NOT EXISTS voice_system_prompt text;
GRANT SELECT (
  proactive_send_mode,
  voice_enabled, voice_provider, voice_id, voice_greeting, voice_objectives,
  voice_max_call_seconds, voice_calling_hours, voice_max_retries,
  voice_retry_delay_minutes, voice_ai_decides, voice_system_prompt
) ON public.ai_agents TO authenticated;
