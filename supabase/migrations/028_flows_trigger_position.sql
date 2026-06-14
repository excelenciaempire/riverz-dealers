-- ============================================================
-- 028: Posición persistida del disparador en el lienzo
-- ============================================================
-- Hasta ahora el disparador del menú vivía hard-codeado en
-- TRIGGER_POS = (80, 240) en flow-builder.tsx. El usuario pidió que
-- TODOS los elementos del lienzo se puedan mover, incluido el
-- disparador. Persistimos la posición a nivel `flows` (no nodes,
-- porque el disparador NO es un nodo — vive en flows.trigger_type /
-- trigger_config).
--
-- Defaults: 80, 240 — mismo punto que tenía antes para no perturbar
-- flujos existentes.

ALTER TABLE flows
  ADD COLUMN IF NOT EXISTS trigger_position_x NUMERIC NOT NULL DEFAULT 80,
  ADD COLUMN IF NOT EXISTS trigger_position_y NUMERIC NOT NULL DEFAULT 240;

COMMENT ON COLUMN flows.trigger_position_x IS
  'Coordenada X del disparador en el lienzo del editor (0-6000). Default 80.';
COMMENT ON COLUMN flows.trigger_position_y IS
  'Coordenada Y del disparador en el lienzo del editor (0-4000). Default 240.';
