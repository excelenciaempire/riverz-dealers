-- ============================================================
-- 069 — AI-enriched contact segment.
--
-- Blueberry shows a CRM-style enriched profile per person: a Segment label
-- ("Beauty Enthusiast / Engaged Shopper") plus a few Definition bullets,
-- synthesized from how they engage. We store that synthesis here so the inbox
-- contact panel can show it without recomputing on every open.
--
--   contacts.ai_segment JSONB
--       { "label": string, "traits": string[], "computed_at": ISO,
--         "up_to_message_id": uuid|null }
--
-- Computed lazily (Haiku) the first time a contact's panel is opened and
-- cached; refreshed on demand.
-- ============================================================

ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS ai_segment JSONB;
