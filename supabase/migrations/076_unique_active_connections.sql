-- ============================================================
-- 076 — Unique active connections (cross-tenant webhook safety)
--
-- WHY: Inbound webhooks are attributed to a tenant by their external
-- account identifier, NOT by the authenticated user:
--
--   * Shopify order/checkout/customer webhooks resolve the merchant via
--     x-shopify-shop-domain → shopify_connections WHERE
--     shop_domain = ? AND status = 'active' (see
--     src/lib/shopify/connection.ts getConnectionByShop).
--   * WhatsApp Cloud webhooks resolve the merchant via the inbound
--     phone_number_id → whatsapp_config.phone_number_id.
--
-- Neither table had a uniqueness guard on those lookup keys. When a shop
-- is re-installed under a different user_id (co-worker seat, ownership
-- transfer, support login) or the same WhatsApp number is configured by
-- two users, a SECOND active row appears for the same external account.
-- The webhook resolver then matches >1 tenant for one event, which:
--
--   * makes .maybeSingle() throw (silently breaking every webhook), and
--   * risks routing one tenant's messages/orders into another tenant's
--     workspace — a cross-tenant data leak.
--
-- This migration adds the missing database-level backstops:
--
--   1. At most ONE active Shopify connection per shop_domain.
--   2. Globally unique whatsapp_config.phone_number_id (one Meta number
--      can only ever belong to one tenant).
--
-- Both are idempotent (collapse-then-create with IF NOT EXISTS / DROP
-- IF EXISTS) and follow the same collapse-duplicates-first pattern as
-- migration 063 (one WhatsApp connection per workspace) so the indexes
-- can build over existing data without failing.
-- ============================================================

-- ── 1. shopify_connections: one ACTIVE row per shop_domain ──────────
--
-- Retire duplicate active connections for the same shop. Keep the best
-- row per shop_domain (prefer the most recent install, matching the
-- getConnectionByShop tiebreak of installed_at DESC) and demote the rest
-- to 'uninstalled' so history is preserved but only one row is 'active'
-- and the partial unique index can build.
WITH ranked AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY shop_domain
      ORDER BY
        installed_at DESC NULLS LAST,
        created_at DESC NULLS LAST
    ) AS rn
  FROM shopify_connections
  WHERE status = 'active'
)
UPDATE shopify_connections sc
SET status = 'uninstalled',
    uninstalled_at = COALESCE(sc.uninstalled_at, NOW())
FROM ranked r
WHERE sc.id = r.id
  AND r.rn > 1;

-- At most one active connection per shop_domain. Inactive rows
-- (uninstalled/expired/error) are exempt so a merchant can reinstall on
-- a new seat without tripping the constraint.
DROP INDEX IF EXISTS uq_shopify_connections_active_shop;
CREATE UNIQUE INDEX IF NOT EXISTS uq_shopify_connections_active_shop
  ON shopify_connections (shop_domain)
  WHERE status = 'active';

-- ── 2. whatsapp_config: globally unique phone_number_id ─────────────
--
-- A Meta WhatsApp phone_number_id is globally unique on Meta's side, so
-- it must map to exactly one tenant here. Collapse duplicates first:
-- keep the best row per phone_number_id (prefer connected, then most
-- recently touched) and demote the rest to 'disconnected'.
WITH ranked AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY phone_number_id
      ORDER BY
        (status = 'connected') DESC,
        updated_at DESC NULLS LAST,
        created_at DESC NULLS LAST
    ) AS rn
  FROM whatsapp_config
  WHERE phone_number_id IS NOT NULL
    AND phone_number_id <> ''
)
UPDATE whatsapp_config wc
SET status = 'disconnected'
FROM ranked r
WHERE wc.id = r.id
  AND r.rn > 1;

-- Globally unique phone_number_id. Partial WHERE skips NULL/empty
-- placeholders so a half-provisioned row never blocks a real one.
DROP INDEX IF EXISTS uq_whatsapp_config_phone_number_id;
CREATE UNIQUE INDEX IF NOT EXISTS uq_whatsapp_config_phone_number_id
  ON whatsapp_config (phone_number_id)
  WHERE phone_number_id IS NOT NULL AND phone_number_id <> '';
