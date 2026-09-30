BEGIN;

ALTER TABLE public.workspace_subscriptions ADD COLUMN grace_hours integer NOT NULL DEFAULT 24
  CHECK (grace_hours BETWEEN 24 AND 720);
ALTER TABLE public.workspace_billing_invoices DROP CONSTRAINT workspace_billing_invoices_check;
ALTER TABLE public.workspace_billing_invoices ADD CONSTRAINT billing_invoice_grace_window
  CHECK (grace_until >= unpaid_since + interval '24 hours' AND grace_until <= unpaid_since + interval '720 hours');

-- Updating a policy changes the current unpaid deadline and future invoices,
-- but never restarts the original clock or changes paid/void invoices.
CREATE FUNCTION public.billing_update_grace_deadlines()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF NEW.grace_hours IS DISTINCT FROM OLD.grace_hours THEN
  UPDATE workspace_billing_invoices SET grace_until=unpaid_since+make_interval(hours=>NEW.grace_hours),updated_at=now()
   WHERE workspace_id=NEW.workspace_id AND status IN ('open','uncollectible') AND amount_remaining>0;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.billing_update_grace_deadlines() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER billing_grace_policy AFTER UPDATE OF grace_hours ON public.workspace_subscriptions
 FOR EACH ROW EXECUTE FUNCTION public.billing_update_grace_deadlines();
CREATE FUNCTION public.billing_sync_wallet_mode()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF NEW.modelo_cobro<>'saldo' THEN
  UPDATE wallet_accounts SET auto_recarga_centavos=NULL,auto_umbral_centavos=NULL,updated_at=now()
   WHERE workspace_id=NEW.workspace_id;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.billing_sync_wallet_mode() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER billing_wallet_mode AFTER INSERT OR UPDATE OF modelo_cobro ON public.workspace_subscriptions
 FOR EACH ROW EXECUTE FUNCTION public.billing_sync_wallet_mode();

