-- Por qué no se contestó un comentario.
--
-- El piso autónomo de Comentarios no pasa por el runner y por lo tanto no
-- escribía NADA en `ai_replies`: un comentario sin respuesta era indistinguible
-- de un fallo. El 2026-08-29, de 16 comentarios en 48 h, nueve quedaron sin
-- responder y ninguno dejó una sola fila que lo explicara.
--
-- Para que pueda escribir ahí hace falta esto: `agent_id` era NOT NULL, y
-- Comentarios se gobierna solo — contesta con la marca y el catálogo aunque no
-- haya ningún asistente configurado (`NO_AGENT` en instagram-agent/agent-link).
-- Atar la fila a un agente inventado sería mentir sobre quién decidió.
--
-- Los lectores ya lo toleraban: `dashboard/cortes.ts` agrupa con
-- `agent_id ?? 'sin-agente'` y `admin/logs.ts` lo tipa `string | null`. Lo
-- único que faltaba era la columna.

ALTER TABLE public.ai_replies ALTER COLUMN agent_id DROP NOT NULL;

COMMENT ON COLUMN public.ai_replies.agent_id IS
  'El asistente que decidió. NULL = lo decidió Comentarios, que se gobierna solo y responde sin agente configurado.';
