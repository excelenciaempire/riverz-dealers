-- Dealer vertical. Apply only to the independent Riverz Dealers database.
BEGIN;
CREATE TABLE public.dealer_vehicles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  stock_number text NOT NULL CHECK (length(stock_number) BETWEEN 1 AND 64), vin text CHECK (vin ~ '^[A-HJ-NPR-Z0-9]{17}$'),
  make text NOT NULL, model text NOT NULL, year integer NOT NULL CHECK(year BETWEEN 1900 AND 2200),
  mileage integer NOT NULL DEFAULT 0 CHECK(mileage >= 0), mileage_unit text NOT NULL DEFAULT 'mi' CHECK(mileage_unit IN ('mi','km')),
  price numeric(14,2) NOT NULL CHECK(price >= 0), currency text NOT NULL DEFAULT 'USD' CHECK(currency ~ '^[A-Z]{3}$'),
  status text NOT NULL DEFAULT 'available' CHECK(status IN ('available','reserved','sold')),
  photos text[] NOT NULL DEFAULT '{}', notes text NOT NULL DEFAULT '', created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(workspace_id, stock_number), UNIQUE(workspace_id, vin), UNIQUE(workspace_id, id)
);
CREATE TABLE public.dealer_opportunities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  contact_id uuid NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  stage text NOT NULL DEFAULT 'inquiry' CHECK(stage IN ('inquiry','qualified','appointment','visit','negotiation','won','lost')),
  budget numeric(14,2) CHECK(budget >= 0), currency text NOT NULL DEFAULT 'USD' CHECK(currency ~ '^[A-Z]{3}$'),
  preferences text NOT NULL DEFAULT '', buying_timeframe text NOT NULL DEFAULT '', financing boolean NOT NULL DEFAULT false,
  trade_in text NOT NULL DEFAULT '', next_follow_up_at timestamptz, follow_up_note text NOT NULL DEFAULT '',
  follow_up_paused boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(workspace_id,id)
);
CREATE UNIQUE INDEX dealer_one_open_opportunity ON public.dealer_opportunities(workspace_id,contact_id) WHERE stage NOT IN ('won','lost');
CREATE TABLE public.dealer_interests (
  workspace_id uuid NOT NULL, opportunity_id uuid NOT NULL, vehicle_id uuid NOT NULL,
  PRIMARY KEY(opportunity_id,vehicle_id),
  FOREIGN KEY(workspace_id,opportunity_id) REFERENCES public.dealer_opportunities(workspace_id,id) ON DELETE CASCADE,
  FOREIGN KEY(workspace_id,vehicle_id) REFERENCES public.dealer_vehicles(workspace_id,id) ON DELETE CASCADE
);
CREATE TABLE public.dealer_appointments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  opportunity_id uuid NOT NULL, vehicle_id uuid NOT NULL, seller_id uuid NOT NULL REFERENCES auth.users(id),
  starts_at timestamptz NOT NULL, ends_at timestamptz NOT NULL, location text NOT NULL,
  kind text NOT NULL DEFAULT 'visit' CHECK(kind IN ('visit','test_drive')),
  status text NOT NULL DEFAULT 'requested' CHECK(status IN ('requested','confirmed','completed','cancelled','no_show')),
  created_at timestamptz NOT NULL DEFAULT now(), CHECK(ends_at > starts_at AND ends_at <= starts_at + interval '4 hours'),
  FOREIGN KEY(workspace_id,opportunity_id) REFERENCES public.dealer_opportunities(workspace_id,id) ON DELETE CASCADE,
  FOREIGN KEY(workspace_id,vehicle_id) REFERENCES public.dealer_vehicles(workspace_id,id) ON DELETE CASCADE
);
CREATE INDEX dealer_followups ON public.dealer_opportunities(workspace_id,next_follow_up_at) WHERE NOT follow_up_paused AND stage NOT IN ('won','lost');
CREATE INDEX dealer_schedule ON public.dealer_appointments(workspace_id,starts_at) WHERE status IN ('requested','confirmed');

