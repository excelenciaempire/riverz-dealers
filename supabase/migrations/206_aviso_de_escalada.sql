-- 206 — Avisar por WhatsApp cuando un caso necesita una persona.
--
-- Marcar el hilo ya se hacía, pero eso sólo se ve entrando a la bandeja. Un
-- envío que va a la ciudad equivocada se arregla en la hora siguiente o no se
-- arregla, y nadie mira la bandeja a las dos de la mañana.
--
-- `needs_human_avisado_at` es además el candado: se marca ANTES de mandar, así
-- dos caminos que escalan el mismo hilo a la vez no avisan dos veces. El mismo
-- problema avisado tres veces enseña a ignorar el cuarto.
ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS needs_human_avisado_at TIMESTAMPTZ;

COMMENT ON COLUMN conversations.needs_human_avisado_at IS
  'Cuándo salió el aviso de escalada. NULL = todavía no se avisó.';

-- A qué número se avisa. Sin esto se cae al teléfono del dueño de la cuenta,
-- que es el único que ya teníamos; el comercio puede querer otro (el del
-- encargado de turno, un grupo de guardia).
ALTER TABLE workspaces
  ADD COLUMN IF NOT EXISTS alert_phone TEXT;

COMMENT ON COLUMN workspaces.alert_phone IS
  'Número de WhatsApp para los avisos de casos que necesitan una persona.';

-- Y cuando alguien ABRE el hilo escalado, deja de estar pendiente. La bandeja
-- lo marca urgente mientras esto sea NULL: 'escalado' y 'alguien lo miro' son
-- dos hechos distintos, y mezclarlos rompe los filtros y las metricas que
-- dependen de needs_human_at.
ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS needs_human_visto_at TIMESTAMPTZ;

COMMENT ON COLUMN conversations.needs_human_visto_at IS
  'Cuando alguien abrio el hilo escalado. Mientras sea NULL, la bandeja lo marca como urgente.';
