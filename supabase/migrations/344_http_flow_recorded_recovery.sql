-- Recover recorded POST responses only. Neither RPC can create a proposal or dispatch lease.
CREATE FUNCTION public.observe_http_flow_post(p_workspace_id uuid,p_approval_id uuid,p_run_id uuid,p_flow_id uuid,p_node_key text,
 p_visit_at timestamptz,p_vars jsonb,p_config jsonb,p_grant_revision integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE review jsonb;actor uuid;receipt jsonb;
BEGIN
 IF p_workspace_id IS NULL OR p_approval_id IS NULL OR p_run_id IS NULL OR p_flow_id IS NULL OR p_node_key IS NULL
 OR p_visit_at IS NULL OR p_vars IS NULL OR p_config IS NULL OR p_grant_revision IS NULL THEN RAISE EXCEPTION 'invalid_http_flow_context';END IF;
 SELECT decided_by INTO actor FROM public.approval_requests WHERE id=p_approval_id AND workspace_id=p_workspace_id;
 review=public.review_http_flow_post(p_workspace_id,p_approval_id,actor,true);
 IF (review->>'flow_run_id')::uuid IS DISTINCT FROM p_run_id OR (review->>'flow_id')::uuid IS DISTINCT FROM p_flow_id
 OR review->>'node_key' IS DISTINCT FROM p_node_key OR (review->>'visit_at')::timestamptz IS DISTINCT FROM p_visit_at
 OR review->'observed_vars' IS DISTINCT FROM p_vars OR review->'node_config' IS DISTINCT FROM p_config
 OR (review->>'grant_revision')::integer IS DISTINCT FROM p_grant_revision THEN RAISE EXCEPTION 'http_flow_review_required';END IF;
 SELECT jsonb_build_object('id',a.id,'state',a.state,'status_code',a.status_code,'error_code',a.error_code,'result',a.result)
 INTO receipt FROM public.http_action_flow_receipts f JOIN public.http_action_runs a ON a.id=f.receipt_id
 WHERE f.workspace_id=p_workspace_id AND f.flow_run_id=(review->>'flow_run_id')::uuid
 AND f.flow_id=(review->>'flow_id')::uuid AND f.node_key=review->>'node_key' AND f.visit_at=(review->>'visit_at')::timestamptz
 AND a.workspace_id=p_workspace_id AND a.state='acknowledged' AND a.actor_id=actor
 AND a.action_id=(review->'node_config'->>'action_id')::uuid AND a.action_revision=(review->'node_config'->>'action_revision')::integer
 AND a.conversation_id=(review->'payload'->>'conversation_id')::uuid
 AND a.invocation_key=review->>'invocation_key' AND a.input_hash=review->>'input_hash' FOR SHARE OF a;
 IF NOT FOUND THEN RAISE EXCEPTION 'http_flow_review_required';END IF;
 RETURN jsonb_build_object('approval_id',p_approval_id,'status','aprobada','receipt',receipt,'invocation_key',review->>'invocation_key');
END $$;
REVOKE ALL ON FUNCTION public.observe_http_flow_post(uuid,uuid,uuid,uuid,text,timestamptz,jsonb,jsonb,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.observe_http_flow_post(uuid,uuid,uuid,uuid,text,timestamptz,jsonb,jsonb,integer) TO service_role;

-- The immutable approval + exact receipt link are the durable recovery intent.
-- Advanced/paused/newer visits do not occupy the bounded batch. Runtime still rechecks authority.
CREATE FUNCTION public.list_http_flow_post_recoveries(p_limit integer DEFAULT 20) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF p_limit IS NULL OR p_limit<1 OR p_limit>20 THEN RAISE EXCEPTION 'invalid_http_flow_recovery_limit';END IF;
 RETURN COALESCE((SELECT jsonb_agg(candidate) FROM (
  SELECT jsonb_build_object('workspace_id',p.workspace_id,'approval_id',p.approval_id,'payload',a.payload) AS candidate
  FROM public.http_action_flow_approvals p
  JOIN public.approval_requests a ON a.id=p.approval_id AND a.workspace_id=p.workspace_id AND a.status='aprobada'
   AND a.decided_via='panel' AND a.decided_by IS NOT NULL
  JOIN public.flow_runs r ON r.id=p.flow_run_id AND r.workspace_id=p.workspace_id AND r.status='active'
   AND r.current_node_key=p.node_key AND r.last_advanced_at=p.visit_at AND r.vars=p.observed_vars
   AND r.contact_id=(a.payload->>'contact_id')::uuid AND r.conversation_id=(a.payload->>'conversation_id')::uuid
   AND CASE WHEN jsonb_array_length(COALESCE(r.call_stack,'[]'::jsonb))>0 THEN (r.call_stack->-1->>'flow_id')::uuid ELSE r.flow_id END=p.flow_id
  JOIN public.http_action_flow_receipts f ON f.workspace_id=p.workspace_id AND f.flow_run_id=p.flow_run_id
   AND f.flow_id=p.flow_id AND f.node_key=p.node_key AND f.visit_at=p.visit_at
  JOIN public.http_action_runs receipt ON receipt.id=f.receipt_id AND receipt.workspace_id=p.workspace_id
   AND receipt.state='acknowledged' AND receipt.actor_id=a.decided_by
   AND receipt.action_id=(p.node_config->>'action_id')::uuid AND receipt.action_revision=(p.node_config->>'action_revision')::integer
   AND receipt.conversation_id=r.conversation_id AND receipt.invocation_key=p.invocation_key AND receipt.input_hash=p.input_hash
  ORDER BY receipt.finished_at,p.approval_id LIMIT p_limit
 ) rows), '[]'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.list_http_flow_post_recoveries(integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.list_http_flow_post_recoveries(integer) TO service_role;

CREATE FUNCTION public.http_flow_recorded_recovery_ready() RETURNS boolean
LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$
 SELECT public.http_flow_post_receipt_binding_ready() AND
 (SELECT count(*)=2 AND bool_and(p.prosecdef AND p.proconfig=ARRAY['search_path=""']
  AND NOT has_function_privilege('anon',p.oid,'execute') AND NOT has_function_privilege('authenticated',p.oid,'execute')
  AND has_function_privilege('service_role',p.oid,'execute'))
  FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname IN ('observe_http_flow_post','list_http_flow_post_recoveries'));
$$;
REVOKE ALL ON FUNCTION public.http_flow_recorded_recovery_ready() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.http_flow_recorded_recovery_ready() TO service_role;
