-- Receipt-backed financial expenses. Disabled until deployment is verified.
BEGIN;
CREATE TABLE IF NOT EXISTS public.wallet_financial_config (
  id boolean PRIMARY KEY DEFAULT true CHECK(id), enabled boolean NOT NULL DEFAULT false,
  activated_at timestamptz, stripe_account text NOT NULL,
  CHECK(NOT enabled OR activated_at IS NOT NULL)
);
INSERT INTO public.wallet_financial_config(id,stripe_account) VALUES(true,'acct_1PmcXrL0pSUS73Ad') ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS public.wallet_financial_receipts (
  id text PRIMARY KEY, kind text NOT NULL CHECK(kind IN ('processing','instant_payout')),
  fee_centavos bigint NOT NULL CHECK(fee_centavos>=0), occurred_at timestamptz NOT NULL,
  evidence jsonb NOT NULL, imported_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.wallet_financial_allocations (
  receipt_id text NOT NULL REFERENCES public.wallet_financial_receipts,
  funding_id text NOT NULL, workspace_id uuid NOT NULL REFERENCES public.workspaces,
  fee_centavos bigint NOT NULL CHECK(fee_centavos>=0), basis_centavos bigint NOT NULL CHECK(basis_centavos>0),
  recovered_centavos numeric(20,8) NOT NULL DEFAULT 0,
  cancelled boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(receipt_id,funding_id), CHECK(recovered_centavos>=0 AND recovered_centavos<=fee_centavos)
);
CREATE INDEX IF NOT EXISTS wallet_financial_allocations_workspace ON public.wallet_financial_allocations(workspace_id,created_at);
CREATE TABLE IF NOT EXISTS public.wallet_financial_recoveries (
  operation_id text NOT NULL REFERENCES public.wallet_operaciones,
  receipt_id text NOT NULL, funding_id text NOT NULL, amount_centavos numeric(20,8) NOT NULL CHECK(amount_centavos>=0),
  PRIMARY KEY(operation_id,receipt_id,funding_id),
  FOREIGN KEY(receipt_id,funding_id) REFERENCES public.wallet_financial_allocations(receipt_id,funding_id)
);
ALTER TABLE public.wallet_financial_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wallet_financial_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wallet_financial_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wallet_financial_recoveries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.wallet_financial_config,public.wallet_financial_receipts,public.wallet_financial_allocations,public.wallet_financial_recoveries FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.wallet_financial_config,public.wallet_financial_receipts,public.wallet_financial_allocations,public.wallet_financial_recoveries TO service_role;

-- One immutable receipt and its allocations, inserted atomically. No wallet debit here.
CREATE OR REPLACE FUNCTION public.wallet_financial_import(p_id text,p_kind text,p_fee bigint,p_occurred timestamptz,p_evidence jsonb,p_allocations jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE r wallet_financial_receipts; a jsonb; cfg wallet_financial_config; total bigint:=0; ws uuid; funding text;
BEGIN
  SELECT * INTO cfg FROM wallet_financial_config WHERE id;
  PERFORM pg_advisory_xact_lock(hashtextextended('financial:'||p_id,0));
  SELECT * INTO r FROM wallet_financial_receipts WHERE id=p_id;
  IF FOUND THEN
    IF r.kind<>p_kind OR r.fee_centavos<>p_fee OR r.occurred_at<>p_occurred THEN RAISE EXCEPTION 'wallet_financial_receipt_conflict'; END IF;
    RETURN;
  END IF;
  INSERT INTO wallet_financial_receipts(id,kind,fee_centavos,occurred_at,evidence) VALUES(p_id,p_kind,p_fee,p_occurred,p_evidence);
  IF cfg.activated_at IS NULL OR p_occurred<cfg.activated_at THEN RETURN; END IF;
  FOR a IN SELECT * FROM jsonb_array_elements(p_allocations) LOOP
    ws:=(a->>'workspaceId')::uuid; funding:=a->>'fundingId';
    -- Only real, post-activation top-ups, never synthetic tests or another account.
    IF NOT EXISTS(SELECT 1 FROM wallet_movimientos WHERE workspace_id=ws AND stripe_id=funding AND tipo='recarga' AND centavos>0 AND creado_en>=cfg.activated_at)
       OR EXISTS(SELECT 1 FROM wallet_movimientos WHERE workspace_id=ws AND concepto='recarga_ajuste' AND detalle->>'paymentIntent'=funding)
       OR (p_kind='processing' AND EXISTS(SELECT 1 FROM wallet_movimientos WHERE stripe_id=funding||':comision' AND centavos<0))
       OR NOT EXISTS(SELECT 1 FROM workspace_subscriptions WHERE workspace_id=ws AND modelo_cobro='saldo' AND estado<>'cortesia') THEN
      CONTINUE;
    END IF;
    total:=total+(a->>'allocatedCents')::bigint;
    INSERT INTO wallet_financial_allocations(receipt_id,funding_id,workspace_id,fee_centavos,basis_centavos)
      VALUES(p_id,funding,ws,(a->>'allocatedCents')::bigint,(a->>'basisCents')::bigint);
  END LOOP;
  IF total>p_fee THEN RAISE EXCEPTION 'wallet_financial_overallocation'; END IF;
END $$;

-- Account row is locked by the caller. Per-kind FIFO amortization; at most 5%
-- per kind of the provider cost, never more than the verified receipt budget.
-- The ceiling delays recovery of expensive small deposits, it never invents fees.
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
  IF NOT coalesce(cfg.enabled,false) OR p_cutoff<cfg.activated_at OR p_new<=p_old OR NOT EXISTS(
    SELECT 1 FROM workspace_subscriptions WHERE workspace_id=p_workspace AND modelo_cobro='saldo' AND estado<>'cortesia'
  ) THEN RETURN 0; END IF;
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
REVOKE ALL ON FUNCTION public.wallet_financial_import(text,text,bigint,timestamptz,jsonb,jsonb),public.wallet_financial_apply(uuid,text,numeric,numeric,timestamptz,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.wallet_financial_import(text,text,bigint,timestamptz,jsonb,jsonb) TO service_role;

-- Settlement definitions follow; original provider costs remain unchanged.
-- Aggregate inside PostgreSQL: PostgREST's row cap must not truncate metrics.
CREATE OR REPLACE FUNCTION public.wallet_business_totals(p_desde timestamptz,p_hasta timestamptz)
RETURNS TABLE(workspace_id uuid,cargado numeric,gastado numeric,costo numeric)
LANGUAGE sql SECURITY DEFINER SET search_path=public AS $$
  WITH actual AS (
    SELECT m.workspace_id,
      sum(CASE WHEN m.tipo='recarga' THEN m.centavos ELSE 0 END)::numeric AS cargado,
      sum(CASE WHEN (m.tipo='consumo' AND m.concepto<>'comision_stripe') OR m.referencia_tipo='provider_receipt' THEN -m.centavos ELSE 0 END)::numeric AS gastado,
      sum(coalesce(m.costo_centavos,0))::numeric AS costo
    FROM wallet_movimientos m WHERE m.creado_en>=p_desde AND m.creado_en<p_hasta GROUP BY m.workspace_id
    UNION ALL
    SELECT a.workspace_id,0,0,sum(a.fee_centavos)::numeric
      FROM wallet_financial_allocations a JOIN wallet_financial_receipts r ON r.id=a.receipt_id
      WHERE r.kind='instant_payout' AND r.occurred_at>=p_desde AND r.occurred_at<p_hasta GROUP BY a.workspace_id
    UNION ALL
    SELECT NULL::uuid,0,0,coalesce(sum(r.fee_centavos-(SELECT coalesce(sum(a.fee_centavos),0) FROM wallet_financial_allocations a WHERE a.receipt_id=r.id)),0)::numeric
      FROM wallet_financial_receipts r WHERE r.kind='instant_payout' AND r.occurred_at>=p_desde AND r.occurred_at<p_hasta
  ) SELECT a.workspace_id,sum(a.cargado),sum(a.gastado),sum(a.costo) FROM actual a GROUP BY a.workspace_id;
$$;
REVOKE ALL ON FUNCTION public.wallet_business_totals(timestamptz,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.wallet_business_totals(timestamptz,timestamptz) TO service_role;
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
  INSERT INTO wallet_operaciones(id,workspace_id,concepto,proveedor,estado,costo_centavos,cantidad,detalle)
    VALUES(p_id,p_workspace,p_concepto,p_proveedor,'liquidada',p_costo_centavos,p_cantidad,coalesce(p_detalle,'{}'))
    ON CONFLICT(id) DO UPDATE SET estado='liquidada',costo_centavos=excluded.costo_centavos,cantidad=excluded.cantidad,detalle=wallet_operaciones.detalle || excluded.detalle,updated_at=now();
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
