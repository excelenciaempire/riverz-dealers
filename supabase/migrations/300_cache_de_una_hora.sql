-- 300 — La escritura de caché de una hora, aparte
--
-- El prompt del asistente se manda en capas (ver `SystemPorCapas` en
-- `src/lib/ai/tools.ts`): lo del agente y la ficha del producto con la caché
-- de una hora, que se comparte entre chats, y lo de cada persona con la de
-- cinco minutos. Una misma respuesta escribe con las dos, y cuestan distinto:
-- 2x la entrada la de una hora, 1,25x la de cinco minutos.
--
-- `cache_write_tokens` guarda el total y no alcanza para tarifar. Esta columna
-- guarda la parte de una hora, que la API informa en
-- `usage.cache_creation.ephemeral_1h_input_tokens`. Las filas anteriores
-- quedan en NULL: para ellas manda la fecha (`ttlDeCacheDelAsistente`).

ALTER TABLE ai_replies
  ADD COLUMN IF NOT EXISTS cache_write_1h_tokens INT;

COMMENT ON COLUMN ai_replies.cache_write_1h_tokens IS
  'Parte de cache_write_tokens escrita con la caché de una hora (2x la entrada). NULL en filas anteriores a la migración 300.';
