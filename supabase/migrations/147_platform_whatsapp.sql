-- ============================================================
-- 147: el WhatsApp de Riverz, separado del de los comercios
-- ============================================================
--
-- Los avisos operativos ("tu WhatsApp está bloqueado", "un cliente espera")
-- no pueden salir por el número de un comercio: si el canal que se vigila es
-- el mismo que avisa, el aviso que más importa es justo el que no se entrega.
-- Y con muchos comercios, la plataforma tiene que poder escribirle a
-- cualquiera sin entrar a ningún espacio de trabajo.
--
-- Fila única (singleton), igual que platform_ai_settings: es la conexión de
-- la PLATAFORMA, no de un inquilino, así que no lleva workspace_id.
--
-- El token va cifrado con la misma clave que el resto de los secretos y NUNCA
-- vuelve al navegador: la pantalla de /admin sólo muestra si está puesto.

CREATE TABLE IF NOT EXISTS platform_whatsapp_settings (
  id BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id),
  phone_number_id TEXT,
  waba_id TEXT,
  display_phone_number TEXT,
  access_token_encrypted TEXT,
  -- Plantilla Utility aprobada con la que salen los avisos. Utility se
  -- entrega; Marketing la retienen (ver whatsapp-marketing-gating).
  alert_template_name TEXT,
  alert_template_language TEXT DEFAULT 'es',
  is_active BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

ALTER TABLE platform_whatsapp_settings ENABLE ROW LEVEL SECURITY;
-- Sin políticas: sólo service-role. Ningún usuario autenticado la lee ni la
-- escribe — se administra desde /admin, que va por la clave de servicio.

COMMENT ON TABLE platform_whatsapp_settings IS
  'Conexión de WhatsApp de la PLATAFORMA (no de un comercio) para avisos operativos. Fila única.';
