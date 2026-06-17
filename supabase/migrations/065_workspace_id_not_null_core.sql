-- ============================================================
-- 065 — workspace_id NOT NULL en tablas core (DISRUPTIVA)
-- ============================================================
--
-- ⚠️  REVISAR Y PROBAR EN STAGING ANTES DE APLICAR EN PRODUCCIÓN.
--     Esta migración es de aplicación MANUAL (no corre en el deploy de
--     Render). Es segura por construcción: NO borra ninguna fila y, si
--     queda alguna fila sin workspace resoluble, ABORTA por completo
--     (transaccional) sin imponer NOT NULL — el operador revisa y asigna
--     a mano antes de reintentar.
--
-- Contexto: 013 añadió workspace_id a estas tablas legacy SIN NOT NULL, y
-- 015 quitó el NOT NULL de user_id. Las policies usan
-- `workspace_id IS NOT NULL AND is_workspace_member(...)`, así que una fila
-- con workspace_id NULL es invisible para todo cliente autenticado (segura
-- para LECTURA), pero crea un gap de integridad: cualquier insert vía el
-- cliente service-role (que bypassa RLS) que olvide setear workspace_id
-- produce filas huérfanas con PII que no pertenecen a ningún tenant y solo
-- son accesibles por service-role — justo lo que un bug de scoping podría
-- cruzar entre tenants. Imponer NOT NULL elimina esa clase de fila.
--
-- Backfill heurístico (igual que 055): workspace más antiguo del owner
-- (workspaces.owner_id = tabla.user_id). Las filas con user_id NULL o sin
-- workspace del owner quedan sin resolver y disparan el abort para que se
-- traten manualmente (no se borran).

DO $$
DECLARE
  t TEXT;
  tables TEXT[] := ARRAY[
    'contacts', 'tags', 'custom_fields', 'conversations',
    'message_templates', 'broadcasts', 'automations', 'flows'
  ];
  null_count INTEGER;
  remaining TEXT := '';
BEGIN
  -- 1) Backfill: workspace más antiguo del owner del user_id de la fila.
  FOREACH t IN ARRAY tables LOOP
    EXECUTE format($f$
      UPDATE %I tbl
      SET workspace_id = (
        SELECT w.id FROM workspaces w
        WHERE w.owner_id = tbl.user_id
        ORDER BY w.created_at ASC
        LIMIT 1
      )
      WHERE tbl.workspace_id IS NULL AND tbl.user_id IS NOT NULL
    $f$, t);
  END LOOP;

  -- 2) Si queda alguna huérfana, abortar TODO (no se aplica NOT NULL, no se
  --    borra nada). El operador la asigna manualmente y reintenta.
  FOREACH t IN ARRAY tables LOOP
    EXECUTE format('SELECT COUNT(*) FROM %I WHERE workspace_id IS NULL', t)
      INTO null_count;
    IF null_count > 0 THEN
      remaining := remaining || format('%s=%s ', t, null_count);
    END IF;
  END LOOP;
  IF remaining <> '' THEN
    RAISE EXCEPTION
      'Backfill de workspace_id incompleto (filas sin workspace resoluble): %. Asignar manualmente antes de imponer NOT NULL.',
      remaining;
  END IF;

  -- 3) Promover a NOT NULL ahora que toda fila tiene workspace.
  FOREACH t IN ARRAY tables LOOP
    EXECUTE format('ALTER TABLE %I ALTER COLUMN workspace_id SET NOT NULL', t);
  END LOOP;
END $$;