-- Trigger invariants also protect direct authenticated writes and service-role AI calls.
CREATE FUNCTION public.dealer_guard_opportunity() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  PERFORM 1 FROM public.contacts WHERE id=NEW.contact_id AND workspace_id=NEW.workspace_id FOR UPDATE;
  IF NOT EXISTS(SELECT 1 FROM public.contacts WHERE id=NEW.contact_id AND workspace_id=NEW.workspace_id) THEN RAISE EXCEPTION 'dealer_reference'; END IF;
  IF TG_OP='UPDATE' AND (NEW.workspace_id<>OLD.workspace_id OR NEW.contact_id<>OLD.contact_id) THEN RAISE EXCEPTION 'dealer_reference'; END IF;
  IF NEW.stage IN ('won','lost') OR EXISTS(SELECT 1 FROM public.contacts WHERE id=NEW.contact_id AND opted_out) THEN
    NEW.follow_up_paused := true; NEW.next_follow_up_at := NULL;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER dealer_guard_opportunity BEFORE INSERT OR UPDATE ON public.dealer_opportunities FOR EACH ROW EXECUTE FUNCTION public.dealer_guard_opportunity();
CREATE FUNCTION public.dealer_guard_appointment() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE vehicle_status text;
BEGIN
  IF TG_OP='UPDATE' AND (NEW.workspace_id<>OLD.workspace_id OR NEW.opportunity_id<>OLD.opportunity_id OR NEW.vehicle_id<>OLD.vehicle_id OR NEW.seller_id<>OLD.seller_id) THEN RAISE EXCEPTION 'dealer_reference'; END IF;
  IF NEW.status NOT IN ('requested','confirmed') THEN RETURN NEW; END IF;
  -- A seller's calendar is serialized even across different vehicles.
  PERFORM pg_advisory_xact_lock(hashtext(NEW.workspace_id::text || NEW.seller_id::text));
  SELECT status INTO vehicle_status FROM public.dealer_vehicles WHERE id=NEW.vehicle_id AND workspace_id=NEW.workspace_id FOR UPDATE;
  IF vehicle_status IS DISTINCT FROM 'available' THEN RAISE EXCEPTION 'dealer_unavailable'; END IF;
  IF NEW.starts_at<=now() THEN RAISE EXCEPTION 'dealer_past'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.workspace_members WHERE workspace_id=NEW.workspace_id AND user_id=NEW.seller_id) THEN RAISE EXCEPTION 'dealer_reference'; END IF;
  -- Serialize scheduling against contact opt-out and opportunity closure too.
  PERFORM 1 FROM public.dealer_opportunities WHERE id=NEW.opportunity_id AND workspace_id=NEW.workspace_id FOR UPDATE;
  PERFORM 1 FROM public.contacts WHERE id=(SELECT contact_id FROM public.dealer_opportunities WHERE id=NEW.opportunity_id) AND workspace_id=NEW.workspace_id FOR UPDATE;
  IF NOT EXISTS(SELECT 1 FROM public.dealer_opportunities o JOIN public.contacts c ON c.id=o.contact_id
    WHERE o.id=NEW.opportunity_id AND o.workspace_id=NEW.workspace_id AND o.stage NOT IN ('won','lost') AND NOT c.opted_out) THEN RAISE EXCEPTION 'dealer_closed'; END IF;
  IF EXISTS(SELECT 1 FROM public.dealer_appointments WHERE workspace_id=NEW.workspace_id AND id<>NEW.id
    AND status IN ('requested','confirmed') AND (seller_id=NEW.seller_id OR vehicle_id=NEW.vehicle_id)
    AND starts_at<NEW.ends_at AND ends_at>NEW.starts_at) THEN RAISE EXCEPTION 'dealer_conflict'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER dealer_guard_appointment BEFORE INSERT OR UPDATE ON public.dealer_appointments FOR EACH ROW EXECUTE FUNCTION public.dealer_guard_appointment();
CREATE FUNCTION public.dealer_stop_vehicle() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.status <> 'available' AND NEW.status IS DISTINCT FROM OLD.status THEN
    UPDATE public.dealer_appointments SET status='cancelled' WHERE vehicle_id=NEW.id AND workspace_id=NEW.workspace_id AND status IN ('requested','confirmed') AND ends_at>now();
    UPDATE public.dealer_opportunities SET next_follow_up_at=NULL, follow_up_paused=true WHERE workspace_id=NEW.workspace_id AND id IN
      (SELECT opportunity_id FROM public.dealer_interests WHERE vehicle_id=NEW.id) AND stage NOT IN ('won','lost');
  END IF; RETURN NEW;
