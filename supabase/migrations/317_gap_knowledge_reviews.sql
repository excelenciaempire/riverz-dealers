-- Review supervised knowledge in the existing FAQ/rule destinations, with a
-- durable receipt. No customer sends and no automatic policy extraction.
-- An erased case must not turn a previously private question into a generic
-- workspace question. Legacy orphans have no recoverable source: fail closed.
ALTER TABLE public.answer_gaps ADD COLUMN IF NOT EXISTS source_conversation_required boolean NOT NULL DEFAULT true;
CREATE OR REPLACE FUNCTION public.gap_provenance_before() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='INSERT' THEN NEW.source_conversation_required=NEW.conversation_id IS NOT NULL;
 ELSE
  IF NEW.workspace_id IS DISTINCT FROM OLD.workspace_id OR (NEW.conversation_id IS NOT NULL AND NEW.conversation_id IS DISTINCT FROM OLD.conversation_id) THEN RAISE EXCEPTION 'invalid_gap_context';END IF;
  NEW.source_conversation_required=OLD.source_conversation_required OR NEW.conversation_id IS NOT NULL;
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS gap_provenance_before ON public.answer_gaps;
CREATE TRIGGER gap_provenance_before BEFORE INSERT OR UPDATE OF workspace_id,conversation_id,source_conversation_required ON public.answer_gaps FOR EACH ROW EXECUTE FUNCTION public.gap_provenance_before();
CREATE OR REPLACE FUNCTION public.gap_visible(p_workspace uuid,p_actor uuid,p_gap uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM workspace_members m JOIN answer_gaps g ON g.workspace_id=m.workspace_id
 LEFT JOIN conversations c ON c.id=g.conversation_id AND c.workspace_id=g.workspace_id
 WHERE (auth.uid() IS NULL OR auth.uid()=p_actor) AND m.workspace_id=p_workspace AND m.user_id=p_actor AND g.id=p_gap AND
 ((g.conversation_id IS NULL AND NOT g.source_conversation_required AND g.channel IN ('whatsapp','instagram','messenger','ig_comment','fb_comment','tiktok_comment','mercadolibre','webchat','voice')) OR
 (c.id IS NOT NULL AND c.deleted_at IS NULL AND
 (c.channel NOT IN ('gmail','outlook','zoho') OR EXISTS(SELECT 1 FROM channel_connections cc WHERE cc.id=c.connection_id AND cc.workspace_id=c.workspace_id AND cc.created_by=p_actor)))))
