-- ============================================================
-- 097: MercadoLibre as a channel
-- ============================================================
-- Adds 'mercadolibre' to the 4 channel CHECK constraints so ML questions +
-- post-sale messages can be stored/routed like any other channel. Constraint
-- names verified against the live DB (auto-named from migration 013).
-- Apply MANUALLY via the Supabase Management API (not on Render deploy), and
-- BEFORE shipping code that inserts channel='mercadolibre'.
-- ============================================================

ALTER TABLE contacts DROP CONSTRAINT IF EXISTS contacts_channel_check;
ALTER TABLE contacts ADD CONSTRAINT contacts_channel_check
  CHECK (channel IN ('whatsapp','instagram','messenger','gmail','outlook','fb_comment','ig_comment','mercadolibre'));

ALTER TABLE conversations DROP CONSTRAINT IF EXISTS conversations_channel_check;
ALTER TABLE conversations ADD CONSTRAINT conversations_channel_check
  CHECK (channel IN ('whatsapp','instagram','messenger','gmail','outlook','fb_comment','ig_comment','mercadolibre'));

ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_channel_check;
ALTER TABLE messages ADD CONSTRAINT messages_channel_check
  CHECK (channel IN ('whatsapp','instagram','messenger','gmail','outlook','fb_comment','ig_comment','mercadolibre'));

ALTER TABLE channel_connections DROP CONSTRAINT IF EXISTS channel_connections_channel_check;
ALTER TABLE channel_connections ADD CONSTRAINT channel_connections_channel_check
  CHECK (channel IN ('whatsapp','instagram','messenger','gmail','outlook','fb_comment','ig_comment','mercadolibre'));
