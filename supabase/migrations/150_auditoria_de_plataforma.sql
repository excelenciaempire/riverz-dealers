-- ============================================================
-- 150: qué tocó la plataforma en la cuenta de un comercio
-- ============================================================
--
-- El MCP interno opera sobre datos de clientes reales: la cuenta de Pilar no
-- es "la de casa", es un comercio con sus 3.264 contactos. Cuando mañana
-- pregunten por qué se activó una automatización o quién marcó un pedido como
-- pagado, tiene que haber una respuesta que no dependa de la memoria de nadie.
--
-- Se anota TODO lo que entra por la puerta de la plataforma, incluidas las
-- lecturas: saber quién miró qué es parte de operar cuentas ajenas.

CREATE TABLE IF NOT EXISTS platform_audit_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  -- Sobre qué cuenta se operó. NULL para las herramientas que no miran
  -- ninguna en particular (listar cuentas, estado de los crons).
  workspace_id UUID REFERENCES workspaces(id) ON DELETE SET NULL,
  -- Quién: el correo del administrador de plataforma, no un uuid, porque lo
  -- que se quiere leer seis meses después es un nombre.
  actor TEXT NOT NULL,
  tool TEXT NOT NULL,
  args JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- 'lectura' | 'reversible' | 'irreversible': para poder filtrar de un
  -- vistazo lo que cambió algo.
  risk TEXT NOT NULL DEFAULT 'lectura',
  ok BOOLEAN NOT NULL DEFAULT TRUE,
  -- Un resumen de lo que pasó, no la respuesta entera: el registro se lee, no
  -- se procesa.
  summary TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_platform_audit_workspace
  ON platform_audit_log (workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_platform_audit_riesgo
  ON platform_audit_log (created_at DESC)
  WHERE risk <> 'lectura';

ALTER TABLE platform_audit_log ENABLE ROW LEVEL SECURITY;
-- Sin políticas: sólo service-role. Se lee desde /admin, que va por la clave
-- de servicio. Un comercio no debería poder borrar el registro de lo que le
-- hicieron, así que tampoco se le da acceso de escritura.

COMMENT ON TABLE platform_audit_log IS
  'Qué hizo la plataforma (MCP interno, /admin) sobre la cuenta de cada comercio. Incluye lecturas.';
