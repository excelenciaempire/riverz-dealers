-- 263 — Dos modelos de cobro por cuenta
--
-- Las cuentas que ya existían conservan la billetera y el cobro por consumo.
-- Las nuevas nacen con el precio oficial: la mensualidad incluye todo el uso.
-- El costo del proveedor se sigue registrando, pero no se descuenta ni bloquea.
BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'workspace_subscriptions'
      AND column_name = 'modelo_cobro'
  ) THEN
    ALTER TABLE public.workspace_subscriptions
      ADD COLUMN modelo_cobro text NOT NULL DEFAULT 'oficial';

    -- Esta actualización ocurre sólo al crear la columna. Repetir la migración
    -- jamás puede convertir en legado a una cuenta oficial creada después.
    UPDATE public.workspace_subscriptions SET modelo_cobro = 'saldo';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'workspace_subscriptions_modelo_cobro_check'
  ) THEN
    ALTER TABLE public.workspace_subscriptions
      ADD CONSTRAINT workspace_subscriptions_modelo_cobro_check
      CHECK (modelo_cobro IN ('oficial', 'saldo'));
  END IF;
END $$;

COMMENT ON COLUMN public.workspace_subscriptions.modelo_cobro IS
  'oficial = la mensualidad incluye el consumo; saldo = acuerdo anterior con billetera por uso.';

CREATE OR REPLACE FUNCTION public.wallet_reservar(
  p_workspace uuid,
  p_id text,
  p_concepto text,
  p_proveedor text,
  p_centavos bigint,
  p_detalle jsonb DEFAULT '{}'
)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_account wallet_accounts; v_old wallet_operaciones; v_exenta boolean;
BEGIN
  IF p_centavos <= 0 OR p_id IS NULL OR length(p_id) < 1 THEN RAISE EXCEPTION 'wallet_invalid_reservation'; END IF;
  INSERT INTO wallet_accounts(workspace_id) VALUES(p_workspace) ON CONFLICT DO NOTHING;
  SELECT * INTO v_account FROM wallet_accounts WHERE workspace_id=p_workspace FOR UPDATE;
  SELECT * INTO v_old FROM wallet_operaciones WHERE id=p_id;
  IF FOUND THEN RAISE EXCEPTION 'wallet_operation_already_started'; END IF;
  SELECT NOT EXISTS(
    SELECT 1 FROM workspace_subscriptions
    WHERE workspace_id=p_workspace AND modelo_cobro='saldo' AND estado<>'cortesia'
  ) INTO v_exenta;
  IF NOT v_exenta AND v_account.saldo_centavos - v_account.reservado_centavos - v_account.resto_costo_centavos < p_centavos THEN RETURN false; END IF;
  INSERT INTO wallet_operaciones(id, workspace_id, concepto, proveedor, reserva_centavos, detalle)
    VALUES(p_id,p_workspace,p_concepto,p_proveedor,CASE WHEN v_exenta THEN 0 ELSE p_centavos END,coalesce(p_detalle,'{}'));
  UPDATE wallet_accounts SET reservado_centavos=reservado_centavos + CASE WHEN v_exenta THEN 0 ELSE p_centavos END WHERE workspace_id=p_workspace;
  RETURN true;
END $$;

CREATE OR REPLACE FUNCTION public.wallet_liquidar(
  p_workspace uuid,
  p_id text,
  p_concepto text,
  p_proveedor text,
  p_costo_centavos numeric,
  p_cantidad numeric DEFAULT 1,
  p_detalle jsonb DEFAULT '{}'
)
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
  SELECT NOT EXISTS(
    SELECT 1 FROM workspace_subscriptions
    WHERE workspace_id=p_workspace AND modelo_cobro='saldo' AND estado<>'cortesia'
  ) INTO v_exenta;
  v_cost := v_account.resto_costo_centavos + CASE WHEN v_exenta THEN 0 ELSE p_costo_centavos END;
  v_cents := floor(v_cost);
  INSERT INTO wallet_operaciones(id,workspace_id,concepto,proveedor,estado,costo_centavos,cantidad,detalle)
    VALUES(p_id,p_workspace,p_concepto,p_proveedor,'liquidada',p_costo_centavos,p_cantidad,coalesce(p_detalle,'{}'))
    ON CONFLICT(id) DO UPDATE SET estado='liquidada',costo_centavos=excluded.costo_centavos,cantidad=excluded.cantidad,detalle=wallet_operaciones.detalle || excluded.detalle,updated_at=now();
  UPDATE wallet_accounts SET saldo_centavos=wallet_accounts.saldo_centavos-v_cents,
    reservado_centavos=reservado_centavos-coalesce(v_op.reserva_centavos,0),resto_costo_centavos=v_cost-v_cents,updated_at=now() WHERE workspace_id=p_workspace;
  INSERT INTO wallet_movimientos(workspace_id,tipo,concepto,centavos,saldo_despues_centavos,costo_centavos,cantidad,referencia_tipo,referencia_id,detalle)
    VALUES(p_workspace,'consumo',p_concepto,-v_cents,v_account.saldo_centavos-v_cents,p_costo_centavos,p_cantidad,'provider_operation',p_id,
      coalesce(p_detalle,'{}') || jsonb_build_object('proveedor',p_proveedor,'exenta',v_exenta,'costoExactoCentavos',p_costo_centavos)) RETURNING id INTO v_move;
  RETURN QUERY SELECT v_move,v_account.saldo_centavos-v_cents,false;
