-- ============================================================
-- 229 - Las ventas que Riverz cerro y no puede probar
-- ============================================================
--
-- "Ventas por Riverz" cuenta solo los pedidos que traen una marca nuestra: un
-- link de pago del asistente, un carrito del chat web, un cupon emitido a una
-- persona. Es a proposito, y no se toca: una cifra inflada se cae el dia que
-- el comercio la discute.
--
-- Pero hay una venta que Riverz SI cerro y no puede probar: la que se cierra
-- hablando y despues alguien carga a mano en la tienda. No pasa por ningun
-- camino nuestro, asi que no deja marca en ningun lado. Para el panel esa
-- venta es del comercio, y el comercio ve una cifra mas chica que su realidad
-- sin que nadie le explique por que.
--
-- No hay forma de deducirlo mirando los datos: un pedido cargado a mano es
-- indistinguible de uno que el cliente hizo solo en la tienda. Se midio sobre
-- la base entera el 2026-08-30 y el resultado fue ambiguo justamente por eso.
-- El unico que sabe la respuesta es el comercio, asi que se le pregunta — una
-- vez, y en el lugar donde la pregunta se entiende sola: al lado de la cifra.
--
-- La respuesta no cambia ninguna metrica. Cambia lo que el detalle de la
-- cifra le explica al comercio, y nos dice a nosotros si vale la pena
-- construir el camino que falta (crear el pedido desde la conversacion, para
-- que esas ventas nazcan con marca en vez de perderse).
--
--   NULL          no contesto. Es el estado de todos y no se asume nada.
--   'seguido'     cierra ventas hablando casi todos los dias.
--   'a_veces'     pasa, pero no es lo habitual.
--   'casi_nunca'  el cliente compra solo en la tienda.
--
-- Aplicada A MANO por la Management API (no corre en el deploy de Render).
-- ============================================================

ALTER TABLE workspaces
  ADD COLUMN IF NOT EXISTS ventas_a_mano TEXT,
  ADD COLUMN IF NOT EXISTS ventas_a_mano_at TIMESTAMPTZ;

-- El CHECK va aparte de la columna: con ADD COLUMN IF NOT EXISTS, si la
-- columna ya existiera el CHECK inline se saltaria en silencio.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'workspaces_ventas_a_mano_check'
  ) THEN
    ALTER TABLE workspaces
      ADD CONSTRAINT workspaces_ventas_a_mano_check
      CHECK (ventas_a_mano IN ('seguido', 'a_veces', 'casi_nunca'));
  END IF;
END $$;

COMMENT ON COLUMN workspaces.ventas_a_mano IS
  'Cuanto vende el comercio cerrando por chat y cargando el pedido a mano — ventas que Riverz causa y no puede probar. seguido | a_veces | casi_nunca. NULL = no contesto, y no se asume nada.';

COMMENT ON COLUMN workspaces.ventas_a_mano_at IS
  'Cuando contesto. Sirve para volver a preguntar si la respuesta quedo vieja.';

-- ── Los permisos, que no son opcionales ──────────────────────────────────
--
-- `workspaces` tiene permisos POR COLUMNA para `authenticated`: hoy las 17
-- columnas los tienen, una por una. Una columna nueva nace SIN permiso, y eso
-- no rompe solo esta pantalla — rompe el `select *` con el que la aplicacion
-- entera lee el workspace (useWorkspace), porque Postgres verifica columna por
-- columna al expandir el asterisco. O sea: sin este GRANT, agregar la columna
-- deja a todo el mundo sin workspace.
--
-- SELECT porque el panel decide si preguntar mirando el valor; UPDATE porque
-- la respuesta la escribe el propio comercio desde el navegador (la politica
-- "Admins can update workspaces" ya recorta quien puede).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.role_column_grants
    WHERE table_schema = 'public' AND table_name = 'workspaces'
      AND grantee = 'authenticated' AND privilege_type = 'SELECT'
    LIMIT 1
  ) THEN
    GRANT SELECT (ventas_a_mano, ventas_a_mano_at) ON public.workspaces TO authenticated;
    GRANT UPDATE (ventas_a_mano, ventas_a_mano_at) ON public.workspaces TO authenticated;
  END IF;
END $$;
