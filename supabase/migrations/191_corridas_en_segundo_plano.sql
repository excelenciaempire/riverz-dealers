-- 191 — El turno sigue aunque cierres la pestaña
--
-- El trabajo del Operador vivía dentro del `ReadableStream` de la respuesta: si
-- el navegador se iba —cambiar de pantalla, cerrar la pestaña, perder señal— el
-- stream se cortaba y con él el turno. Al volver, la conversación mostraba el
-- pedido y ninguna respuesta, como si nunca hubiera pasado nada. Y un turno con
-- reparto tarda minutos: irse a mirar otra cosa mientras tanto es lo normal, no
-- el caso raro.
--
-- Ahora el turno es una CORRIDA con vida propia. Empieza cuando alguien pide
-- algo y termina cuando termina, mire alguien o no. La fila es dónde vive
-- mientras tanto:
--
-- - `texto` y `bloques` son la foto de cómo va, actualizada cada tanto. Al
--   volver, la pantalla la lee y sigue mirando desde ahí en vez de empezar de
--   cero. Es el mismo formato que ya se guarda con el mensaje terminado, así
--   que no hay una segunda forma de los datos que pueda quedar desincronizada.
-- - `cancelar` es el botón de detener. Se pide acá y el turno lo mira entre una
--   vuelta y la siguiente: cortar a mitad de una llamada al modelo dejaría a
--   medio hacer justo lo que se estaba haciendo.
--
-- Una corrida viva por hilo: dos turnos a la vez sobre la misma conversación se
-- pisarían el contexto.
--
-- Sin RLS: sólo entra la llave de servicio. Idempotente.

CREATE TABLE IF NOT EXISTS operator_runs (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  thread_id    UUID NOT NULL REFERENCES operator_threads(id) ON DELETE CASCADE,
  estado       TEXT NOT NULL DEFAULT 'corriendo'
               CHECK (estado IN ('corriendo', 'listo', 'fallido', 'detenido')),
  -- Lo pide la pantalla; lo mira el turno entre vueltas.
  cancelar     BOOLEAN NOT NULL DEFAULT FALSE,
  -- Cómo va, en el mismo formato que el mensaje terminado.
  texto        TEXT NOT NULL DEFAULT '',
  bloques      JSONB NOT NULL DEFAULT '[]'::jsonb,
  error        TEXT,
  started_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at  TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS operator_runs_viva_idx
  ON operator_runs (thread_id)
  WHERE estado = 'corriendo';

CREATE INDEX IF NOT EXISTS operator_runs_ws_idx
  ON operator_runs (workspace_id, started_at DESC);

COMMENT ON TABLE operator_runs IS
  'Un turno del Operador con vida propia: sigue aunque nadie esté mirando, y se corta sólo si alguien pide detenerlo.';