END $$;

CREATE OR REPLACE FUNCTION public.wallet_conciliar_recibo(
  p_id text,
  p_operacion text,
  p_costo_centavos numeric
)
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
  SELECT NOT EXISTS(
    SELECT 1 FROM workspace_subscriptions
    WHERE workspace_id=v_op.workspace_id AND modelo_cobro='saldo' AND estado<>'cortesia'
  ) INTO v_exenta;
  v_delta:=p_costo_centavos-v_op.costo_centavos;
  v_total:=v_account.resto_costo_centavos+CASE WHEN v_exenta THEN 0 ELSE v_delta END;
  v_cents:=floor(v_total);
  UPDATE wallet_accounts SET saldo_centavos=saldo_centavos-v_cents,resto_costo_centavos=v_total-v_cents,updated_at=now() WHERE workspace_id=v_op.workspace_id;
  UPDATE wallet_operaciones SET costo_centavos=p_costo_centavos,detalle=detalle||jsonb_build_object('recibo',p_id),updated_at=now() WHERE id=p_operacion;
  INSERT INTO wallet_movimientos(workspace_id,tipo,concepto,centavos,saldo_despues_centavos,costo_centavos,cantidad,referencia_tipo,referencia_id,detalle)
    VALUES(v_op.workspace_id,'ajuste',v_op.concepto,-v_cents,v_account.saldo_centavos-v_cents,v_delta,0,'provider_receipt',p_id,jsonb_build_object('operacion',p_operacion,'proveedor',v_op.proveedor,'exenta',v_exenta));
END $$;

CREATE OR REPLACE FUNCTION public.wallet_auto_reclamar(
  p_workspace uuid,
  p_customer text,
  p_method text,
  p_amount bigint,
  p_umbral bigint
)
RETURNS SETOF public.wallet_auto_intentos LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE a wallet_accounts; i wallet_auto_intentos;
BEGIN
  IF NOT EXISTS(
    SELECT 1 FROM workspace_subscriptions
    WHERE workspace_id=p_workspace AND modelo_cobro='saldo' AND estado<>'cortesia'
  ) THEN RETURN; END IF;
  SELECT * INTO a FROM wallet_accounts WHERE workspace_id=p_workspace FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  SELECT * INTO i FROM wallet_auto_intentos WHERE workspace_id=p_workspace AND estado='pendiente';
  IF FOUND THEN RETURN NEXT i;RETURN; END IF;
  IF a.saldo_centavos-a.reservado_centavos>p_umbral THEN RETURN;END IF;
  INSERT INTO wallet_auto_intentos(workspace_id,customer_id,payment_method_id,amount) VALUES(p_workspace,p_customer,p_method,p_amount) RETURNING * INTO i;
  RETURN NEXT i;
END $$;

REVOKE ALL ON FUNCTION public.wallet_reservar(uuid,text,text,text,bigint,jsonb) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.wallet_liquidar(uuid,text,text,text,numeric,numeric,jsonb) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.wallet_conciliar_recibo(text,text,numeric) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.wallet_auto_reclamar(uuid,text,text,bigint,bigint) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.wallet_reservar(uuid,text,text,text,bigint,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.wallet_liquidar(uuid,text,text,text,numeric,numeric,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.wallet_conciliar_recibo(text,text,numeric) TO service_role;
GRANT EXECUTE ON FUNCTION public.wallet_auto_reclamar(uuid,text,text,bigint,bigint) TO service_role;

COMMIT;
