-- ============================================================
-- 159 — Llaves de MCP que sólo pueden leer
-- ============================================================
--
-- Una llave que puede mandarle un WhatsApp a un cliente y una llave que sólo
-- contesta preguntas no valen lo mismo si se filtran, y hasta acá eran la misma
-- llave. Para conectar un tablero, un análisis o un agente que sólo consulta, no
-- hay ninguna razón para entregar la capacidad de escribir.
--
-- Dos valores y no un sistema de permisos por herramienta: la línea que
-- realmente importa es "¿puede cambiar algo?", y un catálogo de permisos finos
-- que nadie entiende termina en que todos eligen el más ancho.
--
--   lectura — sólo las herramientas que no cambian nada.
--   total   — todas, con la confirmación de siempre para lo irreversible.
--
-- Las llaves que ya existían quedan en `total`, que es lo que podían hacer
-- cuando se crearon: una migración no puede quitarle capacidades a algo que ya
-- está andando en el flujo de alguien.
--
-- Idempotente. Se aplica a mano por la Management API.
-- ============================================================

ALTER TABLE public.mcp_tokens
  ADD COLUMN IF NOT EXISTS scope TEXT NOT NULL DEFAULT 'total';

ALTER TABLE public.mcp_tokens
  DROP CONSTRAINT IF EXISTS mcp_tokens_scope_check;
ALTER TABLE public.mcp_tokens
  ADD CONSTRAINT mcp_tokens_scope_check CHECK (scope IN ('lectura', 'total'));
