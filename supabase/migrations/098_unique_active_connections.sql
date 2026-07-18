-- 098: one ACTIVE connection per (workspace, channel, external account).
--
-- The 013 design comment promised "one connection per (channel, external
-- account)" but no unique index ever backed it (except WhatsApp's
-- per-workspace cap in 063). Every reconnect of the same IG/FB page or
-- mailbox inserted a DUPLICATE row: the code's 23505 "reconnected — fine"
-- branches were dead code, and the webhook router then attributed events
-- to an arbitrary first match among the duplicates.
--
-- 1) Dedupe existing duplicates: keep the healthiest, most recently
--    updated row per identity; mark the rest disconnected (kept for
--    audit/history — conversations may still reference them).
WITH ranked AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY workspace_id, channel, external_account_id
           ORDER BY (status = 'connected') DESC,
                    updated_at DESC NULLS LAST,
                    created_at DESC,
                    id DESC
         ) AS rn
  FROM channel_connections
  WHERE status <> 'disconnected'
    AND external_account_id IS NOT NULL
)
UPDATE channel_connections c
SET status = 'disconnected',
    updated_at = now()
FROM ranked r
WHERE c.id = r.id
  AND r.rn > 1;

-- 2) Enforce it going forward. Partial: disconnected history rows don't
--    block a reconnect (the code revives the active row in place; on a
--    race the insert 23505s and the caller retries as an update).
CREATE UNIQUE INDEX IF NOT EXISTS uq_active_connection_per_account
  ON channel_connections (workspace_id, channel, external_account_id)
  WHERE status <> 'disconnected' AND external_account_id IS NOT NULL;
