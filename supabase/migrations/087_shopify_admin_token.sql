-- ============================================================
-- 087 — Per-tenant Shopify custom-app credentials (admin-token connect)
-- ============================================================
--
-- Until now Shopify connections went through ONE global OAuth app
-- (SHOPIFY_API_KEY / SHOPIFY_API_SECRET). That model can't serve many
-- merchants without listing the app on the App Store (review), and a
-- single global key can't hold N custom-distribution apps.
--
-- This migration unlocks the white-glove path: each merchant creates a
-- custom app in THEIR OWN Shopify admin (Develop apps), grants the scopes,
-- and pastes the Admin API access token + API secret key into Riverz. No
-- OAuth, no global key, fully self-contained per workspace — so it scales
-- to a handful of high-ticket merchants with zero App Review wait.
--
-- New columns on shopify_connections:
--   * webhook_secret    — the custom app's API secret key, used to
--     HMAC-verify THAT store's webhooks. Each store signs with its OWN
--     secret (not the global one), so it must be stored per connection.
--     Encrypted with the same iv:ct:tag AES-256-GCM helper as
--     access_token (src/lib/whatsapp/encryption.ts). Service-role read
--     only — never granted to the cookie client.
--   * connection_method — 'oauth' (global app) | 'admin_token' (per-store
--     custom app). Non-secret; readable by the cookie client for display.
--
-- Idempotent. Apply via the Supabase Management API (migrations are manual
-- here — see memory: Supabase migrations).
-- ============================================================

ALTER TABLE shopify_connections
  ADD COLUMN IF NOT EXISTS webhook_secret TEXT,                 -- encrypted (iv:ct:tag)
  ADD COLUMN IF NOT EXISTS connection_method TEXT NOT NULL DEFAULT 'oauth'
    CHECK (connection_method IN ('oauth', 'admin_token'));

-- Re-issue the column-level grant from migration 078 so the NEW non-secret
-- column (connection_method) is selectable by the cookie client, while the
-- NEW secret column (webhook_secret) stays excluded alongside access_token.
-- Column grants don't auto-extend to columns added later, so this REVOKE +
-- GRANT is required for connection_method to be readable at all.
REVOKE SELECT ON public.shopify_connections FROM authenticated;
GRANT SELECT (
  id, user_id, shop_domain, shop_name, scope, status, last_error,
  installed_at, uninstalled_at, created_at, updated_at, workspace_id,
  connection_method
) ON public.shopify_connections TO authenticated;
