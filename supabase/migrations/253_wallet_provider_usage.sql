-- Variable provider usage only. No subscription, hosting or monthly provider charges.
BEGIN;
ALTER TABLE public.wallet_accounts ADD COLUMN IF NOT EXISTS reservado_centavos bigint NOT NULL DEFAULT 0;
ALTER TABLE public.wallet_accounts ADD COLUMN IF NOT EXISTS resto_costo_centavos numeric(20,8) NOT NULL DEFAULT 0;
ALTER TABLE public.wallet_accounts ALTER COLUMN bloquear_sin_saldo SET DEFAULT true;
ALTER TABLE public.wallet_accounts ALTER COLUMN descubierto_centavos SET DEFAULT 0;
ALTER TABLE public.wallet_accounts ALTER COLUMN cobrar_a_costo SET DEFAULT true;
UPDATE public.wallet_accounts SET bloquear_sin_saldo = true, descubierto_centavos = 0, cobrar_a_costo = true;

CREATE TABLE IF NOT EXISTS public.wallet_operaciones (
  id text PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id),
  concepto text NOT NULL,
  proveedor text NOT NULL,
  estado text NOT NULL DEFAULT 'reservada' CHECK (estado IN ('reservada','liquidada','cancelada')),
  reserva_centavos bigint NOT NULL DEFAULT 0 CHECK (reserva_centavos >= 0),
  costo_centavos numeric(20,8),
  cantidad numeric NOT NULL DEFAULT 1,
  detalle jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.wallet_operaciones ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS wallet_operaciones_workspace ON public.wallet_operaciones(workspace_id, created_at);
CREATE INDEX IF NOT EXISTS wallet_operaciones_pending ON public.wallet_operaciones(created_at) WHERE estado = 'reservada';

CREATE OR REPLACE FUNCTION public.wallet_reservar(p_workspace uuid, p_id text, p_concepto text, p_proveedor text, p_centavos bigint, p_detalle jsonb DEFAULT '{}')
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_account wallet_accounts; v_old wallet_operaciones; v_exenta boolean;
BEGIN
  IF p_centavos <= 0 OR p_id IS NULL OR length(p_id) < 1 THEN RAISE EXCEPTION 'wallet_invalid_reservation'; END IF;
  INSERT INTO wallet_accounts(workspace_id) VALUES(p_workspace) ON CONFLICT DO NOTHING;
  SELECT * INTO v_account FROM wallet_accounts WHERE workspace_id=p_workspace FOR UPDATE;
  SELECT * INTO v_old FROM wallet_operaciones WHERE id=p_id;
  IF FOUND THEN RAISE EXCEPTION 'wallet_operation_already_started'; END IF;
  SELECT EXISTS(SELECT 1 FROM workspace_subscriptions WHERE workspace_id=p_workspace AND estado='cortesia') INTO v_exenta;
  IF NOT v_exenta AND v_account.saldo_centavos - v_account.reservado_centavos - v_account.resto_costo_centavos < p_centavos THEN RETURN false; END IF;
  INSERT INTO wallet_operaciones(id, workspace_id, concepto, proveedor, reserva_centavos, detalle)
    VALUES(p_id,p_workspace,p_concepto,p_proveedor,CASE WHEN v_exenta THEN 0 ELSE p_centavos END,coalesce(p_detalle,'{}'));
  UPDATE wallet_accounts SET reservado_centavos=reservado_centavos + CASE WHEN v_exenta THEN 0 ELSE p_centavos END WHERE workspace_id=p_workspace;
  RETURN true;
END $$;

