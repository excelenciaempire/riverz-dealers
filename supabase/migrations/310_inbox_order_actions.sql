-- Reviewed human order operations. External calls happen only after an atomic claim.
ALTER TABLE public.approval_requests ADD COLUMN IF NOT EXISTS execution_result jsonb;
CREATE TABLE IF NOT EXISTS public.inbox_order_actions (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  requested_by uuid NOT NULL REFERENCES auth.users(id),
  approved_by uuid REFERENCES auth.users(id),
  action jsonb NOT NULL CHECK (jsonb_typeof(action)='object'),
  preview jsonb NOT NULL CHECK (jsonb_typeof(preview)='object'),
  fingerprint text NOT NULL CHECK (length(fingerprint)=64),
  status text NOT NULL DEFAULT 'preview' CHECK (status IN ('preview','running','completed','failed','uncertain','expired','reviewed')),
  result jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now()+interval '10 minutes',
  approved_at timestamptz,
  finished_at timestamptz
);
CREATE INDEX IF NOT EXISTS inbox_order_actions_case ON public.inbox_order_actions(workspace_id,conversation_id,created_at DESC);
-- An interrupted call is never reclaimed automatically: the provider must be checked.
CREATE UNIQUE INDEX IF NOT EXISTS inbox_order_actions_execution ON public.inbox_order_actions(workspace_id,order_id) WHERE status IN ('running','uncertain');
CREATE TABLE IF NOT EXISTS public.order_execution_locks (
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  source_id uuid NOT NULL,
  source_kind text NOT NULL CHECK(source_kind IN ('inbox','approval')),
  status text NOT NULL DEFAULT 'running' CHECK(status IN ('running','uncertain')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(workspace_id,order_id)
);
ALTER TABLE public.order_execution_locks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.order_execution_locks FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.order_execution_locks TO service_role;
CREATE TABLE IF NOT EXISTS public.order_execution_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  source_id uuid NOT NULL,source_kind text NOT NULL,
  reviewed_by uuid NOT NULL REFERENCES auth.users(id),
  reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 1 AND 300),
  snapshot jsonb NOT NULL CHECK(jsonb_typeof(snapshot)='object'),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.order_execution_reviews ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.order_execution_reviews FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.order_execution_reviews TO authenticated;
GRANT ALL ON public.order_execution_reviews TO service_role;
DROP POLICY IF EXISTS order_execution_reviews_read ON public.order_execution_reviews;
CREATE POLICY order_execution_reviews_read ON public.order_execution_reviews FOR SELECT TO authenticated USING(
  public.is_workspace_member(workspace_id) AND EXISTS(SELECT 1 FROM public.conversations c JOIN public.orders o ON o.id=order_execution_reviews.order_id
    WHERE c.id=order_execution_reviews.conversation_id AND c.workspace_id=order_execution_reviews.workspace_id AND c.deleted_at IS NULL
      AND o.workspace_id=c.workspace_id AND o.contact_id=c.contact_id
      AND (c.channel NOT IN ('gmail','outlook','zoho') OR EXISTS(SELECT 1 FROM public.channel_connections cc WHERE cc.id=c.connection_id AND cc.created_by=auth.uid()))));
ALTER TABLE public.inbox_order_actions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.inbox_order_actions FROM anon, authenticated;
GRANT SELECT ON public.inbox_order_actions TO authenticated;
GRANT ALL ON public.inbox_order_actions TO service_role;
DROP POLICY IF EXISTS inbox_order_actions_read ON public.inbox_order_actions;
CREATE POLICY inbox_order_actions_read ON public.inbox_order_actions FOR SELECT TO authenticated USING (
  public.is_workspace_member(workspace_id) AND EXISTS (
    SELECT 1 FROM public.conversations c JOIN public.orders o ON o.id=inbox_order_actions.order_id
    WHERE c.id=inbox_order_actions.conversation_id AND c.workspace_id=inbox_order_actions.workspace_id AND c.deleted_at IS NULL
      AND o.workspace_id=c.workspace_id AND o.contact_id=c.contact_id
      AND (c.channel NOT IN ('gmail','outlook','zoho') OR EXISTS (
        SELECT 1 FROM public.channel_connections cc WHERE cc.id=c.connection_id AND cc.created_by=auth.uid()))));

