-- ============================================================
-- 058: per-WABA messaging-tier cap enforcement
-- ============================================================
--
-- Meta gates the WhatsApp Business API by a "messaging limit" tier per
-- WABA: how many UNIQUE recipients you may initiate conversations with
-- in any rolling 24 h window.
--
--   TIER_50         50 / 24h
--   TIER_250        250 / 24h
--   TIER_1K       1.000 / 24h
--   TIER_10K     10.000 / 24h
--   TIER_100K   100.000 / 24h
--   TIER_UNLIMITED  no cap
--
-- Until now the broadcasts cron only enforced a per-process token bucket
-- (src/lib/whatsapp/throttle.ts) which paces *rate* but doesn't bound
-- *volume*. A merchant on TIER_250 could still blast a 5.000-row CSV at
-- 80 msg/s and trip Meta's tier cap, which downgrades quality rating
-- and silently drops messages.
--
-- This migration adds:
--
--   1. channel_connections.messaging_limit_tier — cached tier string
--      pulled from the WABA `messaging_limit` field. NULLABLE: refreshed
--      on connect + by webhook/cron. NULL is treated by the app code as
--      TIER_50 (most conservative) so a stale row never lets us OVER-send.
--
--   2. get_waba_24h_sent_count(conn_id UUID) → INT — counts DISTINCT
--      recipients (by contact_id) with broadcast_recipients.status='sent'
--      AND sent_at within the last 24 h, scoped to broadcasts in the
--      same workspace as the connection. We don't have a direct
--      connection_id FK on broadcasts yet (one WhatsApp connection per
--      workspace today), so we scope via workspace_id + channel.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS + CREATE OR REPLACE FUNCTION.

-- ── 1. Cached tier on the connection ───────────────────────────
ALTER TABLE channel_connections
  ADD COLUMN IF NOT EXISTS messaging_limit_tier TEXT;

-- Loose check — the enum upstream evolves (Meta has added tiers over
-- the years) so we allow NULL + a known set, and treat anything outside
-- as conservative in app code.
ALTER TABLE channel_connections
  DROP CONSTRAINT IF EXISTS channel_connections_tier_check;
ALTER TABLE channel_connections
  ADD CONSTRAINT channel_connections_tier_check
  CHECK (
    messaging_limit_tier IS NULL OR messaging_limit_tier IN (
      'TIER_50',
      'TIER_250',
      'TIER_1K',
      'TIER_10K',
      'TIER_100K',
      'TIER_UNLIMITED'
    )
  );

-- The 24h-count query filters channel_connections by workspace + channel.
CREATE INDEX IF NOT EXISTS idx_connections_workspace_channel
  ON channel_connections(workspace_id, channel);

-- Hot path for the helper below: per-broadcast sent recipients in the
-- last 24h. Partial index keeps it cheap on large recipient tables.
CREATE INDEX IF NOT EXISTS idx_broadcast_recipients_sent_at
  ON broadcast_recipients(broadcast_id, sent_at)
  WHERE status = 'sent';

-- ── 2. Rolling-24h sent count per connection ───────────────────
-- Returns the number of DISTINCT contacts the given channel_connection
-- has successfully delivered a broadcast template to in the last 24h.
-- Scopes via the connection's workspace_id — we join through broadcasts
-- because broadcast_recipients does not (yet) carry connection_id.
--
-- Caller MUST pass a real channel_connections.id; an unknown id returns
-- 0 (callers treat that the same as "no quota used"; the app-side
-- assertWithinTierCap also fetches the tier via the same id).
CREATE OR REPLACE FUNCTION get_waba_24h_sent_count(conn_id UUID)
RETURNS INT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(COUNT(DISTINCT br.contact_id), 0)::INT
  FROM channel_connections cc
  JOIN broadcasts b
    ON b.workspace_id = cc.workspace_id
  JOIN broadcast_recipients br
    ON br.broadcast_id = b.id
  WHERE cc.id = conn_id
    AND cc.channel = 'whatsapp'
    AND br.status = 'sent'
    AND br.sent_at >= NOW() - INTERVAL '24 hours';
$$;

COMMENT ON FUNCTION get_waba_24h_sent_count(UUID) IS
  'Distinct sent recipients per channel_connection in the last 24h. Used by assertWithinTierCap() to gate bulk WhatsApp sends against the WABA messaging-tier cap.';
