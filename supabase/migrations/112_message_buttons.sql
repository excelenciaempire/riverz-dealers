-- Persist the resolved buttons of an outgoing template/interactive message so
-- the inbox can render them. WhatsApp templates carry URL / quick-reply buttons
-- (e.g. the "Terminar Pedido" checkout link of the abandoned-cart template),
-- but until now only the body text was stored — the bubble showed the copy with
-- no button, so the agent couldn't see (or click) what the customer received.
--
-- Shape: JSONB array of { type, text, url? }. For a dynamic URL button the
-- {{1}} placeholder is already replaced with the per-contact short link at send
-- time, so the stored url is the real, clickable destination.
ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS buttons JSONB;

COMMENT ON COLUMN messages.buttons IS
  'Resolved outbound message buttons for inbox rendering: [{type, text, url?}]. URL buttons store the final (short-link) destination, not the {{1}} placeholder.';