CREATE OR REPLACE FUNCTION public.save_inbox_order_preview(
  p_id uuid,p_workspace_id uuid,p_conversation_id uuid,p_order_id uuid,p_actor_id uuid,
  p_action jsonb,p_preview jsonb,p_fingerprint text
) RETURNS public.inbox_order_actions LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE prior public.inbox_order_actions; saved public.inbox_order_actions;
BEGIN
  IF NOT public.workspace_billing_write_allowed(p_workspace_id) THEN RAISE EXCEPTION 'subscription_read_only'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.workspace_members m JOIN public.conversations c ON c.workspace_id=m.workspace_id
    JOIN public.orders o ON o.id=p_order_id AND o.workspace_id=c.workspace_id AND o.contact_id=c.contact_id
    WHERE m.workspace_id=p_workspace_id AND m.user_id=p_actor_id AND c.id=p_conversation_id AND c.deleted_at IS NULL
    AND (c.channel NOT IN ('gmail','outlook','zoho') OR EXISTS (
      SELECT 1 FROM public.channel_connections cc WHERE cc.id=c.connection_id AND cc.created_by=p_actor_id))) THEN
    RAISE EXCEPTION 'invalid_order_context';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_id::text,0));
  SELECT * INTO prior FROM public.inbox_order_actions WHERE id=p_id;
  IF FOUND THEN
    IF prior.workspace_id<>p_workspace_id OR prior.conversation_id<>p_conversation_id OR prior.order_id<>p_order_id
      OR prior.requested_by<>p_actor_id OR prior.action<>p_action THEN RAISE EXCEPTION 'order_action_conflict'; END IF;
    RETURN prior;
  END IF;
  INSERT INTO public.inbox_order_actions(id,workspace_id,conversation_id,order_id,requested_by,action,preview,fingerprint)
    VALUES(p_id,p_workspace_id,p_conversation_id,p_order_id,p_actor_id,p_action,p_preview,p_fingerprint) RETURNING * INTO saved;
  RETURN saved;
END $$;

CREATE OR REPLACE FUNCTION public.claim_inbox_order_action(p_id uuid,p_workspace_id uuid,p_conversation_id uuid,p_actor_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE op public.inbox_order_actions;
BEGIN
  IF NOT public.workspace_billing_write_allowed(p_workspace_id) THEN RAISE EXCEPTION 'subscription_read_only'; END IF;
  SELECT * INTO op FROM public.inbox_order_actions WHERE id=p_id AND workspace_id=p_workspace_id
    AND conversation_id=p_conversation_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'invalid_order_context'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.workspace_members m JOIN public.conversations c ON c.workspace_id=m.workspace_id
    JOIN public.orders o ON o.id=op.order_id AND o.workspace_id=c.workspace_id AND o.contact_id=c.contact_id
    WHERE m.workspace_id=p_workspace_id AND m.user_id=p_actor_id AND m.role IN ('admin','owner')
      AND c.id=p_conversation_id AND c.deleted_at IS NULL
      AND (c.channel NOT IN ('gmail','outlook','zoho') OR EXISTS (
        SELECT 1 FROM public.channel_connections cc WHERE cc.id=c.connection_id AND cc.created_by=p_actor_id))) THEN
    RAISE EXCEPTION 'order_approval_forbidden';
  END IF;
  IF op.status<>'preview' THEN RETURN jsonb_build_object('claimed',false,'operation',to_jsonb(op)); END IF;
  IF op.expires_at<=now() THEN
    UPDATE public.inbox_order_actions SET status='expired',finished_at=now() WHERE id=p_id RETURNING * INTO op;
    RETURN jsonb_build_object('claimed',false,'operation',to_jsonb(op));
  END IF;
  -- Serialize different reviewed operations for the same order.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_workspace_id::text||':'||op.order_id::text,0));
  IF EXISTS(SELECT 1 FROM public.inbox_order_actions WHERE workspace_id=p_workspace_id AND order_id=op.order_id
    AND status IN ('running','uncertain')) THEN RAISE EXCEPTION 'order_action_busy'; END IF;
  UPDATE public.inbox_order_actions SET status='running',approved_by=p_actor_id,approved_at=now() WHERE id=p_id RETURNING * INTO op;
  INSERT INTO public.order_execution_locks(workspace_id,order_id,source_id,source_kind)
    VALUES(p_workspace_id,op.order_id,p_id,'inbox') ON CONFLICT DO NOTHING;
  IF NOT FOUND THEN RAISE EXCEPTION 'order_action_busy'; END IF;
  RETURN jsonb_build_object('claimed',true,'operation',to_jsonb(op));
END $$;

CREATE OR REPLACE FUNCTION public.finish_inbox_order_action(p_id uuid,p_workspace_id uuid,p_status text,p_result jsonb)
RETURNS public.inbox_order_actions LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE op public.inbox_order_actions;
BEGIN
  IF p_status NOT IN ('completed','failed','uncertain') OR jsonb_typeof(p_result)<>'object' THEN RAISE EXCEPTION 'invalid_order_result'; END IF;
  UPDATE public.inbox_order_actions SET status=p_status,result=p_result,finished_at=now()
    WHERE id=p_id AND workspace_id=p_workspace_id AND status='running' RETURNING * INTO op;
  IF NOT FOUND THEN RAISE EXCEPTION 'order_action_conflict'; END IF;
  IF p_status='uncertain' THEN
    UPDATE public.order_execution_locks SET status='uncertain' WHERE workspace_id=p_workspace_id AND source_id=p_id AND source_kind='inbox';
  ELSE
    DELETE FROM public.order_execution_locks WHERE workspace_id=p_workspace_id AND source_id=p_id AND source_kind='inbox';
  END IF;
  RETURN op;
