-- ============================================================
-- 229 - El indice que hacia fallar todo upsert de reglas
-- ============================================================
--
-- `uq_guidance_clave` era un indice unico PARCIAL:
--
--   CREATE UNIQUE INDEX ... ON agent_guidance (workspace_id, clave)
--   WHERE (clave IS NOT NULL)
--
-- Postgres no acepta `ON CONFLICT (workspace_id, clave)` contra un indice
-- parcial sin repetir el predicado, y PostgREST no lo repite: no tiene forma
-- de expresarlo en `on_conflict=`. Asi que TODO upsert de reglas fallaba con
-- 42P10 — la siembra del pliego (`sembrarReglasDelPliego`), la de las reglas
-- base y la que convierte un hueco en regla. Las dos primeras estan envueltas
-- en try/catch, asi que fallaban sin decir nada.
--
-- El predicado ademas nunca hizo falta: Postgres trata los NULL como
-- DISTINTOS en un indice unico, asi que un unique comun sobre
-- (workspace_id, clave) ya deja repetir todas las filas con `clave IS NULL`
-- —las reglas que el comercio escribe a mano— que es lo unico que el WHERE
-- estaba protegiendo.
--
-- Aplicada A MANO por la Management API (no corre en el deploy de Render).
-- ============================================================

DROP INDEX IF EXISTS uq_guidance_clave;

ALTER TABLE agent_guidance
  ADD CONSTRAINT uq_guidance_clave UNIQUE (workspace_id, clave);

COMMENT ON CONSTRAINT uq_guidance_clave ON agent_guidance IS
  'Una regla por (cuenta, clave). Las de clave NULL —las que el comercio escribe a mano— no se limitan: Postgres trata los NULL como distintos.';
