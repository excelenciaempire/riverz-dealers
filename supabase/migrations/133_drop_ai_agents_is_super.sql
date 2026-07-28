-- ============================================================
-- 133 — Se quita ai_agents.is_super (migración 131).
--
-- El "Super Agente" nació como interruptor por agente: encendido, el agente
-- completo escribía también la primera respuesta a un comentario. Duró unas
-- horas. La decisión de producto fue que eso no es una opción sino la conducta
-- normal — "Responder con IA" ya promete que contesta la IA, y pedir un segundo
-- botón para que esa IA pudiera hacer algo era exponer una distinción que solo
-- existía por dentro.
--
-- Hoy el camino de comentarios usa siempre el agente completo y cae al redactor
-- de una pasada solo si falla, así que ninguna rama lee esta columna. Una
-- columna que nadie lee es una pregunta sin respuesta para el próximo que abra
-- la tabla: se borra.
--
-- Idempotente. Se aplica A MANO por la Management API.
-- ============================================================

ALTER TABLE public.ai_agents DROP COLUMN IF EXISTS is_super;

DROP INDEX IF EXISTS idx_ai_agents_workspace_super;
