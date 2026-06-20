-- ============================================================
-- 082 — Per-conversation AI toggle
-- ============================================================
--
-- Permite prender/apagar el asistente IA en cada chat de la bandeja. El
-- runner ya respeta "responder aunque haya agente asignado"
-- (agent.reply_when_assigned + conversation.assigned_agent_id); este flag
-- es un control manual por conversación que se suma a esa lógica: si está
-- en false, la IA no responde en ese chat, sin importar lo demás.
--
-- Default true → comportamiento actual intacto (la IA responde salvo que
-- el chat la apague o aplique la regla de agente asignado). Idempotente.
-- Aplicar vía Management API (manual).
-- ============================================================

ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS ai_enabled boolean NOT NULL DEFAULT true;
