-- ============================================================
-- 144: Mercado Pago por OAuth (conectar con un clic)
-- ============================================================
--
-- Hasta ahora el comerciante pegaba su Access Token Y pegaba la URL de
-- avisos en el panel de Mercado Pago: dos pasos manuales en una consola
-- ajena, y el que se equivocaba en uno quedaba con la automatización
-- encendida y muda.
--
-- Con OAuth los dos pasos desaparecen. El token lo emite Mercado Pago al
-- autorizar —con refresh, porque vence a los 180 días— y la URL de avisos
-- se configura UNA vez en la aplicación, no por comercio: todos notifican
-- al mismo lugar y el aviso trae el `user_id` del vendedor, que es con lo
-- que se resuelve de quién es.
--
-- El camino del token pegado sigue vivo: sirve para una cuenta que no
-- quiera autorizar la aplicación. Por eso las columnas son opcionales.

ALTER TABLE workspace_integrations
  ADD COLUMN IF NOT EXISTS refresh_token_encrypted TEXT,
  -- Id de la cuenta en el proveedor. Para Mercado Pago es el `user_id` del
  -- vendedor, la única pista que trae la notificación para saber a qué
  -- workspace pertenece.
  ADD COLUMN IF NOT EXISTS external_account_id TEXT,
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;

-- Búsqueda del webhook: proveedor + cuenta. Único porque una misma cuenta
-- de Mercado Pago no puede estar conectada a dos workspaces a la vez — si
-- lo estuviera, el aviso no diría a cuál de los dos pertenece.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_integration_external_account
  ON workspace_integrations (provider, external_account_id)
  WHERE external_account_id IS NOT NULL;

-- Las columnas nuevas que NO son secretas se pueden leer desde la app.
-- `refresh_token_encrypted` queda fuera a propósito, igual que
-- `api_key_encrypted` (migración 078).
GRANT SELECT (external_account_id, expires_at)
  ON public.workspace_integrations TO authenticated;

COMMENT ON COLUMN workspace_integrations.refresh_token_encrypted IS
  'Token de refresco de OAuth, encriptado. NULL cuando la conexión se hizo pegando una API key en vez de autorizar la aplicación.';

COMMENT ON COLUMN workspace_integrations.external_account_id IS
  'Id de la cuenta en el proveedor (para Mercado Pago, el user_id del vendedor). Es lo que permite resolver a qué workspace pertenece una notificación entrante.';

COMMENT ON COLUMN workspace_integrations.expires_at IS
  'Cuándo vence el access token. Mercado Pago da 180 días; sin refresh la recuperación se apaga sola y en silencio.';
