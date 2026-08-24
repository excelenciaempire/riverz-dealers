-- Shopify: tokens que expiran.
--
-- Shopify dio de baja los tokens que no expiran. Medido el 2026-08-24: dos
-- tiendas conectadas ese dia —una por OAuth completo, con los permisos nuevos
-- concedidos— responden a un simple `/shop.json`:
--
--   [API] Non-expiring access tokens are no longer accepted for the Admin API.
--   Start using expiring offline tokens.
--
-- O sea que toda conexion nueva nacia muerta, y reconectar no arreglaba nada.
--
-- El token nuevo dura una hora y viene con un `refresh_token` que vale 90 dias.
-- Eso es lo que guardan estas columnas. Se refresca del lado del servidor, sin
-- que el comercio tenga que hacer nada.
--
-- Nullable a proposito: las conexiones viejas que todavia andan (token `shpca_`)
-- no tienen ninguno de los tres, y tienen que seguir andando hasta que Shopify
-- tambien las corte.

alter table shopify_connections
  add column if not exists token_expires_at timestamptz,
  add column if not exists refresh_token_encrypted text,
  add column if not exists refresh_token_expires_at timestamptz;

comment on column shopify_connections.token_expires_at is
  'Cuando vence el access_token. NULL = token viejo que no expira.';
comment on column shopify_connections.refresh_token_encrypted is
  'Refresh token cifrado. Con el se renueva el acceso sin tocar al comercio.';
comment on column shopify_connections.refresh_token_expires_at is
  'Cuando vence el refresh_token (90 dias). Pasado eso hay que reconectar de verdad.';

-- Para el cron que renueve antes de que venzan: sin esto hay que recorrer la
-- tabla entera para encontrar las pocas que estan por vencer.
create index if not exists shopify_connections_token_expira_idx
  on shopify_connections (token_expires_at)
  where token_expires_at is not null and status = 'active';
