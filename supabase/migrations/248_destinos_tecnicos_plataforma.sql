-- 248 — Destinatarios de alertas técnicas de Riverz.
--
-- La conexión de WhatsApp es el emisor común: sirve para avisarle a cualquier
-- comercio y al equipo de plataforma. Estos campos son otra cosa: definen a
-- quién se escala un problema técnico interno. Nunca se mezclan con los
-- teléfonos de alertas de un comercio.

ALTER TABLE public.platform_whatsapp_settings
  ADD COLUMN IF NOT EXISTS technical_alert_phone TEXT,
  ADD COLUMN IF NOT EXISTS technical_alert_email TEXT;

COMMENT ON COLUMN public.platform_whatsapp_settings.technical_alert_phone IS
  'WhatsApp del administrador que recibe alertas técnicas de Riverz.';

COMMENT ON COLUMN public.platform_whatsapp_settings.technical_alert_email IS
  'Correo del administrador que recibe alertas técnicas de Riverz.';
