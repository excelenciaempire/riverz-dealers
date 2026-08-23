-- ============================================================
-- 184: "no son el mismo producto"
-- ============================================================
-- La detección propone grupos cada vez que se mira la pantalla. Sin forma de
-- decir que no, la misma propuesta equivocada vuelve para siempre: el comercio
-- la ignora, aprende a ignorar el panel entero, y el día que la propuesta es
-- buena tampoco la mira.
--
-- Se guarda el grupo, no los productos sueltos: que A y B no sean el mismo no
-- dice nada sobre A y C. La clave es la lista de ids ordenada, así que el
-- mismo grupo propuesto de nuevo —en otro orden, tras otra sincronización— se
-- reconoce igual.
CREATE TABLE IF NOT EXISTS product_unify_dismissed (
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  -- Los ids del grupo, ordenados y unidos por coma.
  group_key text NOT NULL,
  dismissed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, group_key)
);

ALTER TABLE product_unify_dismissed ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS product_unify_dismissed_miembros ON product_unify_dismissed;
CREATE POLICY product_unify_dismissed_miembros ON product_unify_dismissed
  FOR ALL
  USING (is_workspace_member(workspace_id))
  WITH CHECK (is_workspace_member(workspace_id));
