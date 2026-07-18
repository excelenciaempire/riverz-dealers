-- 101: Shopify pending installs.
--
-- App Store distribution requires OAuth to start IMMEDIATELY when the
-- merchant installs from Shopify admin — before any Riverz login/signup.
-- When the OAuth callback completes and no Riverz session exists (fresh
-- merchant, no SHOPIFY_DEFAULT_OWNER_ID, no prior connection for the
-- shop), the exchanged token parks here until the merchant signs in or
-- creates an account and the dashboard claims it into their workspace.
--
-- access_token is encrypted with the same scheme as shopify_connections.
-- claim_token_hash is sha256(raw claim token); the raw token only lives
-- in an httpOnly browser cookie, so a DB leak alone cannot claim a shop.
-- Rows are short-lived: claimed rows are deleted, unclaimed rows expire
-- at claim time (24h TTL check) and are overwritten by reinstalls.

create table if not exists public.shopify_pending_installs (
  id uuid primary key default gen_random_uuid(),
  shop_domain text not null unique,
  shop_name text,
  claim_token_hash text not null unique,
  access_token text not null,
  scope text,
  created_at timestamptz not null default now()
);

-- Service-role only: RLS on with no policies = deny for anon/authenticated.
alter table public.shopify_pending_installs enable row level security;
