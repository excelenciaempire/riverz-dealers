-- 215 — Los tokens de caché, que faltaban en toda la cuenta
--
-- `ai_replies` guardaba `prompt_tokens` y `completion_tokens`, y con eso se
-- calculaba lo que cuesta la IA: el costo por comercio del panel, el margen del
-- negocio y —desde la billetera— lo que se le descuenta a la cuenta que paga a
-- costo.
--
-- El problema es que **`input_tokens` de Anthropic NO incluye lo que se leyó de
-- la caché**, y el prompt del sistema va cacheado (`cache_control`). O sea que
-- el número que se venía usando como "el costo" era un piso: le faltaba la
-- lectura de caché (cuesta una décima parte del token de entrada) y la
-- escritura (cuesta un 25% más). Con margen se notaba poco; a costo, se le
-- estaba cobrando de menos al cliente todos los días.
--
-- Estas dos columnas cierran ese hueco. Las filas viejas quedan en NULL y se
-- leen como cero: no se puede reconstruir lo que la API no dijo, y rellenarlas
-- con una estimación sería inventar precisión que no existe.

ALTER TABLE ai_replies
  ADD COLUMN IF NOT EXISTS cache_read_tokens INT,
  ADD COLUMN IF NOT EXISTS cache_write_tokens INT;

COMMENT ON COLUMN ai_replies.cache_read_tokens IS
  'Tokens servidos desde la caché de prompts. Cuestan ~10% de un token de entrada y NO vienen dentro de prompt_tokens.';
COMMENT ON COLUMN ai_replies.cache_write_tokens IS
  'Tokens que costó escribir la caché. Cuestan ~25% más que un token de entrada; se pagan una vez y se amortizan en las lecturas siguientes.';
