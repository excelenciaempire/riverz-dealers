-- ============================================================
-- 099: TikTok comments as a channel
-- ============================================================
-- Adds 'tiktok_comment' to the 4 channel CHECK constraints so comments on
-- the merchant's own TikTok videos (Business Account / Accounts API) can be
-- stored/routed like any other channel. Same constraint set as 097.
-- Apply MANUALLY via the Supabase Management API (not on Render deploy), and
-- BEFORE shipping code that inserts channel='tiktok_comment'.
-- ============================================================

ALTER TABLE contacts DROP CONSTRAINT IF EXISTS contacts_channel_check;
ALTER TABLE contacts ADD CONSTRAINT contacts_channel_check
  CHECK (channel IN ('whatsapp','instagram','messenger','gmail','outlook','fb_comment','ig_comment','mercadolibre','tiktok_comment'));

ALTER TABLE conversations DROP CONSTRAINT IF EXISTS conversations_channel_check;
ALTER TABLE conversations ADD CONSTRAINT conversations_channel_check
  CHECK (channel IN ('whatsapp','instagram','messenger','gmail','outlook','fb_comment','ig_comment','mercadolibre','tiktok_comment'));

ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_channel_check;
ALTER TABLE messages ADD CONSTRAINT messages_channel_check
  CHECK (channel IN ('whatsapp','instagram','messenger','gmail','outlook','fb_comment','ig_comment','mercadolibre','tiktok_comment'));

ALTER TABLE channel_connections DROP CONSTRAINT IF EXISTS channel_connections_channel_check;
ALTER TABLE channel_connections ADD CONSTRAINT channel_connections_channel_check
  CHECK (channel IN ('whatsapp','instagram','messenger','gmail','outlook','fb_comment','ig_comment','mercadolibre','tiktok_comment'));