END $$;
CREATE TRIGGER dealer_stop_vehicle AFTER UPDATE OF status ON public.dealer_vehicles FOR EACH ROW EXECUTE FUNCTION public.dealer_stop_vehicle();
CREATE FUNCTION public.dealer_stop_contact() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.opted_out AND NOT OLD.opted_out THEN
    UPDATE public.dealer_opportunities SET follow_up_paused=true,next_follow_up_at=NULL WHERE contact_id=NEW.id AND workspace_id=NEW.workspace_id;
    UPDATE public.dealer_appointments SET status='cancelled' WHERE workspace_id=NEW.workspace_id AND opportunity_id IN
      (SELECT id FROM public.dealer_opportunities WHERE contact_id=NEW.id) AND status IN ('requested','confirmed');
  END IF; RETURN NEW;
END $$;
CREATE TRIGGER dealer_stop_contact AFTER UPDATE OF opted_out ON public.contacts FOR EACH ROW EXECUTE FUNCTION public.dealer_stop_contact();
CREATE FUNCTION public.dealer_stop_closed() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.stage IN ('won','lost') THEN UPDATE public.dealer_appointments SET status='cancelled' WHERE opportunity_id=NEW.id AND status IN ('requested','confirmed'); END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER dealer_stop_closed AFTER UPDATE OF stage ON public.dealer_opportunities FOR EACH ROW EXECUTE FUNCTION public.dealer_stop_closed();

-- Atomic save: invalid interests cannot leave a half-saved opportunity.
CREATE FUNCTION public.dealer_save_opportunity(p_workspace uuid,p_id uuid,p_data jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE saved_id uuid; v uuid;
BEGIN
  IF p_id IS NULL THEN
    INSERT INTO public.dealer_opportunities(workspace_id,contact_id) VALUES(p_workspace,(p_data->>'contact_id')::uuid) RETURNING id INTO saved_id;
  ELSE
    SELECT id INTO saved_id FROM public.dealer_opportunities WHERE id=p_id AND workspace_id=p_workspace AND contact_id=(p_data->>'contact_id')::uuid FOR UPDATE;
    IF saved_id IS NULL THEN RAISE EXCEPTION 'dealer_reference'; END IF;
  END IF;
  UPDATE public.dealer_opportunities SET stage=p_data->>'stage',budget=(p_data->>'budget')::numeric,currency=p_data->>'currency',
    preferences=p_data->>'preferences',buying_timeframe=p_data->>'buying_timeframe',financing=(p_data->>'financing')::boolean,
    trade_in=p_data->>'trade_in',next_follow_up_at=(p_data->>'next_follow_up_at')::timestamptz,
    follow_up_note=p_data->>'follow_up_note',follow_up_paused=(p_data->>'follow_up_paused')::boolean WHERE id=saved_id;
  DELETE FROM public.dealer_interests WHERE opportunity_id=saved_id;
  FOR v IN SELECT jsonb_array_elements_text(p_data->'vehicle_ids')::uuid LOOP
    INSERT INTO public.dealer_interests VALUES(p_workspace,saved_id,v);
  END LOOP;
  RETURN saved_id;
END $$;
REVOKE ALL ON FUNCTION public.dealer_save_opportunity(uuid,uuid,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dealer_save_opportunity(uuid,uuid,jsonb) TO authenticated,service_role;
DO $$ DECLARE tbl text; BEGIN
  FOREACH tbl IN ARRAY ARRAY['dealer_vehicles','dealer_opportunities','dealer_interests','dealer_appointments'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',tbl);
    EXECUTE format('CREATE POLICY dealer_member ON public.%I FOR ALL TO authenticated USING (public.is_workspace_member(workspace_id)) WITH CHECK (public.is_workspace_member(workspace_id))',tbl);
    EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON public.%I TO authenticated,service_role',tbl);
  END LOOP;
END $$;
COMMIT;
