CREATE TABLE IF NOT EXISTS public.inbox_native_blocks (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  conversation_id uuid REFERENCES public.conversations(id) ON DELETE SET NULL,
  contact_id uuid REFERENCES public.contacts(id) ON DELETE SET NULL,
  connection_id uuid REFERENCES public.channel_connections(id) ON DELETE SET NULL,
  actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  phone_number_id text NOT NULL CHECK(phone_number_id ~ '^[0-9]{5,24}$'),
  recipient text NOT NULL CHECK(recipient ~ '^[0-9]{6,15}$'),
  desired_blocked boolean NOT NULL,
  expected_blocked boolean NOT NULL,
  fingerprint text NOT NULL,
  status text NOT NULL DEFAULT 'preview' CHECK(status IN ('preview','running','completed','failed','uncertain','reviewed')),
  preview jsonb NOT NULL CHECK(jsonb_typeof(preview)='object'),
  result jsonb,
  dispatched_at timestamptz,
  review jsonb,
  reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  expires_at timestamptz NOT NULL DEFAULT now()+interval '10 minutes',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS inbox_native_blocks_case ON public.inbox_native_blocks(workspace_id,phone_number_id,recipient,created_at DESC);
CREATE TABLE IF NOT EXISTS public.inbox_native_block_locks (
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  phone_number_id text NOT NULL,
  recipient text NOT NULL,
  operation_id uuid NOT NULL UNIQUE REFERENCES public.inbox_native_blocks(id) ON DELETE CASCADE,
  status text NOT NULL CHECK(status IN ('running','uncertain')),
  PRIMARY KEY(workspace_id,phone_number_id,recipient)
);
ALTER TABLE public.inbox_native_blocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inbox_native_block_locks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.inbox_native_blocks,public.inbox_native_block_locks FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.inbox_native_blocks TO authenticated;
GRANT ALL ON public.inbox_native_blocks,public.inbox_native_block_locks TO service_role;
DROP POLICY IF EXISTS inbox_native_blocks_read ON public.inbox_native_blocks;
CREATE POLICY inbox_native_blocks_read ON public.inbox_native_blocks FOR SELECT TO authenticated USING(public.is_workspace_member(workspace_id));

CREATE OR REPLACE FUNCTION public.native_block_context(p_workspace_id uuid,p_conversation_id uuid,p_actor_id uuid,p_phone text,p_recipient text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM public.conversations c
 JOIN public.workspace_members m ON m.workspace_id=c.workspace_id AND m.user_id=p_actor_id AND m.role IN ('admin','owner')
 JOIN public.contacts k ON k.id=c.contact_id AND k.workspace_id=c.workspace_id AND k.channel='whatsapp'
 JOIN public.channel_connections cc ON cc.id=c.connection_id AND cc.workspace_id=c.workspace_id AND cc.channel='whatsapp'
 WHERE c.workspace_id=p_workspace_id AND c.id=p_conversation_id AND c.channel='whatsapp' AND c.deleted_at IS NULL
 AND cc.status='connected' AND coalesce(nullif(cc.config->>'phone_number_id',''),cc.external_account_id)=p_phone
 AND regexp_replace(k.external_id,'^\+','')=p_recipient)
$$;
CREATE OR REPLACE FUNCTION public.prepare_inbox_native_block(p_id uuid,p_workspace_id uuid,p_conversation_id uuid,p_actor_id uuid,p_phone text,p_recipient text,p_desired boolean,p_expected boolean,p_fingerprint text,p_preview jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE c public.conversations;prior public.inbox_native_blocks;
BEGIN
 IF p_id IS NULL OR p_desired IS NULL OR p_expected IS NULL OR p_fingerprint IS NULL OR length(p_fingerprint)<>64 OR jsonb_typeof(p_preview) IS DISTINCT FROM 'object'
   OR public.native_block_context(p_workspace_id,p_conversation_id,p_actor_id,p_phone,p_recipient) IS DISTINCT FROM true THEN RAISE EXCEPTION 'invalid_native_block';END IF;
 IF public.workspace_billing_write_allowed(p_workspace_id) IS DISTINCT FROM true THEN RAISE EXCEPTION 'subscription_read_only';END IF;
 SELECT * INTO prior FROM public.inbox_native_blocks WHERE id=p_id;
 IF FOUND THEN
   IF prior.workspace_id IS DISTINCT FROM p_workspace_id OR prior.conversation_id IS DISTINCT FROM p_conversation_id OR prior.actor_id IS DISTINCT FROM p_actor_id
    OR prior.desired_blocked IS DISTINCT FROM p_desired OR prior.expected_blocked IS DISTINCT FROM p_expected OR prior.fingerprint IS DISTINCT FROM p_fingerprint THEN RAISE EXCEPTION 'native_block_conflict';END IF;
   RETURN to_jsonb(prior);
 END IF;
 SELECT * INTO c FROM public.conversations WHERE id=p_conversation_id AND workspace_id=p_workspace_id;
 INSERT INTO public.inbox_native_blocks(id,workspace_id,conversation_id,contact_id,connection_id,actor_id,phone_number_id,recipient,desired_blocked,expected_blocked,fingerprint,preview)
  VALUES(p_id,p_workspace_id,p_conversation_id,c.contact_id,c.connection_id,p_actor_id,p_phone,p_recipient,p_desired,p_expected,p_fingerprint,p_preview) RETURNING * INTO prior;
 RETURN to_jsonb(prior);
END $$;
CREATE OR REPLACE FUNCTION public.claim_inbox_native_block(p_id uuid,p_workspace_id uuid,p_conversation_id uuid,p_actor_id uuid,p_fingerprint text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE a public.inbox_native_blocks;
BEGIN
 SELECT * INTO a FROM public.inbox_native_blocks WHERE id=p_id AND workspace_id=p_workspace_id AND conversation_id=p_conversation_id FOR UPDATE;
 IF NOT FOUND OR a.actor_id IS DISTINCT FROM p_actor_id OR public.native_block_context(p_workspace_id,p_conversation_id,p_actor_id,a.phone_number_id,a.recipient) IS DISTINCT FROM true THEN RAISE EXCEPTION 'invalid_native_block';END IF;
 IF public.workspace_billing_write_allowed(p_workspace_id) IS DISTINCT FROM true THEN RAISE EXCEPTION 'subscription_read_only';END IF;
 IF a.status<>'preview' THEN RETURN jsonb_build_object('claimed',false,'operation',to_jsonb(a));END IF;
 IF a.expires_at<=now() OR a.fingerprint IS DISTINCT FROM p_fingerprint THEN RAISE EXCEPTION 'native_block_changed';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_workspace_id::text||a.phone_number_id||':'||a.recipient,0));
 IF EXISTS(SELECT 1 FROM public.inbox_native_block_locks WHERE workspace_id=p_workspace_id AND phone_number_id=a.phone_number_id AND recipient=a.recipient) THEN RAISE EXCEPTION 'native_block_locked';END IF;
 INSERT INTO public.inbox_native_block_locks VALUES(p_workspace_id,a.phone_number_id,a.recipient,p_id,'running');
 UPDATE public.inbox_native_blocks SET status='running',updated_at=now() WHERE id=p_id RETURNING * INTO a;
 RETURN jsonb_build_object('claimed',true,'operation',to_jsonb(a));
END $$;
CREATE OR REPLACE FUNCTION public.finish_inbox_native_block(p_id uuid,p_workspace_id uuid,p_status text,p_result jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE a public.inbox_native_blocks;
BEGIN
 SELECT * INTO a FROM public.inbox_native_blocks WHERE id=p_id AND workspace_id=p_workspace_id FOR UPDATE;
 IF NOT FOUND OR p_status IS NULL OR p_status NOT IN ('completed','failed','uncertain') OR jsonb_typeof(p_result) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'invalid_native_block';END IF;
 IF a.status<>'running' THEN RETURN to_jsonb(a);END IF;
 IF p_status='completed' AND (p_result->'blocked' IS DISTINCT FROM to_jsonb(a.desired_blocked) OR p_result->>'recipient' IS DISTINCT FROM a.recipient OR p_result->>'phone_number_id' IS DISTINCT FROM a.phone_number_id)
 THEN RAISE EXCEPTION 'invalid_native_block_receipt';END IF;
 UPDATE public.inbox_native_blocks SET status=p_status,result=p_result,updated_at=now() WHERE id=p_id RETURNING * INTO a;
 IF p_status='uncertain' THEN UPDATE public.inbox_native_block_locks SET status='uncertain' WHERE operation_id=p_id;
 ELSE DELETE FROM public.inbox_native_block_locks WHERE operation_id=p_id;END IF;
 RETURN to_jsonb(a);
END $$;
CREATE OR REPLACE FUNCTION public.authorize_inbox_native_block_dispatch(p_id uuid,p_workspace_id uuid,p_conversation_id uuid,p_actor_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE a public.inbox_native_blocks;
BEGIN
 SELECT * INTO a FROM public.inbox_native_blocks WHERE id=p_id AND workspace_id=p_workspace_id AND conversation_id=p_conversation_id FOR UPDATE;
 IF NOT FOUND OR a.actor_id IS DISTINCT FROM p_actor_id OR public.native_block_context(p_workspace_id,p_conversation_id,p_actor_id,a.phone_number_id,a.recipient) IS DISTINCT FROM true THEN RAISE EXCEPTION 'invalid_native_block';END IF;
 IF public.workspace_billing_write_allowed(p_workspace_id) IS DISTINCT FROM true THEN RAISE EXCEPTION 'subscription_read_only';END IF;
 IF a.status<>'running' OR a.dispatched_at IS NOT NULL OR a.updated_at<=now()-interval '60 seconds' THEN RETURN false;END IF;
 UPDATE public.inbox_native_blocks SET dispatched_at=now() WHERE id=p_id;
 RETURN true;
END $$;
CREATE OR REPLACE FUNCTION public.review_inbox_native_block(p_id uuid,p_workspace_id uuid,p_conversation_id uuid,p_actor_id uuid,p_reason text,p_snapshot jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE a public.inbox_native_blocks;
BEGIN
 SELECT * INTO a FROM public.inbox_native_blocks WHERE id=p_id AND workspace_id=p_workspace_id FOR UPDATE;
 IF NOT FOUND OR public.native_block_context(p_workspace_id,p_conversation_id,p_actor_id,a.phone_number_id,a.recipient) IS DISTINCT FROM true THEN RAISE EXCEPTION 'invalid_native_block';END IF;
 IF public.workspace_billing_write_allowed(p_workspace_id) IS DISTINCT FROM true THEN RAISE EXCEPTION 'subscription_read_only';END IF;
 IF (a.status<>'uncertain' AND NOT(a.status='running' AND a.updated_at<=now()-interval '2 minutes')) OR p_reason IS NULL OR length(trim(p_reason))<8 OR length(p_reason)>500 OR jsonb_typeof(p_snapshot->'blocked') IS DISTINCT FROM 'boolean'
 OR p_snapshot->>'recipient' IS DISTINCT FROM a.recipient OR p_snapshot->>'phone_number_id' IS DISTINCT FROM a.phone_number_id THEN RAISE EXCEPTION 'invalid_native_block_review';END IF;
 UPDATE public.inbox_native_blocks SET status='reviewed',review=jsonb_build_object('reason',trim(p_reason),'snapshot',p_snapshot,'at',now()),reviewed_by=p_actor_id,updated_at=now() WHERE id=p_id RETURNING * INTO a;
 DELETE FROM public.inbox_native_block_locks WHERE operation_id=p_id;
 RETURN to_jsonb(a);
END $$;
REVOKE ALL ON FUNCTION public.native_block_context(uuid,uuid,uuid,text,text),public.prepare_inbox_native_block(uuid,uuid,uuid,uuid,text,text,boolean,boolean,text,jsonb),public.claim_inbox_native_block(uuid,uuid,uuid,uuid,text),public.finish_inbox_native_block(uuid,uuid,text,jsonb),public.authorize_inbox_native_block_dispatch(uuid,uuid,uuid,uuid),public.review_inbox_native_block(uuid,uuid,uuid,uuid,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.native_block_context(uuid,uuid,uuid,text,text),public.prepare_inbox_native_block(uuid,uuid,uuid,uuid,text,text,boolean,boolean,text,jsonb),public.claim_inbox_native_block(uuid,uuid,uuid,uuid,text),public.finish_inbox_native_block(uuid,uuid,text,jsonb),public.authorize_inbox_native_block_dispatch(uuid,uuid,uuid,uuid),public.review_inbox_native_block(uuid,uuid,uuid,uuid,text,jsonb) TO service_role;
