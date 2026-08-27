-- ============================================================
-- 201: por qué dijo eso, y qué contarle a quien recibe el hilo
-- ============================================================
-- Dos huecos que se ven recién cuando algo sale mal.
--
-- 1) `ai_replies` guardaba cuánto costó la respuesta y por qué se abstuvo,
--    pero no QUÉ HIZO para contestar. Cuando el comercio pregunta "¿de dónde
--    sacó ese plazo de entrega?", la respuesta casi siempre es una de dos:
--    consultó el pedido, o no consultó nada. Sin la lista de herramientas no
--    hay forma de distinguirlas, y tampoco de saber con qué modelo salió esa
--    respuesta el día que se cambia el modelo.
--
-- 2) Cuando la IA escala, la persona que toma el hilo hereda un resumen
--    rodante de la conversación —útil, pero escrito para otra cosa: cuenta de
--    qué se habló, no qué se intentó ni por qué se traba. El resumen de
--    traspaso es lo que le ahorra a esa persona leer veinte mensajes para
--    descubrir que el problema era que el pedido no aparece.
--
-- Ninguna de las dos cambia comportamiento: son columnas que se llenan y se
-- leen. Idempotente. Se aplica a mano por la Management API.

ALTER TABLE ai_replies
  ADD COLUMN IF NOT EXISTS tools_used TEXT[],
  ADD COLUMN IF NOT EXISTS model TEXT;

COMMENT ON COLUMN ai_replies.tools_used IS
  'Herramientas que llamó para contestar, en orden y con repeticiones. Vacío = contestó sólo con lo que tenía en el prompt.';
COMMENT ON COLUMN ai_replies.model IS
  'Con qué modelo salió esta respuesta. Sin esto, comparar antes y después de cambiarlo es adivinar.';

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS needs_human_summary TEXT;

COMMENT ON COLUMN conversations.needs_human_summary IS
  'Qué pasó, qué se intentó y por qué escala. Escrito PARA quien recibe el hilo, no para resumir la conversación.';