-- Accumulation, operation receipt, debit and reservation release are ONE transaction.
CREATE OR REPLACE FUNCTION public.wallet_liquidar(p_workspace uuid,p_id text,p_concepto text,p_proveedor text,p_costo_centavos numeric,p_cantidad numeric DEFAULT 1,p_detalle jsonb DEFAULT '{}')
RETURNS TABLE(movimiento_id uuid,saldo_centavos bigint,duplicado boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_account wallet_accounts; v_op wallet_operaciones; v_cost numeric; v_cents bigint; v_move uuid; v_exenta boolean;
BEGIN
  IF p_costo_centavos IS NULL OR p_costo_centavos < 0 OR p_costo_centavos::text IN ('NaN','Infinity','-Infinity') OR p_id IS NULL THEN RAISE EXCEPTION 'wallet_invalid_cost'; END IF;
  INSERT INTO wallet_accounts(workspace_id) VALUES(p_workspace) ON CONFLICT DO NOTHING;
  SELECT * INTO v_account FROM wallet_accounts WHERE workspace_id=p_workspace FOR UPDATE;
  SELECT * INTO v_op FROM wallet_operaciones WHERE id=p_id;
  IF FOUND AND (v_op.workspace_id<>p_workspace OR v_op.concepto<>p_concepto) THEN RAISE EXCEPTION 'wallet_operation_mismatch'; END IF;
  IF FOUND AND v_op.estado <> 'reservada' THEN
    RETURN QUERY SELECT NULL::uuid,v_account.saldo_centavos,true; RETURN;
  END IF;
  SELECT EXISTS(SELECT 1 FROM workspace_subscriptions WHERE workspace_id=p_workspace AND estado='cortesia') INTO v_exenta;
  v_cost := v_account.resto_costo_centavos + CASE WHEN v_exenta THEN 0 ELSE p_costo_centavos END;
  v_cents := floor(v_cost);
  INSERT INTO wallet_operaciones(id,workspace_id,concepto,proveedor,estado,costo_centavos,cantidad,detalle)
    VALUES(p_id,p_workspace,p_concepto,p_proveedor,'liquidada',p_costo_centavos,p_cantidad,coalesce(p_detalle,'{}'))
    ON CONFLICT(id) DO UPDATE SET estado='liquidada',costo_centavos=excluded.costo_centavos,cantidad=excluded.cantidad,detalle=wallet_operaciones.detalle || excluded.detalle,updated_at=now();
  UPDATE wallet_accounts SET saldo_centavos=wallet_accounts.saldo_centavos-v_cents,
    reservado_centavos=reservado_centavos-coalesce(v_op.reserva_centavos,0),resto_costo_centavos=v_cost-v_cents,updated_at=now() WHERE workspace_id=p_workspace;
  -- Zero-cent entries preserve exact per-operation cost and references; fractions are never discarded.
  INSERT INTO wallet_movimientos(workspace_id,tipo,concepto,centavos,saldo_despues_centavos,costo_centavos,cantidad,referencia_tipo,referencia_id,detalle)
    VALUES(p_workspace,'consumo',p_concepto,-v_cents,v_account.saldo_centavos-v_cents,p_costo_centavos,p_cantidad,'provider_operation',p_id,
      coalesce(p_detalle,'{}') || jsonb_build_object('proveedor',p_proveedor,'exenta',v_exenta,'costoExactoCentavos',p_costo_centavos)) RETURNING id INTO v_move;
  RETURN QUERY SELECT v_move,v_account.saldo_centavos-v_cents,false;
END $$;

-- Release only requests known not to have incurred costs. Unknown outcomes remain reserved for review.
CREATE OR REPLACE FUNCTION public.wallet_cancelar_reserva(p_workspace uuid,p_id text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_op wallet_operaciones;
BEGIN
  PERFORM 1 FROM wallet_accounts WHERE workspace_id=p_workspace FOR UPDATE;
  SELECT * INTO v_op FROM wallet_operaciones WHERE id=p_id AND workspace_id=p_workspace;
  IF NOT FOUND OR v_op.estado <> 'reservada' THEN RETURN; END IF;
  UPDATE wallet_operaciones SET estado='cancelada',updated_at=now() WHERE id=p_id;
  UPDATE wallet_accounts SET reservado_centavos=reservado_centavos-v_op.reserva_centavos WHERE workspace_id=p_workspace;
END $$;

CREATE OR REPLACE VIEW public.wallet_conciliacion WITH (security_invoker=true) AS
SELECT workspace_id, proveedor, concepto, count(*) AS operaciones,
  sum(costo_centavos) FILTER(WHERE estado='liquidada') AS costo_centavos,
  count(*) FILTER(WHERE estado='reservada') AS pendientes,
  min(created_at) FILTER(WHERE estado='reservada') AS pendiente_desde
FROM public.wallet_operaciones GROUP BY workspace_id,proveedor,concepto;
REVOKE ALL ON public.wallet_operaciones,public.wallet_conciliacion FROM anon,authenticated;
GRANT ALL ON public.wallet_operaciones TO service_role;
GRANT SELECT ON public.wallet_conciliacion TO service_role;
REVOKE ALL ON FUNCTION public.wallet_reservar(uuid,text,text,text,bigint,jsonb) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.wallet_liquidar(uuid,text,text,text,numeric,numeric,jsonb) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.wallet_cancelar_reserva(uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.wallet_reservar(uuid,text,text,text,bigint,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.wallet_liquidar(uuid,text,text,text,numeric,numeric,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.wallet_cancelar_reserva(uuid,text) TO service_role;
-- Reconcile ONLY an attributable variable-usage receipt against its original operation.
CREATE TABLE IF NOT EXISTS public.wallet_provider_receipts (
  id text PRIMARY KEY, operation_id text NOT NULL REFERENCES public.wallet_operaciones(id),
  costo_centavos numeric(20,8) NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.wallet_provider_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.wallet_provider_receipts FROM anon,authenticated;
GRANT ALL ON public.wallet_provider_receipts TO service_role;
CREATE OR REPLACE FUNCTION public.wallet_conciliar_recibo(p_id text,p_operacion text,p_costo_centavos numeric)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_op wallet_operaciones; v_account wallet_accounts; v_delta numeric; v_total numeric; v_cents bigint; v_exenta boolean;
BEGIN
  IF p_costo_centavos IS NULL OR p_costo_centavos<0 OR p_costo_centavos::text IN ('NaN','Infinity','-Infinity') THEN RAISE EXCEPTION 'wallet_invalid_cost'; END IF;
  SELECT * INTO v_op FROM wallet_operaciones WHERE id=p_operacion;
  IF NOT FOUND THEN RAISE EXCEPTION 'wallet_operation_not_found'; END IF;
  SELECT * INTO v_account FROM wallet_accounts WHERE workspace_id=v_op.workspace_id FOR UPDATE;
  SELECT * INTO v_op FROM wallet_operaciones WHERE id=p_operacion FOR UPDATE;
  IF EXISTS(SELECT 1 FROM wallet_provider_receipts WHERE id=p_id) THEN
    IF NOT EXISTS(SELECT 1 FROM wallet_provider_receipts WHERE id=p_id AND operation_id=p_operacion AND costo_centavos=p_costo_centavos) THEN RAISE EXCEPTION 'wallet_receipt_conflict'; END IF;
    RETURN;
  END IF;
  IF v_op.estado='cancelada' THEN RAISE EXCEPTION 'wallet_operation_cancelled'; END IF;
  INSERT INTO wallet_provider_receipts(id,operation_id,costo_centavos) VALUES(p_id,p_operacion,p_costo_centavos);
  IF v_op.estado='reservada' THEN
    PERFORM wallet_liquidar(v_op.workspace_id,v_op.id,v_op.concepto,v_op.proveedor,p_costo_centavos,v_op.cantidad,jsonb_build_object('recibo',p_id));
    RETURN;
  END IF;
  SELECT EXISTS(SELECT 1 FROM workspace_subscriptions WHERE workspace_id=v_op.workspace_id AND estado='cortesia') INTO v_exenta;
  v_delta:=p_costo_centavos-v_op.costo_centavos;
  v_total:=v_account.resto_costo_centavos+CASE WHEN v_exenta THEN 0 ELSE v_delta END;
  v_cents:=floor(v_total);
  UPDATE wallet_accounts SET saldo_centavos=saldo_centavos-v_cents,resto_costo_centavos=v_total-v_cents,updated_at=now() WHERE workspace_id=v_op.workspace_id;
  UPDATE wallet_operaciones SET costo_centavos=p_costo_centavos,detalle=detalle||jsonb_build_object('recibo',p_id),updated_at=now() WHERE id=p_operacion;
  INSERT INTO wallet_movimientos(workspace_id,tipo,concepto,centavos,saldo_despues_centavos,costo_centavos,cantidad,referencia_tipo,referencia_id,detalle)
    VALUES(v_op.workspace_id,'ajuste',v_op.concepto,-v_cents,v_account.saldo_centavos-v_cents,v_delta,0,'provider_receipt',p_id,jsonb_build_object('operacion',p_operacion,'proveedor',v_op.proveedor,'exenta',v_exenta));
END $$;
REVOKE ALL ON FUNCTION public.wallet_conciliar_recibo(text,text,numeric) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.wallet_conciliar_recibo(text,text,numeric) TO service_role;

CREATE TABLE IF NOT EXISTS public.wallet_auto_intentos (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),workspace_id uuid NOT NULL REFERENCES public.workspaces,
 amount bigint NOT NULL, customer_id text NOT NULL,payment_method_id text NOT NULL,payment_intent_id text,
 estado text NOT NULL DEFAULT 'pendiente' CHECK(estado IN ('pendiente','completada','fallida')),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS wallet_auto_one_pending ON public.wallet_auto_intentos(workspace_id) WHERE estado='pendiente';
ALTER TABLE public.wallet_auto_intentos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.wallet_auto_intentos FROM anon,authenticated;
GRANT ALL ON public.wallet_auto_intentos TO service_role;
CREATE OR REPLACE FUNCTION public.wallet_auto_reclamar(p_workspace uuid,p_customer text,p_method text,p_amount bigint,p_umbral bigint)
RETURNS SETOF public.wallet_auto_intentos LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE a wallet_accounts; i wallet_auto_intentos;
BEGIN
 SELECT * INTO a FROM wallet_accounts WHERE workspace_id=p_workspace FOR UPDATE;
 IF NOT FOUND THEN RETURN; END IF;
 SELECT * INTO i FROM wallet_auto_intentos WHERE workspace_id=p_workspace AND estado='pendiente';
 IF FOUND THEN RETURN NEXT i;RETURN; END IF;
 IF a.saldo_centavos-a.reservado_centavos>p_umbral THEN RETURN;END IF;
 INSERT INTO wallet_auto_intentos(workspace_id,customer_id,payment_method_id,amount) VALUES(p_workspace,p_customer,p_method,p_amount) RETURNING * INTO i;
 RETURN NEXT i;
END $$;
REVOKE ALL ON FUNCTION public.wallet_auto_reclamar(uuid,text,text,bigint,bigint) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.wallet_auto_reclamar(uuid,text,text,bigint,bigint) TO service_role;

COMMIT;
