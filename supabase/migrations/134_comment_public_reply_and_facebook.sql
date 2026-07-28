-- ============================================================
-- 134 — Comentarios: responder en público, y contestar también Facebook.
--
-- 1. comment_public_reply
--
-- Hasta ahora la IA solo mandaba un DM privado. Quien pasaba por el post veía
-- un comentario sin contestar aunque la persona ya tuviera su respuesta —para
-- el resto del mundo, la marca no atendía.
--
-- El texto público NO repite el privado: el DM lleva precios, códigos y datos
-- del pedido, y bajo una foto eso se lee como spam (además Meta corta los
-- comentarios largos). Se publica una línea corta avisando de que la respuesta
-- salió por privado.
--
-- Requiere los permisos de comentarios de Meta (`pages_manage_engagement`,
-- `instagram_manage_comments`). Sin ellos el DM sale igual y solo falla la
-- parte pública, que va en su propio try y se registra. Por eso arranca en
-- FALSE: se enciende cuando los permisos estén aprobados.
--
-- 2. comment_facebook
--
-- La IA nunca contestó un comentario de Facebook. El router lo cortaba con la
-- razón "en Facebook no existe la respuesta privada por comentario" — que es
-- falsa: el motor de reglas lleva tiempo mandándolas por Messenger. Una red
-- entera muda por un comentario equivocado en el código.
--
-- Arranca en FALSE para que nadie estrene conducta nueva sin pedirla.
--
-- Idempotente. Se aplica A MANO por la Management API.
-- ============================================================

ALTER TABLE ig_proactive_settings
  ADD COLUMN IF NOT EXISTS comment_public_reply BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS comment_facebook BOOLEAN NOT NULL DEFAULT FALSE;
