-- ============================================================
-- 145: avisar cuando una conexión necesita atención
-- ============================================================
--
-- El token de Mercado Pago vence a los 180 días. Con OAuth se renueva solo
-- y el comerciante no se entera nunca — que es como tiene que ser. Pero hay
-- dos casos en los que sí hay que avisarle, y hasta ahora los dos fallaban
-- en silencio:
--
--   1. Conectó pegando el token: no hay refresh que usar, así que el día
--      que vence la recuperación se apaga y nadie lo dice.
--   2. Conectó por OAuth pero el refresco falló — le revocó el permiso a la
--      aplicación desde su panel, o cambió el secreto. El token viejo
--      todavía anda un rato y después deja de andar.
--
-- `renew_failed_at` distingue el segundo del primero: sin él, la interfaz
-- sólo puede mirar la fecha de vencimiento y no sabe si el sistema está
-- renovando bien o viene fallando desde hace días.

ALTER TABLE workspace_integrations
  ADD COLUMN IF NOT EXISTS renew_failed_at TIMESTAMPTZ;

GRANT SELECT (renew_failed_at) ON public.workspace_integrations TO authenticated;

COMMENT ON COLUMN workspace_integrations.renew_failed_at IS
  'Cuándo falló el último intento de renovar el token. NULL = la última renovación salió bien o nunca hizo falta. Es lo que separa "vence pronto y se va a renovar solo" de "vence pronto y hay que reconectar a mano".';
