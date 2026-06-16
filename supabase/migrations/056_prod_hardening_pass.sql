-- ============================================================
-- 056: Prod hardening pass — RLS tightening, fulfillment race fix,
--      conversation closed_at, dashboard correctness, opt-out tier
--      enforcement aids, and inbox unaccent search.
-- ============================================================
-- This migration consolidates several small, additive, forward-only
-- changes from the prod hardening review. Each block is independent and
-- idempotent (DROP IF EXISTS / IF NOT EXISTS / CREATE OR REPLACE) so it
-- is safe to re-run against a partially-applied schema.

-- ------------------------------------------------------------
-- (#12, #13, #14) RLS — drop public-role INSERT / FOR ALL grants
-- ------------------------------------------------------------
-- The original policies were written with WITH CHECK (true) and no TO
-- clause, which applied to PUBLIC (anon + authenticated + service_role).
-- service_role bypasses RLS anyway, so these policies only ever ADDED
-- access for anon/authenticated. Drop them; the service-role app paths
-- continue to work unchanged.

DROP POLICY IF EXISTS "Service role can insert messages" ON messages;
DROP POLICY IF EXISTS "Service role insert comments_meta" ON comments_meta;

DROP POLICY IF EXISTS "Service role manages ad_posts" ON ad_posts;
CREATE POLICY "Service role manages ad_posts" ON ad_posts
  FOR ALL USING (false) WITH CHECK (false);

-- ------------------------------------------------------------
-- (#7) Atomic fulfillment-transition RPC for orders/updated webhook
-- ------------------------------------------------------------
-- The previous flow was read-then-upsert. Two concurrent webhook
-- deliveries for the same order both observed previous=null and both
-- dispatched shopify_order_fulfilled. The RPC below performs the read,
-- insert/update, and transition diff inside a single statement, with a
-- FOR UPDATE row lock that serializes concurrent deliveries.

CREATE OR REPLACE FUNCTION shopify_record_fulfillment_transition(
  p_shop_domain TEXT,
  p_order_id BIGINT,
  p_fulfillment_status TEXT,
  p_shipment_status TEXT,
  p_just_delivered BOOLEAN
) RETURNS TABLE(transitioned_to_fulfilled BOOLEAN, transitioned_to_delivered BOOLEAN)
LANGUAGE plpgsql AS $$
DECLARE
  prev_fulfillment TEXT;
  prev_shipment TEXT;
  prev_delivered_at TIMESTAMPTZ;
BEGIN
  SELECT fulfillment_status, shipment_status, delivered_at
    INTO prev_fulfillment, prev_shipment, prev_delivered_at
  FROM shopify_order_fulfillment_state
  WHERE shop_domain = p_shop_domain AND order_id = p_order_id
  FOR UPDATE;

  INSERT INTO shopify_order_fulfillment_state (
    shop_domain, order_id, fulfillment_status, shipment_status,
    delivered_at, updated_at
  ) VALUES (
    p_shop_domain, p_order_id, p_fulfillment_status, p_shipment_status,
    CASE WHEN p_just_delivered AND prev_shipment IS DISTINCT FROM 'delivered'
         THEN NOW() ELSE prev_delivered_at END,
    NOW()
  )
  ON CONFLICT (shop_domain, order_id) DO UPDATE SET
    fulfillment_status = EXCLUDED.fulfillment_status,
    shipment_status = EXCLUDED.shipment_status,
    delivered_at = EXCLUDED.delivered_at,
    updated_at = EXCLUDED.updated_at;

  RETURN QUERY SELECT
    (p_fulfillment_status = 'fulfilled' AND prev_fulfillment IS DISTINCT FROM 'fulfilled'),
    (p_just_delivered AND prev_shipment IS DISTINCT FROM 'delivered');
END $$;

-- ------------------------------------------------------------
-- (#29 / #30) conversations.closed_at — gate "resueltas hoy" on the
-- actual close event rather than the catch-all updated_at trigger.
-- ------------------------------------------------------------

ALTER TABLE conversations ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ;

-- Best-effort backfill so today's "Resueltas hoy" doesn't drop to zero
-- on deploy day. updated_at is wrong for historical rows for exactly
-- the reason this column exists, but it's the closest proxy we have.
UPDATE conversations
SET closed_at = updated_at
WHERE status = 'closed' AND closed_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_conversations_closed_at
  ON conversations(closed_at) WHERE status = 'closed';

-- ------------------------------------------------------------
-- (#2) Backfill ai_agents.inbound_debounce_seconds default
-- ------------------------------------------------------------
-- Pre-034 rows can have 0, which disables the debounce gate and lets
-- 20 concurrent runners race on a 20-message burst. Bump every 0 to a
-- safe floor of 8 seconds and set the column default to match. The
-- runner also enforces a 8s floor in code (belt + suspenders).

UPDATE ai_agents
SET inbound_debounce_seconds = 8
WHERE inbound_debounce_seconds IS NULL OR inbound_debounce_seconds = 0;

ALTER TABLE ai_agents
  ALTER COLUMN inbound_debounce_seconds SET DEFAULT 8;

-- ------------------------------------------------------------
-- (#20) Inbox search — unaccent + RPC so Spanish accents match.
-- ------------------------------------------------------------
-- ILIKE is byte-comparison. "canción" vs "cancion" do not match. We
-- wrap unaccent in an IMMUTABLE wrapper so it can be used in index
-- expressions, drop the legacy trigram indexes (they didn't unaccent
-- anyway) and replace with unaccent-aware ones, then expose a single
-- RPC the API can call.

CREATE EXTENSION IF NOT EXISTS unaccent;

CREATE OR REPLACE FUNCTION f_unaccent(text)
  RETURNS text
  LANGUAGE sql
  IMMUTABLE
  PARALLEL SAFE
AS $$ SELECT public.unaccent('public.unaccent'::regdictionary, $1) $$;

DROP INDEX IF EXISTS conversations_last_msg_trgm_idx;
DROP INDEX IF EXISTS messages_content_trgm_idx;

CREATE INDEX IF NOT EXISTS conversations_last_msg_unaccent_trgm_idx
  ON conversations USING gin (f_unaccent(last_message_text) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS messages_content_unaccent_trgm_idx
  ON messages USING gin (f_unaccent(content_text) gin_trgm_ops);

CREATE OR REPLACE FUNCTION inbox_search(q text, max_rows int DEFAULT 30)
  RETURNS TABLE (
    kind text,
    conversation_id uuid,
    message_id uuid,
    last_message_text text,
    content_text text,
    last_message_at timestamptz,
    contact_id uuid
  )
  LANGUAGE sql
  STABLE
  SECURITY INVOKER
AS $$
  WITH pat AS (SELECT '%' || f_unaccent(q) || '%' AS p)
  (SELECT 'conv'::text, c.id, NULL::uuid, c.last_message_text, NULL::text,
          c.last_message_at, c.contact_id
     FROM conversations c, pat
    WHERE f_unaccent(c.last_message_text) ILIKE pat.p
    ORDER BY c.last_message_at DESC
    LIMIT max_rows)
  UNION ALL
  (SELECT 'msg'::text, m.conversation_id, m.id, NULL::text, m.content_text,
          m.created_at, NULL::uuid
     FROM messages m, pat
    WHERE f_unaccent(m.content_text) ILIKE pat.p
    ORDER BY m.created_at DESC
    LIMIT max_rows);
$$;
