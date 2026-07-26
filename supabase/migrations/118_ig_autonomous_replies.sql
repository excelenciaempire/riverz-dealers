-- ============================================================
-- 118 — Instagram: piso autónomo de respuesta a comentarios.
--
-- Hasta ahora el agente solo actuaba si había una campaña ACTIVA. Sin campaña,
-- un comentario que dice "cuánto vale?" no recibía nada: ni respuesta pública
-- (bloqueada por App Review) ni DM. El comercio veía la bandeja llenarse de
-- intención de compra sin atender.
--
-- Este piso hace que el agente conteste SIEMPRE a quien muestra intención de
-- compra, haya campaña o no, con la voz del agente de IA que el comercio ya
-- configuró para Instagram. Encendido por defecto (autonomía), y sujeto a los
-- mismos frenos que todo lo proactivo: pausa de emergencia, tope diario, una
-- sola respuesta privada por comentario y baja del contacto.
--
--   auto_reply_comments — interruptor del piso autónomo (ON por defecto).
-- ============================================================

ALTER TABLE ig_proactive_settings
  ADD COLUMN IF NOT EXISTS auto_reply_comments BOOLEAN NOT NULL DEFAULT TRUE;