CREATE OR REPLACE FUNCTION public.record_subscription_invoice(p_invoice jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE hours integer; ws uuid:=(p_invoice->>'workspace_id')::uuid;
BEGIN
 -- Serialize with policy edits so a webhook cannot restore the old deadline.
 SELECT grace_hours INTO hours FROM workspace_subscriptions WHERE workspace_id=ws FOR UPDATE;
 INSERT INTO workspace_billing_invoices AS existing
  (invoice_id,workspace_id,subscription_id,customer_id,status,amount_remaining,currency,hosted_invoice_url,unpaid_since,grace_until)
 VALUES(p_invoice->>'invoice_id',ws,p_invoice->>'subscription_id',p_invoice->>'customer_id',p_invoice->>'status',
  (p_invoice->>'amount_remaining')::bigint,p_invoice->>'currency',p_invoice->>'hosted_invoice_url',
  (p_invoice->>'unpaid_since')::timestamptz,(p_invoice->>'unpaid_since')::timestamptz+make_interval(hours=>coalesce(hours,24)))
 ON CONFLICT(invoice_id) DO UPDATE SET status=EXCLUDED.status,amount_remaining=EXCLUDED.amount_remaining,
  hosted_invoice_url=EXCLUDED.hosted_invoice_url,unpaid_since=least(existing.unpaid_since,EXCLUDED.unpaid_since),
  grace_until=CASE WHEN existing.status IN ('paid','void') THEN existing.grace_until
   ELSE least(existing.unpaid_since,EXCLUDED.unpaid_since)+make_interval(hours=>coalesce(hours,24)) END,updated_at=now()
 WHERE existing.workspace_id=EXCLUDED.workspace_id
  AND (existing.status NOT IN ('paid','void') OR existing.status=EXCLUDED.status);
END $$;

CREATE OR REPLACE FUNCTION public.workspace_billing_write_allowed(p_workspace uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT NOT EXISTS (SELECT 1 FROM workspace_billing_invoices WHERE workspace_id=p_workspace
  AND status IN ('open','uncollectible') AND amount_remaining>0 AND grace_until<=now())
 AND NOT EXISTS (SELECT 1 FROM workspace_subscriptions s WHERE s.workspace_id=p_workspace AND s.estado='vencida'
  AND s.vencida_desde+make_interval(hours=>s.grace_hours)<=now()
  AND NOT EXISTS (SELECT 1 FROM workspace_billing_invoices i WHERE i.workspace_id=s.workspace_id
   AND i.status IN ('open','uncollectible') AND i.amount_remaining>0));
$$;

ALTER TABLE public.workspace_billing_notices ADD COLUMN schedule_key text NOT NULL DEFAULT '';
UPDATE workspace_billing_notices n SET schedule_key=CASE WHEN phase='active' THEN 'paid' ELSE coalesce(
 (SELECT to_char(i.grace_until AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') FROM workspace_billing_invoices i WHERE i.invoice_id=n.invoice_id),
 (SELECT to_char((s.vencida_desde+make_interval(hours=>s.grace_hours)) AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') FROM workspace_subscriptions s WHERE s.workspace_id=n.workspace_id),'') END;
ALTER TABLE public.workspace_billing_notices ADD CONSTRAINT billing_notice_schedule_unique
 UNIQUE(workspace_id,invoice_id,phase,channel,recipient,schedule_key);
-- Keep the old uniqueness target through the rolling deployment. Only the
-- new notification worker removes it once it starts using schedule keys.
CREATE FUNCTION public.activate_billing_notice_schedules()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE c record;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtext('billing_notice_schedules'));
 FOR c IN SELECT conname FROM pg_constraint WHERE conrelid='public.workspace_billing_notices'::regclass
  AND contype='u' AND conname<>'billing_notice_schedule_unique' LOOP
  EXECUTE format('ALTER TABLE public.workspace_billing_notices DROP CONSTRAINT %I',c.conname);
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.activate_billing_notice_schedules() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.activate_billing_notice_schedules() TO service_role;

-- One administrative agreement transition per merchant across all replicas.
CREATE TABLE public.billing_admin_leases (
 workspace_id uuid PRIMARY KEY REFERENCES public.workspaces(id) ON DELETE CASCADE,
 lease_id uuid NOT NULL, lease_until timestamptz NOT NULL
);
ALTER TABLE public.billing_admin_leases ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.billing_admin_leases FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.billing_admin_leases TO service_role;
CREATE FUNCTION public.claim_billing_admin_lease(p_workspace uuid)
RETURNS uuid LANGUAGE sql SECURITY DEFINER SET search_path=public,pg_temp AS $$
 INSERT INTO billing_admin_leases AS old(workspace_id,lease_id,lease_until)
 VALUES(p_workspace,gen_random_uuid(),now()+interval '15 minutes')
 ON CONFLICT(workspace_id) DO UPDATE SET lease_id=excluded.lease_id,lease_until=excluded.lease_until
 WHERE old.lease_until<=now() RETURNING lease_id;
$$;
CREATE FUNCTION public.release_billing_admin_lease(p_workspace uuid,p_lease uuid)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path=public,pg_temp AS $$
 DELETE FROM billing_admin_leases WHERE workspace_id=p_workspace AND lease_id=p_lease;
$$;
CREATE FUNCTION public.admin_set_billing_grace(p_workspace uuid,p_hours integer,p_actor uuid,p_expected integer,p_actor_email text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE previous integer; deadline timestamptz;
BEGIN
 IF p_hours NOT BETWEEN 24 AND 720 OR p_hours IS NULL OR p_actor IS NULL OR nullif(trim(p_actor_email),'') IS NULL THEN RAISE EXCEPTION 'billing_invalid_grace'; END IF;
 SELECT grace_hours INTO previous FROM workspace_subscriptions WHERE workspace_id=p_workspace FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'billing_subscription_missing'; END IF;
 IF p_expected IS NULL OR previous<>p_expected THEN RAISE EXCEPTION 'billing_policy_conflict'; END IF;
 UPDATE workspace_subscriptions SET grace_hours=p_hours,updated_at=now() WHERE workspace_id=p_workspace;
 SELECT min(grace_until) INTO deadline FROM workspace_billing_invoices WHERE workspace_id=p_workspace
  AND status IN ('open','uncollectible') AND amount_remaining>0;
 INSERT INTO admin_audit_log(actor_id,actor_email,action,target_type,target_id,meta)
 VALUES(p_actor,p_actor_email,'update.billing_subscription','workspace',p_workspace::text,jsonb_build_object('graceHoursBefore',previous,'graceHoursAfter',p_hours,'graceUntil',deadline));
 RETURN jsonb_build_object('graceHours',p_hours,'graceUntil',deadline,'readOnly',NOT workspace_billing_write_allowed(p_workspace));
END $$;
REVOKE ALL ON FUNCTION public.admin_set_billing_grace(uuid,integer,uuid,integer,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_billing_grace(uuid,integer,uuid,integer,text) TO service_role;

-- Append-only adjustments, idempotent retries and an atomic available-funds check.
CREATE UNIQUE INDEX wallet_admin_adjustment_unique ON public.wallet_movimientos(referencia_id)
 WHERE referencia_tipo='admin_adjustment';
CREATE FUNCTION public.admin_adjust_wallet(p_workspace uuid,p_centavos bigint,p_operation uuid,p_actor uuid,p_reason text,p_kind text DEFAULT 'bono',p_actor_email text DEFAULT NULL)
RETURNS TABLE(movimiento_id uuid,saldo_centavos bigint,duplicado boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE account wallet_accounts; old wallet_movimientos; model text; move uuid; next_balance bigint;
BEGIN
 IF p_operation IS NULL OR p_actor IS NULL OR nullif(trim(p_actor_email),'') IS NULL OR p_centavos IS NULL OR p_centavos=0 OR abs(p_centavos)>100000000 OR p_kind IS NULL OR p_kind NOT IN ('bono','ajuste')
  OR (p_centavos<0 AND nullif(trim(p_reason),'') IS NULL) OR length(coalesce(p_reason,''))>500 THEN
  RAISE EXCEPTION 'billing_invalid_adjustment'; END IF;
 SELECT modelo_cobro INTO model FROM workspace_subscriptions WHERE workspace_id=p_workspace FOR UPDATE;
 INSERT INTO wallet_accounts(workspace_id) VALUES(p_workspace) ON CONFLICT DO NOTHING;
 SELECT * INTO account FROM wallet_accounts WHERE workspace_id=p_workspace FOR UPDATE;
 SELECT * INTO old FROM wallet_movimientos WHERE referencia_tipo='admin_adjustment' AND referencia_id=p_operation::text;
 IF FOUND THEN
  IF old.workspace_id<>p_workspace OR old.centavos<>p_centavos OR old.creado_por<>p_actor
   OR old.detalle->>'motivo' IS DISTINCT FROM nullif(trim(p_reason),'') OR old.tipo<>(CASE WHEN p_centavos<0 THEN 'ajuste' ELSE p_kind END) THEN
   RAISE EXCEPTION 'billing_adjustment_conflict'; END IF;
  RETURN QUERY SELECT old.id,account.saldo_centavos,true; RETURN;
 END IF;
 IF model IS DISTINCT FROM 'saldo' THEN RAISE EXCEPTION 'billing_balance_mode_required'; END IF;
 IF p_centavos<0 AND account.saldo_centavos-account.reservado_centavos-account.resto_costo_centavos+p_centavos<0 THEN
  RAISE EXCEPTION 'billing_insufficient_available_balance'; END IF;
 next_balance:=account.saldo_centavos+p_centavos;
 UPDATE wallet_accounts SET saldo_centavos=next_balance,updated_at=now() WHERE workspace_id=p_workspace;
 INSERT INTO wallet_movimientos(workspace_id,tipo,concepto,centavos,saldo_despues_centavos,referencia_tipo,referencia_id,detalle,creado_por)
 VALUES(p_workspace,CASE WHEN p_centavos<0 THEN 'ajuste' ELSE p_kind END,'admin_adjustment',p_centavos,next_balance,
  'admin_adjustment',p_operation::text,jsonb_build_object('motivo',nullif(trim(p_reason),''),'modeloCobro',model),p_actor) RETURNING id INTO move;
 INSERT INTO admin_audit_log(actor_id,actor_email,action,target_type,target_id,meta)
 VALUES(p_actor,p_actor_email,'update.wallet_balance','workspace',p_workspace::text,jsonb_build_object('centavos',p_centavos,'motivo',nullif(trim(p_reason),''),'operationId',p_operation,'before',account.saldo_centavos,'after',next_balance));
 RETURN QUERY SELECT move,next_balance,false;
END $$;
REVOKE ALL ON FUNCTION public.admin_adjust_wallet(uuid,bigint,uuid,uuid,text,text,text),public.claim_billing_admin_lease(uuid),public.release_billing_admin_lease(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.admin_adjust_wallet(uuid,bigint,uuid,uuid,text,text,text),public.claim_billing_admin_lease(uuid),public.release_billing_admin_lease(uuid,uuid) TO service_role;

-- Calls begun under one billing mode retain that payer at settlement,
-- including late provider receipts after an administrator switches modes.
CREATE OR REPLACE FUNCTION public.wallet_financial_apply(p_workspace uuid,p_operation text,p_new numeric,p_old numeric,p_cutoff timestamptz,p_quote boolean DEFAULT false)
RETURNS numeric LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE cfg wallet_financial_config; a record; k text; remaining numeric; rate numeric; piece numeric; result numeric:=0;
BEGIN
  IF p_new<p_old AND NOT p_quote THEN
    FOR a IN SELECT * FROM wallet_financial_recoveries WHERE operation_id=p_operation ORDER BY receipt_id,funding_id FOR UPDATE LOOP
      piece:=round(a.amount_centavos*(p_old-p_new)/p_old,8);
      UPDATE wallet_financial_recoveries SET amount_centavos=amount_centavos-piece WHERE operation_id=p_operation AND receipt_id=a.receipt_id AND funding_id=a.funding_id;
      UPDATE wallet_financial_allocations SET recovered_centavos=recovered_centavos-piece WHERE receipt_id=a.receipt_id AND funding_id=a.funding_id;
      result:=result-piece;
    END LOOP;
    RETURN result;
  END IF;
  SELECT * INTO cfg FROM wallet_financial_config WHERE id;
  IF NOT coalesce(cfg.enabled,false) OR p_cutoff<cfg.activated_at OR p_new<=p_old OR NOT coalesce((SELECT (o.detalle->>'billingWallet')::boolean FROM wallet_operaciones o WHERE o.id=p_operation), EXISTS(SELECT 1 FROM workspace_subscriptions WHERE workspace_id=p_workspace AND modelo_cobro='saldo' AND estado<>'cortesia')) THEN RETURN 0; END IF;
  FOREACH k IN ARRAY ARRAY['processing','instant_payout'] LOOP
    remaining:=p_new-p_old;
    FOR a IN SELECT f.* FROM wallet_financial_allocations f JOIN wallet_financial_receipts r ON r.id=f.receipt_id
      WHERE f.workspace_id=p_workspace AND NOT f.cancelled AND f.created_at<=p_cutoff AND r.kind=k
        AND f.recovered_centavos<f.fee_centavos
        AND NOT EXISTS(SELECT 1 FROM wallet_movimientos m WHERE m.workspace_id=p_workspace AND m.concepto='recarga_ajuste' AND m.detalle->>'paymentIntent'=f.funding_id)
      ORDER BY f.created_at,f.receipt_id,f.funding_id FOR UPDATE OF f LOOP
      EXIT WHEN remaining<=0;
      rate:=least(0.05,a.fee_centavos::numeric/a.basis_centavos);
      IF rate<=0 THEN CONTINUE; END IF;
      piece:=least(trunc(remaining*rate,8),a.fee_centavos-a.recovered_centavos);
      remaining:=greatest(0,remaining-piece/rate); result:=result+piece;
      IF NOT p_quote AND piece>0 THEN
        UPDATE wallet_financial_allocations SET recovered_centavos=recovered_centavos+piece WHERE receipt_id=a.receipt_id AND funding_id=a.funding_id;
        INSERT INTO wallet_financial_recoveries(operation_id,receipt_id,funding_id,amount_centavos) VALUES(p_operation,a.receipt_id,a.funding_id,piece)
          ON CONFLICT(operation_id,receipt_id,funding_id) DO UPDATE SET amount_centavos=wallet_financial_recoveries.amount_centavos+excluded.amount_centavos;
      END IF;
    END LOOP;
  END LOOP;
  RETURN result;
END $$;
CREATE OR REPLACE FUNCTION public.wallet_reservar(
  p_workspace uuid,
  p_id text,
  p_concepto text,
  p_proveedor text,
  p_centavos bigint,
  p_detalle jsonb DEFAULT '{}'
)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_account wallet_accounts; v_old wallet_operaciones; v_exenta boolean; v_fin numeric;
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
  v_fin:=wallet_financial_apply(p_workspace,p_id,p_centavos,0,now(),true);
  p_centavos:=p_centavos+ceil(v_fin)::bigint;
  IF NOT v_exenta AND v_account.saldo_centavos - v_account.reservado_centavos - v_account.resto_costo_centavos < p_centavos THEN RETURN false; END IF;
  INSERT INTO wallet_operaciones(id, workspace_id, concepto, proveedor, reserva_centavos, detalle)
    VALUES(p_id,p_workspace,p_concepto,p_proveedor,CASE WHEN v_exenta THEN 0 ELSE p_centavos END,coalesce(p_detalle,'{}') || jsonb_build_object('billingWallet',NOT v_exenta));
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
DECLARE v_account wallet_accounts; v_op wallet_operaciones; v_cost numeric; v_cents bigint; v_move uuid; v_exenta boolean; v_fin numeric;
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
  IF v_op.id IS NOT NULL THEN v_exenta:=coalesce(NOT (v_op.detalle->>'billingWallet')::boolean,v_op.reserva_centavos=0); END IF;
  INSERT INTO wallet_operaciones(id,workspace_id,concepto,proveedor,estado,costo_centavos,cantidad,detalle)
    VALUES(p_id,p_workspace,p_concepto,p_proveedor,'liquidada',p_costo_centavos,p_cantidad,coalesce(p_detalle,'{}') || jsonb_build_object('billingWallet',NOT v_exenta))
    ON CONFLICT(id) DO UPDATE SET estado='liquidada',costo_centavos=excluded.costo_centavos,cantidad=excluded.cantidad,detalle=wallet_operaciones.detalle || excluded.detalle || jsonb_build_object('billingWallet',NOT v_exenta),updated_at=now();
  v_fin:=wallet_financial_apply(p_workspace,p_id,p_costo_centavos,0,coalesce(v_op.created_at,now()));
  v_cost:=v_account.resto_costo_centavos+CASE WHEN v_exenta THEN 0 ELSE p_costo_centavos+v_fin END;
  v_cents:=floor(v_cost);
  UPDATE wallet_accounts SET saldo_centavos=wallet_accounts.saldo_centavos-v_cents,
    reservado_centavos=reservado_centavos-coalesce(v_op.reserva_centavos,0),resto_costo_centavos=v_cost-v_cents,updated_at=now() WHERE workspace_id=p_workspace;
  INSERT INTO wallet_movimientos(workspace_id,tipo,concepto,centavos,saldo_despues_centavos,costo_centavos,cantidad,referencia_tipo,referencia_id,detalle)
    VALUES(p_workspace,'consumo',p_concepto,-v_cents,v_account.saldo_centavos-v_cents,p_costo_centavos,p_cantidad,'provider_operation',p_id,
      coalesce(p_detalle,'{}') || jsonb_build_object('proveedor',p_proveedor,'exenta',v_exenta,'costoExactoCentavos',p_costo_centavos,'costoFinancieroCentavos',v_fin)) RETURNING id INTO v_move;
  RETURN QUERY SELECT v_move,v_account.saldo_centavos-v_cents,false;
END $$;
CREATE OR REPLACE FUNCTION public.wallet_conciliar_recibo(
  p_id text,
  p_operacion text,
  p_costo_centavos numeric
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_op wallet_operaciones; v_account wallet_accounts; v_delta numeric; v_total numeric; v_cents bigint; v_exenta boolean; v_fin numeric;
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
  v_exenta:=coalesce(NOT (v_op.detalle->>'billingWallet')::boolean,(SELECT (m.detalle->>'exenta')::boolean FROM wallet_movimientos m WHERE m.referencia_tipo='provider_operation' AND m.referencia_id=p_operacion ORDER BY m.creado_en LIMIT 1),v_exenta);
  UPDATE wallet_operaciones SET detalle=detalle||jsonb_build_object('billingWallet',NOT v_exenta) WHERE id=p_operacion;
  v_delta:=p_costo_centavos-v_op.costo_centavos;
  v_fin:=wallet_financial_apply(v_op.workspace_id,p_operacion,p_costo_centavos,v_op.costo_centavos,v_op.created_at);
  v_total:=v_account.resto_costo_centavos+CASE WHEN v_exenta THEN 0 ELSE v_delta END+v_fin;
  v_cents:=floor(v_total);
  UPDATE wallet_accounts SET saldo_centavos=saldo_centavos-v_cents,resto_costo_centavos=v_total-v_cents,updated_at=now() WHERE workspace_id=v_op.workspace_id;
  UPDATE wallet_operaciones SET costo_centavos=p_costo_centavos,detalle=detalle||jsonb_build_object('recibo',p_id),updated_at=now() WHERE id=p_operacion;
  INSERT INTO wallet_movimientos(workspace_id,tipo,concepto,centavos,saldo_despues_centavos,costo_centavos,cantidad,referencia_tipo,referencia_id,detalle)
    VALUES(v_op.workspace_id,'ajuste',v_op.concepto,-v_cents,v_account.saldo_centavos-v_cents,v_delta,0,'provider_receipt',p_id,jsonb_build_object('operacion',p_operacion,'proveedor',v_op.proveedor,'exenta',v_exenta,'costoFinancieroCentavos',v_fin));
END $$;
COMMIT;
