-- ============================================================
-- 207: Cualquier atajo se puede eliminar
-- ============================================================
-- Los dos atajos base ("/saludo" y "/gracias") vivían en el código del
-- composer, así que no había fila que borrar: el asesor los veía en el
-- picker para siempre. Ahora "borrar" un atajo base deja una lápida: una
-- fila con hidden = true para ese shortcut. El picker esconde tanto la
-- lápida como el atajo base que representa.
--
-- Aplicada A MANO por la Management API (no corre en el deploy de Render).
-- ============================================================

ALTER TABLE message_snippets
  ADD COLUMN IF NOT EXISTS hidden BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN message_snippets.hidden IS
  'Lápida: el workspace eliminó este atajo (incluidos los base del composer).';
