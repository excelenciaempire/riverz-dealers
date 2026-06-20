-- ============================================================
-- 078 — Column-level lockdown of encrypted secret columns
-- ============================================================
--
-- RLS scopes ROWS to the workspace, but a member could still SELECT the
-- encrypted secret COLUMNS (ciphertext) of their own workspace's rows via
-- the anon/cookie client. Defense-in-depth: revoke table-level SELECT from
-- `authenticated` and grant SELECT only on the NON-secret columns, so the
-- encrypted columns are unreadable by the browser/cookie client. RLS still
-- filters rows on top of these grants.
--
-- Server code reads secrets with the SERVICE-ROLE client (supabaseAdmin),
-- which bypasses these grants — verified there is no cookie-client read of
-- any secret column (the one offender, channels-panel select('*'), was
-- switched to explicit non-secret columns before this migration).
--
-- Idempotent: REVOKE/GRANT are repeatable. Apply via the Supabase
-- Management API (migrations are manual here).
--
-- Secret columns locked (excluded from the grant):
--   channel_connections.secrets, channel_connections.webhook_secret
--   whatsapp_config.access_token, whatsapp_config.verify_token
--   ai_agents.api_key_encrypted
--   workspace_integrations.api_key_encrypted
--   shopify_connections.access_token
-- ============================================================

-- channel_connections
REVOKE SELECT ON public.channel_connections FROM authenticated;
GRANT SELECT (
  id, workspace_id, channel, label, status, external_account_id, config,
  last_synced_at, last_error, created_by, created_at, updated_at,
  messaging_limit_tier
) ON public.channel_connections TO authenticated;

-- whatsapp_config (also lock verify_token, a webhook secret)
REVOKE SELECT ON public.whatsapp_config FROM authenticated;
GRANT SELECT (
  id, user_id, phone_number_id, waba_id, status, connected_at,
  created_at, updated_at, workspace_id
) ON public.whatsapp_config TO authenticated;

-- ai_agents
REVOKE SELECT ON public.ai_agents FROM authenticated;
GRANT SELECT (
  id, workspace_id, name, is_active, persona, knowledge, language, tone,
  max_response_chars, reply_delay_seconds, context_messages,
  reply_when_assigned, reply_outside_hours, business_hours,
  escalate_keywords, escalate_after_messages, provider, model, scope,
  priority, created_at, updated_at, created_by, product_scope,
  response_mode, inbound_debounce_seconds, business_hours_start,
  business_hours_end, business_hours_timezone, business_hours_days,
  updated_by, knowledge_url, knowledge_synced_at, deleted_at
) ON public.ai_agents TO authenticated;

-- workspace_integrations
REVOKE SELECT ON public.workspace_integrations FROM authenticated;
GRANT SELECT (
  id, workspace_id, created_by, provider, is_active, created_at, updated_at
) ON public.workspace_integrations TO authenticated;

-- shopify_connections
REVOKE SELECT ON public.shopify_connections FROM authenticated;
GRANT SELECT (
  id, user_id, shop_domain, shop_name, scope, status, last_error,
  installed_at, uninstalled_at, created_at, updated_at, workspace_id
) ON public.shopify_connections TO authenticated;
