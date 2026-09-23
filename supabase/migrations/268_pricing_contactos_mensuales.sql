-- Planes públicos y registro estable de contactos atendidos por IA.
-- No cambia el modelo de cobro, el estado ni el precio propio de ninguna cuenta.
BEGIN;

-- El plan Pro permanece referenciado por cuentas legadas; no se reescribe.
UPDATE public.billing_plans SET activo = false, updated_at = now()
WHERE slug = 'pro';

INSERT INTO public.billing_plans
  (slug, nombre, activo, precio_centavos, moneda, incluidas, excedente_centavos, orden)
VALUES
  ('contactos-500', 'Hasta 500 contactos', true, 39900, 'usd', 500, 0, 1),
  ('contactos-2000', 'Hasta 2.000 contactos', true, 99900, 'usd', 2000, 0, 2),
  ('contactos-5000', 'Hasta 5.000 contactos', true, 199900, 'usd', 5000, 0, 3),
  ('contactos-10000', 'Hasta 10.000 contactos', true, 349900, 'usd', 10000, 0, 4)
ON CONFLICT (slug) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.billing_contact_events (
  reply_id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  contact_id uuid NOT NULL,
  served_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS billing_contact_events_period_idx
  ON public.billing_contact_events (workspace_id, served_at, contact_id);

-- La respuesta enviada queda registrada aunque luego se borre el chat.
CREATE OR REPLACE FUNCTION public.billing_record_served_contact()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_contact uuid;
BEGIN
  IF NEW.status <> 'sent' OR NEW.conversation_id IS NULL THEN RETURN NEW; END IF;
  SELECT contact_id INTO v_contact FROM public.conversations
  WHERE id = NEW.conversation_id AND workspace_id = NEW.workspace_id;
  IF v_contact IS NOT NULL THEN
    INSERT INTO public.billing_contact_events (reply_id, workspace_id, contact_id, served_at)
    VALUES (NEW.id, NEW.workspace_id, v_contact, NEW.created_at)
    ON CONFLICT (reply_id) DO NOTHING;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS billing_record_served_contact_trigger ON public.ai_replies;
CREATE TRIGGER billing_record_served_contact_trigger
AFTER INSERT OR UPDATE OF status ON public.ai_replies
FOR EACH ROW EXECUTE FUNCTION public.billing_record_served_contact();

INSERT INTO public.billing_contact_events (reply_id, workspace_id, contact_id, served_at)
SELECT r.id, r.workspace_id, c.contact_id, r.created_at
FROM public.ai_replies r
JOIN public.conversations c ON c.id = r.conversation_id AND c.workspace_id = r.workspace_id
WHERE r.status = 'sent'
ON CONFLICT (reply_id) DO NOTHING;

-- Se usa la identidad unificada actual: WhatsApp e Instagram del mismo
-- contacto verificado cuentan una sola vez en el período.
CREATE OR REPLACE FUNCTION public.billing_contactos_atendidos(
  p_workspace uuid, p_desde timestamptz, p_hasta timestamptz
)
RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT count(DISTINCT coalesce(c.unified_contact_id, e.contact_id))::integer
  FROM public.billing_contact_events e
  LEFT JOIN public.contacts c ON c.id = e.contact_id AND c.workspace_id = e.workspace_id
  WHERE e.workspace_id = p_workspace
    AND e.served_at >= p_desde AND e.served_at < p_hasta;
$$;

REVOKE ALL ON public.billing_contact_events FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.billing_contactos_atendidos(uuid,timestamptz,timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.billing_contactos_atendidos(uuid,timestamptz,timestamptz)
  TO service_role;

COMMIT;
