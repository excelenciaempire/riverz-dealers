-- Dedicated merchant numbers are paid assets, including courtesy workspaces.
-- Existing numbers are deliberately not enrolled without purchase consent.
CREATE TABLE IF NOT EXISTS public.voice_number_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id),
  phone_number text NOT NULL,
  country text NOT NULL,
  number_type text NOT NULL,
  upfront_cents integer NOT NULL CHECK (upfront_cents >= 0),
  monthly_cents integer NOT NULL CHECK (monthly_cents > 0),
  status text NOT NULL DEFAULT 'purchasing' CHECK (status IN ('purchasing','pending','active','releasing','released','failed','review')),
  order_id text,
  number_id text,
  next_renewal_at timestamptz,
  renewal_operation text,
  lease_until timestamptz NOT NULL DEFAULT now(),
  consent_version text NOT NULL DEFAULT 'number_v1',
  consent_user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS voice_number_workspace_live ON public.voice_number_subscriptions(workspace_id) WHERE status NOT IN ('released','failed');
CREATE UNIQUE INDEX IF NOT EXISTS voice_number_phone_live ON public.voice_number_subscriptions(phone_number) WHERE status NOT IN ('released','failed');
ALTER TABLE public.voice_number_subscriptions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.voice_number_subscriptions FROM anon,authenticated;
GRANT ALL ON public.voice_number_subscriptions TO service_role;

-- Strict, idempotent reservation. No courtesy exemption for rented numbers.
CREATE OR REPLACE FUNCTION public.voice_number_reserve(p_workspace uuid,p_operation text,p_cents bigint,p_detail jsonb DEFAULT '{}')
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE a wallet_accounts; o wallet_operaciones;
BEGIN
 IF p_cents<=0 THEN RAISE EXCEPTION 'invalid_number_cost'; END IF;
 INSERT INTO wallet_accounts(workspace_id) VALUES(p_workspace) ON CONFLICT DO NOTHING;
 SELECT * INTO a FROM wallet_accounts WHERE workspace_id=p_workspace FOR UPDATE;
 SELECT * INTO o FROM wallet_operaciones WHERE id=p_operation;
 IF FOUND THEN
   IF o.workspace_id<>p_workspace OR o.concepto<>'numero_telefono' OR o.reserva_centavos<>p_cents THEN RAISE EXCEPTION 'number_operation_mismatch'; END IF;
   RETURN o.estado IN ('reservada','liquidada');
 END IF;
 IF a.saldo_centavos-a.reservado_centavos-a.resto_costo_centavos<p_cents THEN RETURN false; END IF;
 INSERT INTO wallet_operaciones(id,workspace_id,concepto,proveedor,reserva_centavos,detalle)
 VALUES(p_operation,p_workspace,'numero_telefono','telnyx',p_cents,p_detail);
 UPDATE wallet_accounts SET reservado_centavos=reservado_centavos+p_cents WHERE workspace_id=p_workspace;
 RETURN true;
END $$;

CREATE OR REPLACE FUNCTION public.voice_number_settle(p_workspace uuid,p_operation text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE a wallet_accounts; o wallet_operaciones;
BEGIN
 SELECT * INTO a FROM wallet_accounts WHERE workspace_id=p_workspace FOR UPDATE;
 SELECT * INTO o FROM wallet_operaciones WHERE id=p_operation AND workspace_id=p_workspace AND concepto='numero_telefono';
 IF NOT FOUND THEN RAISE EXCEPTION 'number_reservation_missing'; END IF;
 IF o.estado='liquidada' THEN RETURN; END IF;
 IF o.estado<>'reservada' THEN RAISE EXCEPTION 'number_reservation_cancelled'; END IF;
 UPDATE wallet_accounts SET saldo_centavos=saldo_centavos-o.reserva_centavos,reservado_centavos=reservado_centavos-o.reserva_centavos,updated_at=now() WHERE workspace_id=p_workspace;
 UPDATE wallet_operaciones SET estado='liquidada',costo_centavos=reserva_centavos,updated_at=now() WHERE id=p_operation;
 INSERT INTO wallet_movimientos(workspace_id,tipo,concepto,centavos,saldo_despues_centavos,costo_centavos,cantidad,referencia_tipo,referencia_id,detalle)
 VALUES(p_workspace,'consumo','numero_telefono',-o.reserva_centavos,a.saldo_centavos-o.reserva_centavos,o.reserva_centavos,1,'provider_operation',p_operation,o.detalle || '{"proveedor":"telnyx"}'::jsonb);
END $$;

-- A claim and the initial balance hold commit together. Unique indexes also
-- protect two simultaneous requests for different numbers in one workspace.
CREATE OR REPLACE FUNCTION public.voice_number_claim(p_workspace uuid,p_phone text,p_country text,p_type text,p_upfront integer,p_monthly integer,p_user uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE sid uuid:=gen_random_uuid();
BEGIN
 IF NOT EXISTS(SELECT 1 FROM workspace_members WHERE workspace_id=p_workspace AND user_id=p_user AND role='admin') THEN RAISE EXCEPTION 'forbidden'; END IF;
 IF EXISTS(SELECT 1 FROM channel_connections WHERE workspace_id=p_workspace AND channel='voice' AND (nullif(config->>'phone_number','') IS NOT NULL OR nullif(config->>'telnyx_number_id','') IS NOT NULL)) THEN RAISE EXCEPTION 'number_already_provisioned'; END IF;
 INSERT INTO voice_number_subscriptions(id,workspace_id,phone_number,country,number_type,upfront_cents,monthly_cents,consent_user_id)
 VALUES(sid,p_workspace,p_phone,p_country,p_type,p_upfront,p_monthly,p_user);
 IF NOT voice_number_reserve(p_workspace,'number:'||sid||':initial',p_upfront+p_monthly,jsonb_build_object('phone_number',p_phone,'upfront_cents',p_upfront,'monthly_cents',p_monthly,'subscription_id',sid)) THEN RAISE EXCEPTION 'sin_saldo'; END IF;
 RETURN sid;
END $$;
REVOKE ALL ON FUNCTION public.voice_number_reserve(uuid,text,bigint,jsonb),public.voice_number_settle(uuid,text),public.voice_number_claim(uuid,text,text,text,integer,integer,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.voice_number_reserve(uuid,text,bigint,jsonb),public.voice_number_settle(uuid,text),public.voice_number_claim(uuid,text,text,text,integer,integer,uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.voice_number_lock(p_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 UPDATE voice_number_subscriptions SET lease_until=now()+interval '3 minutes' WHERE id=p_id AND lease_until<=now();
 RETURN FOUND;
END $$;
REVOKE ALL ON FUNCTION public.voice_number_lock(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.voice_number_lock(uuid) TO service_role;
