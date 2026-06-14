-- ============================================================
-- 033: flow_runs.call_stack — soporte de ejecución de subflujos
-- ============================================================
--
-- Cuando un run entra a un nodo de tipo `subflow`, el engine empuja un
-- frame con el flow_id del subflujo y el node_key del padre al que
-- hay que volver. Cuando el subflujo termina (end/handoff), pop del
-- frame y se continúa en el flujo padre.
--
-- Forma del JSON:
--   [{ flow_id: uuid, return_to_node_key: text }, ...]
--
-- El TOP del array es el subflujo MÁS PROFUNDO. La pila vacía significa
-- que el run está ejecutando el flujo raíz (run.flow_id).
--
-- Depth máxima: 5 (enforced en código). Si se excede, el run termina
-- con razón `subflow_max_depth`.

ALTER TABLE flow_runs
  ADD COLUMN IF NOT EXISTS call_stack JSONB NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN flow_runs.call_stack IS
  'Pila de frames {flow_id, return_to_node_key} mientras el run ejecuta subflujos. Vacío = ejecutando el flujo raíz. Migration 033.';
