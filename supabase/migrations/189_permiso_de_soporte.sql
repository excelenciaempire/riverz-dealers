-- 189 — Permiso de soporte: el comercio abre la puerta, y se cierra sola
--
-- El panel de plataforma nunca pudo leer una conversación de un comercio, y esa
-- barrera es deliberada: los mensajes son de los clientes DE un comercio, gente
-- que nunca aceptó nada con Riverz y a la que la política de privacidad le
-- promete que sus datos se quedan en la cuenta.
--
-- El precio de esa promesa es que cuando un comercio escribe «la IA no me
-- contesta», soporte tiene que pedirle capturas. Esto resuelve las dos cosas sin
-- romper ninguna: **lo abre el comercio, no nosotros**, y se cierra solo.
--
-- Tres decisiones que importan:
--
-- 1. **Vence siempre.** No hay forma de dar permiso para siempre desde la UI:
--    un permiso sin vencimiento es un permiso que nadie se acuerda de sacar.
-- 2. **Lo concede una persona identificada**, y queda escrito quién y por qué.
--    Sin eso, dentro de seis meses «alguien de la cuenta lo autorizó» no es una
--    respuesta.
-- 3. **La fila no se borra al revocar**: se le pone `revoked_at`. Que el permiso
--    existió es parte del registro, igual que las lecturas que se hicieron.
--
-- Sin RLS: la escribe la app con llave de servicio, tras comprobar que quien
-- pide es admin del workspace. Idempotente.

CREATE TABLE IF NOT EXISTS support_access (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  granted_by   UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  granted_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Cuándo se cierra sola. Obligatoria: no existe el permiso eterno.
  expires_at   TIMESTAMPTZ NOT NULL,
  revoked_at   TIMESTAMPTZ,
  -- Para qué se abrió. Lo escribe el comercio.
  reason       TEXT
);

-- Un solo permiso vigente por cuenta: dos ventanas abiertas al mismo tiempo son
-- una que nadie recuerda haber abierto.
CREATE UNIQUE INDEX IF NOT EXISTS support_access_vigente_idx
  ON support_access (workspace_id)
  WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS support_access_expira_idx
  ON support_access (expires_at DESC);

COMMENT ON TABLE support_access IS
  'Ventana con vencimiento en la que soporte puede leer las conversaciones de un comercio. La abre el comercio; nunca el equipo.';