END $$;
CREATE OR REPLACE FUNCTION public.claim_approved_order_execution(p_workspace_id uuid,p_order_id uuid,p_approval_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NOT public.workspace_billing_write_allowed(p_workspace_id) THEN RAISE EXCEPTION 'subscription_read_only'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.approval_requests a JOIN public.orders o ON o.id=p_order_id AND o.workspace_id=a.workspace_id
    WHERE a.id=p_approval_id AND a.workspace_id=p_workspace_id AND a.status='aprobada'
      AND a.kind IN ('cancelar_pedido','reembolsar_pedido') AND a.payload->>'order_id'=p_order_id::text
      AND o.shopify_order_id=a.payload->>'shopify_order_id'
      AND (a.decided_via='whatsapp' AND a.notified_phone IS NOT NULL OR a.decided_via='panel' AND EXISTS(
        SELECT 1 FROM public.workspace_members m WHERE m.workspace_id=a.workspace_id AND m.user_id=a.decided_by AND m.role IN ('owner','admin')))) THEN
    RAISE EXCEPTION 'invalid_order_context';
  END IF;
  INSERT INTO public.order_execution_locks(workspace_id,order_id,source_id,source_kind)
    VALUES(p_workspace_id,p_order_id,p_approval_id,'approval') ON CONFLICT DO NOTHING;
  RETURN FOUND;
END $$;
CREATE OR REPLACE FUNCTION public.finish_approved_order_execution(p_workspace_id uuid,p_approval_id uuid,p_uncertain boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF p_uncertain THEN
    UPDATE public.order_execution_locks SET status='uncertain' WHERE workspace_id=p_workspace_id AND source_id=p_approval_id AND source_kind='approval';
  ELSE
    DELETE FROM public.order_execution_locks WHERE workspace_id=p_workspace_id AND source_id=p_approval_id AND source_kind='approval';
  END IF;
END $$;
CREATE OR REPLACE FUNCTION public.review_order_execution(
  p_workspace_id uuid,p_conversation_id uuid,p_order_id uuid,p_actor_id uuid,p_source_id uuid,p_reason text,p_snapshot jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE locked public.order_execution_locks; review_id uuid;
BEGIN
  IF NOT public.workspace_billing_write_allowed(p_workspace_id) THEN RAISE EXCEPTION 'subscription_read_only'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.workspace_members m JOIN public.conversations c ON c.workspace_id=m.workspace_id
    JOIN public.orders o ON o.id=p_order_id AND o.workspace_id=c.workspace_id AND o.contact_id=c.contact_id
    WHERE m.workspace_id=p_workspace_id AND m.user_id=p_actor_id AND m.role IN ('owner','admin') AND c.id=p_conversation_id AND c.deleted_at IS NULL
    AND (c.channel NOT IN ('gmail','outlook','zoho') OR EXISTS(SELECT 1 FROM public.channel_connections cc WHERE cc.id=c.connection_id AND cc.created_by=p_actor_id))) THEN
    RAISE EXCEPTION 'order_approval_forbidden';
  END IF;
  SELECT * INTO locked FROM public.order_execution_locks WHERE workspace_id=p_workspace_id AND order_id=p_order_id FOR UPDATE;
  IF NOT FOUND OR locked.source_id<>p_source_id OR locked.status<>'uncertain' THEN RAISE EXCEPTION 'order_action_conflict'; END IF;
  INSERT INTO public.order_execution_reviews(workspace_id,conversation_id,order_id,source_id,source_kind,reviewed_by,reason,snapshot)
    VALUES(p_workspace_id,p_conversation_id,p_order_id,locked.source_id,locked.source_kind,p_actor_id,p_reason,p_snapshot) RETURNING id INTO review_id;
  IF locked.source_kind='inbox' THEN
    UPDATE public.inbox_order_actions SET status='reviewed',result=coalesce(result,'{}')||jsonb_build_object('review_id',review_id)
      WHERE id=locked.source_id AND workspace_id=p_workspace_id AND status='uncertain';
  END IF;
  DELETE FROM public.order_execution_locks WHERE workspace_id=p_workspace_id AND order_id=p_order_id AND source_id=p_source_id;
  RETURN jsonb_build_object('review_id',review_id);
END $$;
REVOKE ALL ON FUNCTION public.save_inbox_order_preview(uuid,uuid,uuid,uuid,uuid,jsonb,jsonb,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.claim_inbox_order_action(uuid,uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.finish_inbox_order_action(uuid,uuid,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.save_inbox_order_preview(uuid,uuid,uuid,uuid,uuid,jsonb,jsonb,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_inbox_order_action(uuid,uuid,uuid,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.finish_inbox_order_action(uuid,uuid,text,jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.claim_approved_order_execution(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.finish_approved_order_execution(uuid,uuid,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_approved_order_execution(uuid,uuid,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.finish_approved_order_execution(uuid,uuid,boolean) TO service_role;
REVOKE ALL ON FUNCTION public.review_order_execution(uuid,uuid,uuid,uuid,uuid,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.review_order_execution(uuid,uuid,uuid,uuid,uuid,text,jsonb) TO service_role;
DO $$ BEGIN
  IF to_regprocedure('public.install_billing_business_guards()') IS NOT NULL THEN
    EXECUTE 'SELECT public.install_billing_business_guards()';
  END IF;
END $$;
