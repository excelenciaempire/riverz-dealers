-- 185 — Deshacer lo que el Operador hizo
--
-- Aprobar era definitivo. El único recurso frente a algo que salió mal era
-- pedirle al chat que armara lo contrario y confiar en que lo armara bien: sobre
-- una automatización recién creada eso significa dictar un borrado, y si el
-- modelo se equivoca de id borra otra.
--
-- La fila ya guarda todo lo que hace falta para volver atrás —los argumentos
-- aprobados y el `result` con el id de lo que quedó—. Lo que faltaba era un
-- estado que lo diga y la marca de quién lo deshizo, para que la auditoría
-- muestre las dos decisiones y no sólo la primera.
--
-- `deshecho` es un estado nuevo, no un borrado: la acción ocurrió y después se
-- revirtió. Borrarla escondería que pasó, que es justo lo contrario de lo que
-- tiene que hacer un registro.
--
-- Idempotente.

ALTER TABLE operator_actions
  ADD COLUMN IF NOT EXISTS undone_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS undone_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;

-- El CHECK viejo no conoce 'deshecho'. Se reemplaza en vez de agregarse: dos
-- CHECK sobre la misma columna se cumplen los dos, así que el viejo seguiría
-- rechazando el estado nuevo.
DO $$
BEGIN
  ALTER TABLE operator_actions DROP CONSTRAINT IF EXISTS operator_actions_status_check;
  ALTER TABLE operator_actions
    ADD CONSTRAINT operator_actions_status_check
    CHECK (status IN ('propuesto', 'ejecutado', 'rechazado', 'fallido', 'deshecho'));
END $$;

COMMENT ON COLUMN operator_actions.undone_at IS
  'Cuándo se revirtió. La acción ocurrió igual: el estado pasa a deshecho, no se borra la fila.';
