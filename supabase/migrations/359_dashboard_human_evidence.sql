-- Removing a human message must not rewrite the fact that a person intervened.
DO $$
DECLARE definition text;before_text text := 'conversation_id=p_conversation_id AND deleted_at IS NULL AND sender_type=''agent''';
 after_text text := 'conversation_id=p_conversation_id AND sender_type=''agent''';
BEGIN
 definition=pg_catalog.pg_get_functiondef('public.write_dashboard_outcome(uuid,uuid,uuid,uuid,text)'::regprocedure);
 IF (length(definition)-length(replace(definition,before_text,'')))/length(before_text) <> 1 THEN RAISE EXCEPTION 'dashboard_writer_predecessor_changed';END IF;
 EXECUTE replace(definition,before_text,after_text);
END $$;
CREATE FUNCTION public.dashboard_human_evidence_ready() RETURNS boolean LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$
 SELECT public.dashboard_case_authority_ready() AND
 strpos(pg_catalog.pg_get_functiondef('public.write_dashboard_outcome(uuid,uuid,uuid,uuid,text)'::regprocedure),'conversation_id=p_conversation_id AND sender_type=''agent''')>0 AND
 strpos(pg_catalog.pg_get_functiondef('public.write_dashboard_outcome(uuid,uuid,uuid,uuid,text)'::regprocedure),'conversation_id=p_conversation_id AND deleted_at IS NULL AND sender_type=''agent''')=0;
$$;
REVOKE ALL ON FUNCTION public.dashboard_human_evidence_ready() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.dashboard_human_evidence_ready() TO service_role;
