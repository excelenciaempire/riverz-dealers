-- ============================================================
-- 048: conversation rolling AI summary
-- ============================================================
--
-- (Spec original llamó a esto "047" pero 047_shopify_checkouts_full ya
--  estaba aplicado; bumpeamos a 048 para no chocar la numeración.)
--
-- Para conversaciones largas (>30 mensajes) no podemos seguir
-- enviándole TODO el historial a Claude en cada turno — explota el
-- prompt, gasta tokens y baja la latencia. La estrategia es:
--
--   * Mantener los últimos N mensajes verbatim en el context.
--   * Compactar TODO lo más viejo en un resumen rodante de ~200 palabras,
--     guardado en `conversations.ai_summary`.
--   * El runner inyecta el resumen como pseudo-system message ANTES del
--     historial reciente.
--
-- `ai_summary_up_to_message_id` apunta al último mensaje que ya está
-- cubierto por el resumen, para saber a partir de dónde tenemos que
-- volver a resumir.

ALTER TABLE conversations ADD COLUMN IF NOT EXISTS ai_summary TEXT;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS ai_summary_up_to_message_id UUID;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS ai_summary_updated_at TIMESTAMPTZ;

COMMENT ON COLUMN conversations.ai_summary IS
  'Resumen rodante (~200 palabras) de los mensajes ANTERIORES a los últimos 20 visibles, generado por Claude Haiku. Se inyecta como pseudo-system message al armar el prompt.';

COMMENT ON COLUMN conversations.ai_summary_up_to_message_id IS
  'Último message.id que está cubierto por ai_summary. El compactador resume desde el siguiente en adelante.';

-- ── Default de ai_agents.context_messages: 10 → 30 ──
-- El runner usa el valor por agente como límite "soft"; cap duro
-- subido a 100 en runner.ts. Para agentes pre-existentes con el viejo
-- default de 10 sin tocar explícitamente, también lo subimos para que
-- arranquen con mejor memoria.
ALTER TABLE ai_agents ALTER COLUMN context_messages SET DEFAULT 30;
UPDATE ai_agents SET context_messages = 30 WHERE context_messages = 10;
