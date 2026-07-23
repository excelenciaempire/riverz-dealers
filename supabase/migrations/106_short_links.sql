-- Short links (redirección propia para botones URL dinámicos de plantillas).
--
-- Los botones URL de WhatsApp solo admiten una variable al FINAL de la URL y
-- con dominio FIJO: `https://dominio-fijo/{{1}}`. El dominio no puede variar.
-- Pero los links de Shopify por cliente viven en dominios distintos (la tienda
-- para el carrito/estado del pedido, el transportador para el tracking). La
-- solución: el botón aprobado por Meta apunta siempre a `riverz.co/r/{{1}}`, y
-- al enviar se genera un token corto por cliente que redirige a su link real.
-- Un único template estable sirve para todos los tipos de link.
CREATE TABLE IF NOT EXISTS short_links (
  token TEXT PRIMARY KEY,
  target_url TEXT NOT NULL,
  workspace_id UUID NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  contact_id UUID REFERENCES contacts (id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_clicked_at TIMESTAMPTZ,
  click_count INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_short_links_workspace ON short_links (workspace_id);

-- Solo el service-role (endpoint de redirección + motor de automatizaciones)
-- toca esta tabla; sin políticas, RLS bloquea todo acceso anónimo/cliente.
ALTER TABLE short_links ENABLE ROW LEVEL SECURITY;
