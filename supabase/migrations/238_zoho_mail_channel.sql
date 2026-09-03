-- Zoho Mail becomes a first-class email channel. Apply before shipping code
-- that writes channel='zoho'. Keep this in sync with every channel CHECK.

ALTER TABLE contacts DROP CONSTRAINT IF EXISTS contacts_channel_check;
ALTER TABLE contacts ADD CONSTRAINT contacts_channel_check
  CHECK (channel IN ('whatsapp','instagram','messenger','gmail','outlook','zoho','fb_comment','ig_comment','mercadolibre','tiktok_comment','voice','ml_review','webchat'));

ALTER TABLE conversations DROP CONSTRAINT IF EXISTS conversations_channel_check;
ALTER TABLE conversations ADD CONSTRAINT conversations_channel_check
  CHECK (channel IN ('whatsapp','instagram','messenger','gmail','outlook','zoho','fb_comment','ig_comment','mercadolibre','tiktok_comment','voice','ml_review','webchat'));

ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_channel_check;
ALTER TABLE messages ADD CONSTRAINT messages_channel_check
  CHECK (channel IN ('whatsapp','instagram','messenger','gmail','outlook','zoho','fb_comment','ig_comment','mercadolibre','tiktok_comment','voice','ml_review','webchat'));

ALTER TABLE channel_connections DROP CONSTRAINT IF EXISTS channel_connections_channel_check;
ALTER TABLE channel_connections ADD CONSTRAINT channel_connections_channel_check
  CHECK (channel IN ('whatsapp','instagram','messenger','gmail','outlook','zoho','fb_comment','ig_comment','mercadolibre','tiktok_comment','voice','ml_review','webchat'));
