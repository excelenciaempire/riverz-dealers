-- Link a human receiving attestation to the existing reviewed refund engine.
CREATE TABLE public.return_refund_links(
 operation_id uuid PRIMARY KEY REFERENCES public.inbox_order_actions(id) ON DELETE CASCADE,
 workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
 case_id uuid NOT NULL REFERENCES public.returns(id) ON DELETE CASCADE,
 receipt_id uuid NOT NULL REFERENCES public.return_logistics_events(id) ON DELETE CASCADE,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX return_refund_links_case ON public.return_refund_links(workspace_id,case_id,receipt_id);
ALTER TABLE public.return_refund_links ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.return_refund_links FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.return_refund_actor_access(p_workspace_id uuid,p_actor_id uuid,p_case_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT public.return_case_actor_access(p_workspace_id,p_actor_id,p_case_id) AND EXISTS(SELECT 1 FROM public.workspaces w
 WHERE w.id=p_workspace_id AND w.deleted_at IS NULL AND (w.owner_id=p_actor_id OR EXISTS(SELECT 1 FROM public.workspace_members m
 WHERE m.workspace_id=w.id AND m.user_id=p_actor_id AND m.role IN ('admin','agent') AND (m.allowed_sections IS NULL OR
 (jsonb_typeof(to_jsonb(m.allowed_sections))='array' AND to_jsonb(m.allowed_sections) ? '/pedidos' AND to_jsonb(m.allowed_sections) ? '/bandeja')))));
$$;

CREATE FUNCTION public.read_return_refund_context(p_workspace_id uuid,p_actor_id uuid,p_case_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.returns;receipt public.return_logistics_events;
BEGIN
 IF p_workspace_id IS NULL OR p_actor_id IS NULL OR p_case_id IS NULL THEN RAISE EXCEPTION 'invalid_return_refund';END IF;
 IF NOT public.return_refund_actor_access(p_workspace_id,p_actor_id,p_case_id) THEN RAISE EXCEPTION 'return_not_found';END IF;
 SELECT * INTO r FROM public.returns WHERE id=p_case_id AND workspace_id=p_workspace_id;
 IF r.platform IS NOT NULL OR r.status<>'recibida' OR r.order_id IS NULL OR r.contact_id IS NULL OR r.conversation_id IS NULL
 OR NOT EXISTS(SELECT 1 FROM public.orders o JOIN public.conversations c ON c.id=r.conversation_id AND c.workspace_id=r.workspace_id AND c.contact_id=r.contact_id AND c.deleted_at IS NULL
  WHERE o.id=r.order_id AND o.workspace_id=r.workspace_id AND o.contact_id=r.contact_id AND o.platform='shopify') THEN RAISE EXCEPTION 'return_refund_unavailable';END IF;
 SELECT * INTO receipt FROM public.return_logistics_events WHERE workspace_id=p_workspace_id AND case_id=p_case_id AND kind='receipt' ORDER BY event_sequence DESC LIMIT 1;
 IF NOT FOUND THEN RAISE EXCEPTION 'return_refund_receipt_required';END IF;
 RETURN jsonb_build_object('case_id',r.id,'order_id',r.order_id,'contact_id',r.contact_id,'conversation_id',r.conversation_id,
  'receipt',jsonb_build_object('id',receipt.id,'reference',receipt.payload->>'reference','condition',receipt.payload->>'condition','quantity',receipt.payload->'quantity','recorded_at',receipt.recorded_at));
END $$;

CREATE FUNCTION public.prepare_return_refund_preview(p_workspace_id uuid,p_actor_id uuid,p_case_id uuid,p_receipt_id uuid,p_id uuid,p_action jsonb,p_preview jsonb,p_fingerprint text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.returns;ctx jsonb;marker jsonb;prior public.return_refund_links;op public.inbox_order_actions;
BEGIN
 IF p_workspace_id IS NULL OR p_actor_id IS NULL OR p_case_id IS NULL OR p_receipt_id IS NULL OR p_id IS NULL
 OR p_action IS NULL OR jsonb_typeof(p_action)<>'object' OR p_action->>'type' IS DISTINCT FROM 'refund'
 OR (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(p_action) k) IS DISTINCT FROM ARRAY['amount','reason','type']::text[]
 OR jsonb_typeof(p_action->'reason') IS DISTINCT FROM 'string' OR length(btrim(p_action->>'reason')) NOT BETWEEN 1 AND 300
 OR NOT (jsonb_typeof(p_action->'amount')='null' OR (jsonb_typeof(p_action->'amount')='number' AND (p_action->>'amount')::numeric>0))
 OR p_preview IS NULL OR jsonb_typeof(p_preview)<>'object' OR p_preview->>'amount' IS NULL OR (p_preview->>'amount') !~ '^[0-9]{1,14}(\.[0-9]{1,6})?$'
 OR (p_preview->>'amount')::numeric<=0 OR p_preview->>'currency' IS NULL OR (p_preview->>'currency') !~ '^[A-Z]{3}$'
 OR p_fingerprint IS NULL OR p_fingerprint !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'invalid_return_refund';END IF;
 IF p_action->'amount'<>'null'::jsonb AND (p_action->>'amount')::numeric IS DISTINCT FROM (p_preview->>'amount')::numeric THEN RAISE EXCEPTION 'invalid_return_refund';END IF;
 PERFORM 1 FROM public.workspaces WHERE id=p_workspace_id AND deleted_at IS NULL FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'return_not_found';END IF;
 PERFORM 1 FROM public.workspace_members WHERE workspace_id=p_workspace_id AND user_id=p_actor_id FOR SHARE;
 SELECT * INTO r FROM public.returns WHERE id=p_case_id AND workspace_id=p_workspace_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'return_not_found';END IF;
 PERFORM 1 FROM public.orders WHERE id=r.order_id AND workspace_id=p_workspace_id FOR SHARE;
 PERFORM 1 FROM public.conversations WHERE id=r.conversation_id AND workspace_id=p_workspace_id FOR SHARE;
 PERFORM 1 FROM public.contacts WHERE id=r.contact_id AND workspace_id=p_workspace_id FOR SHARE;
 PERFORM 1 FROM public.channel_connections cc JOIN public.conversations c ON c.connection_id=cc.id WHERE c.id=r.conversation_id AND cc.workspace_id=p_workspace_id FOR SHARE OF cc;
 ctx=public.read_return_refund_context(p_workspace_id,p_actor_id,p_case_id);
 IF (ctx->'receipt'->>'id')::uuid IS DISTINCT FROM p_receipt_id THEN RAISE EXCEPTION 'return_refund_changed';END IF;
 IF public.workspace_billing_write_allowed(p_workspace_id) IS DISTINCT FROM true THEN RAISE EXCEPTION 'return_subscription_read_only';END IF;
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_id::text,0));
 SELECT * INTO prior FROM public.return_refund_links WHERE operation_id=p_id;
 IF FOUND THEN
  IF prior.workspace_id IS DISTINCT FROM p_workspace_id OR prior.case_id IS DISTINCT FROM p_case_id OR prior.receipt_id IS DISTINCT FROM p_receipt_id THEN RAISE EXCEPTION 'return_refund_changed';END IF;
 ELSE
  IF EXISTS(SELECT 1 FROM public.return_refund_links l JOIN public.inbox_order_actions a ON a.id=l.operation_id WHERE l.workspace_id=p_workspace_id AND l.case_id=p_case_id
   AND (a.status IN ('running','uncertain') OR (a.status='preview' AND l.receipt_id=p_receipt_id AND a.expires_at>clock_timestamp()))) THEN RAISE EXCEPTION 'return_refund_pending';END IF;
 END IF;
 marker=jsonb_build_object('version',1,'case_id',p_case_id,'receipt_id',p_receipt_id,'reference',ctx->'receipt'->>'reference','condition',ctx->'receipt'->>'condition','quantity',ctx->'receipt'->'quantity','recorded_at',ctx->'receipt'->>'recorded_at');
 op=public.save_inbox_order_preview(p_id,p_workspace_id,r.conversation_id,r.order_id,p_actor_id,p_action,p_preview||jsonb_build_object('return_receipt',marker),p_fingerprint);
 IF op.preview->'return_receipt' IS DISTINCT FROM marker THEN RAISE EXCEPTION 'return_refund_changed';END IF;
 INSERT INTO public.return_refund_links(operation_id,workspace_id,case_id,receipt_id) VALUES(p_id,p_workspace_id,p_case_id,p_receipt_id) ON CONFLICT(operation_id) DO NOTHING;
 RETURN jsonb_build_object('case_id',p_case_id,'conversation_id',r.conversation_id,'operation',to_jsonb(op));
END $$;

CREATE FUNCTION public.guard_receipt_linked_refund() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE link public.return_refund_links;ctx jsonb;r public.returns;
BEGIN
 SELECT * INTO link FROM public.return_refund_links WHERE operation_id=OLD.id;
 IF NOT FOUND THEN
  IF OLD.status<>'running' AND NEW.status='running' AND OLD.preview ? 'return_receipt' THEN RAISE EXCEPTION 'return_refund_changed';END IF;
  RETURN NEW;
 END IF;
 IF OLD.workspace_id IS DISTINCT FROM NEW.workspace_id OR OLD.conversation_id IS DISTINCT FROM NEW.conversation_id OR OLD.order_id IS DISTINCT FROM NEW.order_id
 OR OLD.action IS DISTINCT FROM NEW.action OR OLD.preview IS DISTINCT FROM NEW.preview OR OLD.fingerprint IS DISTINCT FROM NEW.fingerprint THEN RAISE EXCEPTION 'return_refund_changed';END IF;
 IF OLD.status<>'running' AND NEW.status='running' THEN
  PERFORM 1 FROM public.workspaces WHERE id=link.workspace_id AND deleted_at IS NULL FOR SHARE;
  PERFORM 1 FROM public.workspace_members WHERE workspace_id=link.workspace_id AND user_id=NEW.approved_by FOR SHARE;
  SELECT * INTO r FROM public.returns WHERE id=link.case_id AND workspace_id=link.workspace_id FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'return_refund_changed';END IF;
  PERFORM 1 FROM public.conversations WHERE id=r.conversation_id AND workspace_id=r.workspace_id FOR SHARE;
  PERFORM 1 FROM public.channel_connections cc JOIN public.conversations c ON c.connection_id=cc.id WHERE c.id=r.conversation_id AND cc.workspace_id=r.workspace_id FOR SHARE OF cc;
  PERFORM 1 FROM public.contacts WHERE id=r.contact_id AND workspace_id=r.workspace_id FOR SHARE;
  ctx=public.read_return_refund_context(link.workspace_id,NEW.approved_by,link.case_id);
  IF r.order_id IS DISTINCT FROM NEW.order_id OR r.conversation_id IS DISTINCT FROM NEW.conversation_id OR (ctx->'receipt'->>'id')::uuid IS DISTINCT FROM link.receipt_id
   OR NEW.action->>'type' IS DISTINCT FROM 'refund' OR public.workspace_billing_write_allowed(link.workspace_id) IS DISTINCT FROM true THEN RAISE EXCEPTION 'return_refund_changed';END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER guard_receipt_linked_refund BEFORE UPDATE ON public.inbox_order_actions FOR EACH ROW EXECUTE FUNCTION public.guard_receipt_linked_refund();

CREATE FUNCTION public.guard_receipt_during_refund() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NEW.kind='receipt' AND EXISTS(SELECT 1 FROM public.return_refund_links l JOIN public.inbox_order_actions a ON a.id=l.operation_id
  WHERE l.workspace_id=NEW.workspace_id AND l.case_id=NEW.case_id AND a.status IN ('running','uncertain')) THEN RAISE EXCEPTION 'return_refund_pending';END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER guard_receipt_during_refund BEFORE INSERT ON public.return_logistics_events FOR EACH ROW EXECUTE FUNCTION public.guard_receipt_during_refund();
REVOKE ALL ON FUNCTION public.return_refund_actor_access(uuid,uuid,uuid),public.read_return_refund_context(uuid,uuid,uuid),public.prepare_return_refund_preview(uuid,uuid,uuid,uuid,uuid,jsonb,jsonb,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.return_refund_actor_access(uuid,uuid,uuid),public.read_return_refund_context(uuid,uuid,uuid),public.prepare_return_refund_preview(uuid,uuid,uuid,uuid,uuid,jsonb,jsonb,text) TO service_role;
REVOKE ALL ON FUNCTION public.guard_receipt_linked_refund(),public.guard_receipt_during_refund() FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.return_refund_link_ready() RETURNS boolean LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$
 SELECT (SELECT relrowsecurity FROM pg_catalog.pg_class WHERE oid='public.return_refund_links'::regclass)
 AND NOT has_table_privilege('anon','public.return_refund_links','select,insert,update,delete')
 AND NOT has_table_privilege('authenticated','public.return_refund_links','select,insert,update,delete')
 AND NOT has_table_privilege('service_role','public.return_refund_links','select,insert,update,delete')
 AND (SELECT count(*)=3 AND bool_and(prosecdef AND proconfig=ARRAY['search_path=""'] AND NOT has_function_privilege('anon',oid,'execute') AND NOT has_function_privilege('authenticated',oid,'execute') AND has_function_privilege('service_role',oid,'execute')) FROM pg_catalog.pg_proc WHERE oid IN
 ('public.return_refund_actor_access(uuid,uuid,uuid)'::regprocedure,'public.read_return_refund_context(uuid,uuid,uuid)'::regprocedure,'public.prepare_return_refund_preview(uuid,uuid,uuid,uuid,uuid,jsonb,jsonb,text)'::regprocedure))
 AND (SELECT count(*)=2 AND bool_and(prosecdef AND proconfig=ARRAY['search_path=""'] AND NOT has_function_privilege('anon',oid,'execute') AND NOT has_function_privilege('authenticated',oid,'execute') AND NOT has_function_privilege('service_role',oid,'execute')) FROM pg_catalog.pg_proc WHERE oid IN
 ('public.guard_receipt_linked_refund()'::regprocedure,'public.guard_receipt_during_refund()'::regprocedure))
 AND (SELECT count(*)=2 AND bool_and(tgenabled='O') FROM pg_catalog.pg_trigger WHERE tgname IN ('guard_receipt_linked_refund','guard_receipt_during_refund') AND NOT tgisinternal);
$$;
REVOKE ALL ON FUNCTION public.return_refund_link_ready() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.return_refund_link_ready() TO service_role;
