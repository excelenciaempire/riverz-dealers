-- ============================================================
-- 063 — One WhatsApp connection per workspace.
--
-- channel_connections never had a uniqueness constraint, so the
-- "already connected → refresh in place" branch (insErr.code 23505) in
-- both connect routes was dead code: every reconnect inserted a fresh
-- duplicate row. For WhatsApp specifically the product rule is exactly
-- one number per workspace (a workspace = one business = one WABA on
-- our plan). Coexistence is still ONE number (just is_on_biz_app=true),
-- so this rule does not block the future coexistence work.
--
-- We (1) collapse any pre-existing duplicate active WhatsApp rows so the
-- index can be created, then (2) add a partial UNIQUE index that allows
-- at most one non-disconnected WhatsApp per workspace. Disconnected rows
-- are exempt so a merchant can disconnect an old number and connect a
-- new one (history is preserved, not unique-constrained).
--
-- The application layer (upsertSingleWhatsAppConnection) is the primary
-- guard with a friendly message; this index is the race-safe backstop.
-- ============================================================

-- 1. Retire duplicate active WhatsApp connections. Keep the best row per
--    workspace (prefer connected, then most recently touched); demote
--    the rest to 'disconnected' so the unique index below can build.
WITH ranked AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY workspace_id
      ORDER BY
        (status = 'connected') DESC,
        updated_at DESC NULLS LAST,
        created_at DESC NULLS LAST
    ) AS rn
  FROM channel_connections
  WHERE channel = 'whatsapp'
    AND status <> 'disconnected'
)
UPDATE channel_connections c
SET status = 'disconnected'
FROM ranked r
WHERE c.id = r.id
  AND r.rn > 1;

-- 2. At most one active (non-disconnected) WhatsApp per workspace.
CREATE UNIQUE INDEX IF NOT EXISTS uq_one_active_whatsapp_per_workspace
  ON channel_connections (workspace_id)
  WHERE channel = 'whatsapp' AND status <> 'disconnected';
