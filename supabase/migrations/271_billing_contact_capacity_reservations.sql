-- Serializa la admisión de contactos nuevos entre todos los workers y canales.
CREATE TABLE IF NOT EXISTS public.billing_contact_reservations (
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  period_start timestamptz NOT NULL,
  canonical_contact_id uuid NOT NULL,
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (workspace_id, period_start, canonical_contact_id)
);

CREATE INDEX IF NOT EXISTS billing_contact_reservations_expiry_idx
  ON public.billing_contact_reservations (workspace_id, period_start, expires_at);

REVOKE ALL ON public.billing_contact_reservations FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.billing_try_reserve_contact(
  p_workspace uuid, p_contact uuid, p_desde timestamptz,
  p_hasta timestamptz, p_limite integer
)
RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_canonical uuid;
  v_total integer;
BEGIN
  IF p_limite <= 0 OR p_desde >= p_hasta THEN RETURN false; END IF;

  -- Una sola decisión a la vez por comercio y ciclo, incluso con varios workers.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_workspace::text || ':' || p_desde::text, 0));
  SELECT coalesce(c.unified_contact_id, c.id) INTO v_canonical
  FROM public.contacts c WHERE c.id = p_contact AND c.workspace_id = p_workspace;
  IF v_canonical IS NULL THEN RAISE EXCEPTION 'contact_not_found'; END IF;

  -- Quien ya recibió IA conserva atención aunque el cupo se haya agotado.
  IF EXISTS (
    SELECT 1 FROM public.billing_contact_events e
    LEFT JOIN public.contacts c ON c.id = e.contact_id AND c.workspace_id = e.workspace_id
    WHERE e.workspace_id = p_workspace AND e.served_at >= p_desde AND e.served_at < p_hasta
      AND coalesce(c.unified_contact_id, e.contact_id) = v_canonical
  ) THEN RETURN true; END IF;

  DELETE FROM public.billing_contact_reservations
  WHERE workspace_id = p_workspace AND period_start = p_desde AND expires_at <= clock_timestamp();

  IF EXISTS (
    SELECT 1 FROM public.billing_contact_reservations
    WHERE workspace_id = p_workspace AND period_start = p_desde
      AND canonical_contact_id = v_canonical
  ) THEN RETURN true; END IF;

  SELECT count(*) INTO v_total FROM (
    SELECT coalesce(c.unified_contact_id, e.contact_id) AS canonical_id
    FROM public.billing_contact_events e
    LEFT JOIN public.contacts c ON c.id = e.contact_id AND c.workspace_id = e.workspace_id
    WHERE e.workspace_id = p_workspace AND e.served_at >= p_desde AND e.served_at < p_hasta
    UNION
    SELECT canonical_contact_id FROM public.billing_contact_reservations
    WHERE workspace_id = p_workspace AND period_start = p_desde
  ) ocupados;

  IF v_total >= p_limite THEN RETURN false; END IF;
  INSERT INTO public.billing_contact_reservations
    (workspace_id, period_start, canonical_contact_id, expires_at)
  VALUES (p_workspace, p_desde, v_canonical, clock_timestamp() + interval '15 minutes');
  RETURN true;
END $$;

REVOKE ALL ON FUNCTION public.billing_try_reserve_contact(uuid,uuid,timestamptz,timestamptz,integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.billing_try_reserve_contact(uuid,uuid,timestamptz,timestamptz,integer)
  TO service_role;