$$;
REVOKE ALL ON FUNCTION public.gap_visible(uuid,uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.gap_visible(uuid,uuid,uuid) TO authenticated,service_role;
DROP POLICY IF EXISTS answer_gaps_miembros ON public.answer_gaps;
DROP POLICY IF EXISTS answer_gaps_read ON public.answer_gaps;
CREATE POLICY answer_gaps_read ON public.answer_gaps FOR SELECT TO authenticated USING(public.gap_visible(workspace_id,auth.uid(),id));
REVOKE INSERT,UPDATE,DELETE ON public.answer_gaps FROM authenticated,anon;
GRANT SELECT ON public.answer_gaps TO authenticated;

CREATE TABLE IF NOT EXISTS public.gap_knowledge_reviews (
 id uuid PRIMARY KEY,
 workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
 actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
 question_key text NOT NULL,
 question text NOT NULL,
 answer text NOT NULL,
 destination text NOT NULL CHECK(destination IN ('producto','regla')),
 target_id uuid,
 target_title text NOT NULL,
 source_ids uuid[] NOT NULL,
 expected_snapshot jsonb,
 prepared jsonb NOT NULL,
 previous_answers jsonb NOT NULL DEFAULT '[]',
 state text NOT NULL DEFAULT 'review' CHECK(state IN ('review','published')),
 created_at timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz NOT NULL DEFAULT now()+interval '10 minutes',
 published_at timestamptz,
 CHECK(length(question_key) BETWEEN 1 AND 200 AND length(question) BETWEEN 1 AND 500 AND length(answer) BETWEEN 1 AND 2000),
 CHECK(cardinality(source_ids) BETWEEN 1 AND 500)
);
CREATE INDEX IF NOT EXISTS gap_knowledge_workspace_time ON public.gap_knowledge_reviews(workspace_id,created_at DESC);
ALTER TABLE public.gap_knowledge_reviews ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.gap_knowledge_reviews FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.gap_knowledge_reviews TO authenticated;
GRANT ALL ON public.gap_knowledge_reviews TO service_role;
DROP POLICY IF EXISTS gap_knowledge_read ON public.gap_knowledge_reviews;
CREATE POLICY gap_knowledge_read ON public.gap_knowledge_reviews FOR SELECT TO authenticated
 USING(public.is_workspace_member(workspace_id) AND NOT EXISTS(SELECT 1 FROM unnest(source_ids) AS s(id) WHERE NOT public.gap_visible(workspace_id,auth.uid(),s.id)));

CREATE OR REPLACE FUNCTION public.gap_guidance_key(p_key text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
 SELECT CASE WHEN length(p_key)<=194 THEN 'hueco_'||p_key ELSE 'hueco_'||left(p_key,157)||'_'||md5(p_key) END
$$;
CREATE OR REPLACE FUNCTION public.gap_existing_guidance(p_workspace_id uuid,p_actor_id uuid,p_key text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE snapshot jsonb;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM workspace_members WHERE workspace_id=p_workspace_id AND user_id=p_actor_id) THEN RAISE EXCEPTION 'invalid_gap_context';END IF;
 SELECT to_jsonb(g) INTO snapshot FROM agent_guidance g WHERE workspace_id=p_workspace_id AND clave=public.gap_guidance_key(p_key);
 RETURN snapshot;
END $$;
REVOKE ALL ON FUNCTION public.gap_existing_guidance(uuid,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.gap_existing_guidance(uuid,uuid,text) TO service_role;

CREATE OR REPLACE FUNCTION public.list_visible_answer_gaps(p_workspace_id uuid,p_actor_id uuid,p_resolved boolean DEFAULT false,p_conversation_id uuid DEFAULT NULL)
RETURNS SETOF public.answer_gaps LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM workspace_members WHERE workspace_id=p_workspace_id AND user_id=p_actor_id) THEN RAISE EXCEPTION 'invalid_gap_context';END IF;
 RETURN QUERY SELECT g.* FROM answer_gaps g WHERE g.workspace_id=p_workspace_id AND (p_conversation_id IS NULL OR g.conversation_id=p_conversation_id) AND (p_resolved OR g.resolved_at IS NULL)
 AND public.gap_visible(p_workspace_id,p_actor_id,g.id) ORDER BY g.created_at DESC,g.id LIMIT 501;
END $$;
CREATE OR REPLACE FUNCTION public.resolve_visible_answer_gaps(p_workspace_id uuid,p_actor_id uuid,p_key text)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE n integer;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM workspace_members WHERE workspace_id=p_workspace_id AND user_id=p_actor_id) THEN RAISE EXCEPTION 'invalid_gap_context';END IF;
 IF public.workspace_billing_write_allowed(p_workspace_id) IS DISTINCT FROM true THEN RAISE EXCEPTION 'subscription_read_only';END IF;
 UPDATE answer_gaps g SET resolved_at=now(),resolved_by=p_actor_id WHERE workspace_id=p_workspace_id AND question_key=p_key AND resolved_at IS NULL AND public.gap_visible(p_workspace_id,p_actor_id,g.id);
 GET DIAGNOSTICS n=ROW_COUNT;
 IF n=0 THEN RAISE EXCEPTION 'invalid_gap_context';END IF;
 RETURN n;
END $$;

CREATE OR REPLACE FUNCTION public.prepare_gap_knowledge_review(p_id uuid,p_workspace_id uuid,p_actor_id uuid,p_key text,p_question text,p_answer text,p_destination text,p_target_id uuid,p_target_title text,p_source_ids uuid[],p_expected jsonb,p_prepared jsonb,p_previous jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE r public.gap_knowledge_reviews;snapshot jsonb;
BEGIN
 IF p_id IS NULL OR p_key IS NULL OR p_question IS NULL OR p_answer IS NULL OR p_target_title IS NULL OR length(p_target_title)>500 OR NOT EXISTS(SELECT 1 FROM workspace_members WHERE workspace_id=p_workspace_id AND user_id=p_actor_id)
 OR length(trim(p_key)) NOT BETWEEN 1 AND 200 OR length(trim(p_question)) NOT BETWEEN 1 AND 500 OR length(trim(p_answer)) NOT BETWEEN 1 AND 2000
 OR p_destination NOT IN ('producto','regla') OR p_destination IS NULL OR p_source_ids IS NULL OR cardinality(p_source_ids) NOT BETWEEN 1 AND 500
 OR cardinality(p_source_ids)<>(SELECT count(DISTINCT s) FROM unnest(p_source_ids) AS s)
 OR EXISTS(SELECT 1 FROM unnest(p_source_ids) AS s(id) WHERE s.id IS NULL OR NOT public.gap_visible(p_workspace_id,p_actor_id,s.id)
 OR NOT EXISTS(SELECT 1 FROM answer_gaps g WHERE g.id=s.id AND g.question_key=p_key AND g.resolved_at IS NULL))
 OR NOT EXISTS(SELECT 1 FROM answer_gaps g WHERE g.id=ANY(p_source_ids) AND g.question=p_question)
 THEN RAISE EXCEPTION 'invalid_gap_context';END IF;
 IF public.workspace_billing_write_allowed(p_workspace_id) IS DISTINCT FROM true THEN RAISE EXCEPTION 'subscription_read_only';END IF;
 IF p_destination='regla' AND NOT EXISTS(SELECT 1 FROM workspace_members WHERE workspace_id=p_workspace_id AND user_id=p_actor_id AND role IN ('owner','admin')) THEN RAISE EXCEPTION 'gap_admin_required';END IF;
 IF p_destination='producto' THEN
  SELECT to_jsonb(p) INTO snapshot FROM shopify_products p WHERE p.id=p_target_id AND p.workspace_id=p_workspace_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'invalid_gap_context';END IF;
  IF snapshot IS DISTINCT FROM p_expected THEN RAISE EXCEPTION 'gap_changed';END IF;
  IF jsonb_typeof(p_prepared->'custom_faqs') IS DISTINCT FROM 'array' OR jsonb_typeof(p_prepared->'training_material') IS DISTINCT FROM 'string' OR p_prepared-'custom_faqs'-'training_material'<>'{}'::jsonb
   OR NOT (p_prepared->'custom_faqs' @> jsonb_build_array(jsonb_build_object('q',p_question,'a',p_answer))) THEN RAISE EXCEPTION 'invalid_gap_context';END IF;
 ELSE
  SELECT to_jsonb(g) INTO snapshot FROM agent_guidance g WHERE g.workspace_id=p_workspace_id AND g.clave=public.gap_guidance_key(p_key);
  IF snapshot IS DISTINCT FROM nullif(p_expected,'null'::jsonb) OR p_target_id IS DISTINCT FROM (snapshot->>'id')::uuid THEN RAISE EXCEPTION 'gap_changed';END IF;
  IF p_prepared IS DISTINCT FROM '{}'::jsonb THEN RAISE EXCEPTION 'invalid_gap_context';END IF;
 END IF;
 INSERT INTO gap_knowledge_reviews(id,workspace_id,actor_id,question_key,question,answer,destination,target_id,target_title,source_ids,expected_snapshot,prepared,previous_answers)
 VALUES(p_id,p_workspace_id,p_actor_id,p_key,p_question,p_answer,p_destination,p_target_id,p_target_title,p_source_ids,nullif(p_expected,'null'::jsonb),p_prepared,p_previous) RETURNING * INTO r;
 RETURN jsonb_build_object('id',r.id,'destination',r.destination,'target_title',r.target_title,'question',r.question,'answer',r.answer,'previous_answers',r.previous_answers,'source_count',cardinality(r.source_ids),'expires_at',r.expires_at);
END $$;

CREATE OR REPLACE FUNCTION public.confirm_gap_knowledge_review(p_workspace_id uuid,p_actor_id uuid,p_review_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE r public.gap_knowledge_reviews;snapshot jsonb;result_id uuid;n integer;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM workspace_members WHERE workspace_id=p_workspace_id AND user_id=p_actor_id) THEN RAISE EXCEPTION 'invalid_gap_context';END IF;
 SELECT * INTO r FROM gap_knowledge_reviews WHERE id=p_review_id AND workspace_id=p_workspace_id AND actor_id=p_actor_id FOR UPDATE;
 IF NOT FOUND OR EXISTS(SELECT 1 FROM unnest(r.source_ids) AS s(id) WHERE NOT public.gap_visible(p_workspace_id,p_actor_id,s.id)) THEN RAISE EXCEPTION 'invalid_gap_context';END IF;
 -- Exact receipt replay is safe and remains readable even if billing became read-only.
 IF r.state='published' THEN RETURN jsonb_build_object('ok',true,'destino',r.destination,'target_id',r.target_id,'published_at',r.published_at,'replayed',true);END IF;
 IF r.expires_at<=clock_timestamp() OR EXISTS(SELECT 1 FROM answer_gaps WHERE id=ANY(r.source_ids) AND resolved_at IS NOT NULL) THEN RAISE EXCEPTION 'gap_changed';END IF;
 IF public.workspace_billing_write_allowed(p_workspace_id) IS DISTINCT FROM true THEN RAISE EXCEPTION 'subscription_read_only';END IF;
 IF r.destination='regla' AND NOT EXISTS(SELECT 1 FROM workspace_members WHERE workspace_id=p_workspace_id AND user_id=p_actor_id AND role IN ('owner','admin')) THEN RAISE EXCEPTION 'gap_admin_required';END IF;
 PERFORM 1 FROM workspace_members WHERE workspace_id=p_workspace_id AND user_id=p_actor_id AND (r.destination<>'regla' OR role IN ('owner','admin')) FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'invalid_gap_context';END IF;
 -- Consistent lock order for simultaneous FAQ/rule publications in this workspace.
 PERFORM 1 FROM workspaces WHERE id=p_workspace_id FOR UPDATE;
 PERFORM 1 FROM answer_gaps WHERE id=ANY(r.source_ids) ORDER BY id FOR UPDATE;
 PERFORM c.id FROM conversations c JOIN answer_gaps g ON g.conversation_id=c.id WHERE g.id=ANY(r.source_ids) FOR SHARE OF c;
 PERFORM cc.id FROM channel_connections cc JOIN conversations c ON c.connection_id=cc.id JOIN answer_gaps g ON g.conversation_id=c.id WHERE g.id=ANY(r.source_ids) FOR SHARE OF cc;
 IF EXISTS(SELECT 1 FROM unnest(r.source_ids) AS s(id) WHERE NOT public.gap_visible(p_workspace_id,p_actor_id,s.id)) THEN RAISE EXCEPTION 'invalid_gap_context';END IF;
 IF r.expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'gap_changed';END IF;
 IF public.workspace_billing_write_allowed(p_workspace_id) IS DISTINCT FROM true THEN RAISE EXCEPTION 'subscription_read_only';END IF;
 IF EXISTS(SELECT 1 FROM answer_gaps WHERE id=ANY(r.source_ids) AND resolved_at IS NOT NULL) THEN RAISE EXCEPTION 'gap_changed';END IF;
 IF r.destination='producto' THEN
  SELECT to_jsonb(p) INTO snapshot FROM shopify_products p WHERE p.id=r.target_id AND p.workspace_id=p_workspace_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'invalid_gap_context';END IF;
  IF snapshot IS DISTINCT FROM r.expected_snapshot THEN RAISE EXCEPTION 'gap_changed';END IF;
  UPDATE shopify_products SET custom_faqs=r.prepared->'custom_faqs',training_material=r.prepared->>'training_material' WHERE id=r.target_id AND workspace_id=p_workspace_id;
  result_id=r.target_id;
 ELSE
  SELECT to_jsonb(g) INTO snapshot FROM agent_guidance g WHERE g.workspace_id=p_workspace_id AND g.clave=public.gap_guidance_key(r.question_key) FOR UPDATE;
  IF snapshot IS DISTINCT FROM r.expected_snapshot THEN RAISE EXCEPTION 'gap_changed';END IF;
  PERFORM set_config('riverz.guidance_actor',p_actor_id::text,true);
  INSERT INTO agent_guidance(workspace_id,agent_id,titulo,cuando,hacer,activa,origen,clave)
  VALUES(p_workspace_id,NULL,left(r.question,120),'Preguntan: "'||r.question||'"',r.answer,true,'hueco',public.gap_guidance_key(r.question_key))
  ON CONFLICT(workspace_id,clave) DO UPDATE SET titulo=EXCLUDED.titulo,cuando=EXCLUDED.cuando,hacer=EXCLUDED.hacer,activa=true,agent_id=NULL,origen='hueco'
  RETURNING id INTO result_id;
 END IF;
 UPDATE answer_gaps SET resolved_at=now(),resolved_by=p_actor_id WHERE id=ANY(r.source_ids) AND workspace_id=p_workspace_id AND resolved_at IS NULL;
 GET DIAGNOSTICS n=ROW_COUNT;
 IF n<>cardinality(r.source_ids) THEN RAISE EXCEPTION 'gap_changed';END IF;
 -- Keep the human answer and provenance, discard bulky preparation snapshots.
 UPDATE gap_knowledge_reviews SET state='published',target_id=result_id,published_at=now(),expected_snapshot=NULL,prepared='{}' WHERE id=r.id RETURNING * INTO r;
 RETURN jsonb_build_object('ok',true,'destino',r.destination,'target_id',r.target_id,'published_at',r.published_at,'resolved_count',n,'replayed',false);
END $$;
REVOKE ALL ON FUNCTION public.list_visible_answer_gaps(uuid,uuid,boolean,uuid),public.resolve_visible_answer_gaps(uuid,uuid,text),public.prepare_gap_knowledge_review(uuid,uuid,uuid,text,text,text,text,uuid,text,uuid[],jsonb,jsonb,jsonb),public.confirm_gap_knowledge_review(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.list_visible_answer_gaps(uuid,uuid,boolean,uuid),public.resolve_visible_answer_gaps(uuid,uuid,text),public.prepare_gap_knowledge_review(uuid,uuid,uuid,text,text,text,text,uuid,text,uuid[],jsonb,jsonb,jsonb),public.confirm_gap_knowledge_review(uuid,uuid,uuid) TO service_role;
NOTIFY pgrst,'reload schema';
