-- Read-only case cohorts. A rating, silence or closure is not verified resolution.
CREATE INDEX IF NOT EXISTS conversations_case_reason_cohort
  ON public.conversations(workspace_id,created_at DESC,id DESC)
  WHERE deleted_at IS NULL AND NOT coalesce(is_spam,false);
CREATE OR REPLACE FUNCTION public.case_reason_report(
  p_workspace_id uuid,p_actor_id uuid,p_start timestamptz,p_end timestamptz,
  p_previous_start timestamptz,p_previous_end timestamptz,p_reason text DEFAULT NULL,
  p_cursor_at timestamptz DEFAULT NULL,p_cursor_id uuid DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE summary jsonb; cases jsonb; next_cursor jsonb;
BEGIN
  IF p_workspace_id IS NULL OR p_actor_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.workspace_members WHERE workspace_id=p_workspace_id AND user_id=p_actor_id
  ) THEN RAISE EXCEPTION 'invalid_case_reason_context'; END IF;
  IF p_start IS NULL OR p_end IS NULL OR p_previous_start IS NULL OR p_previous_end IS NULL
    OR p_start >= p_end OR p_previous_start >= p_previous_end OR p_previous_start >= p_start OR p_previous_end > p_end
    OR p_end-p_start > interval '180 days' OR p_previous_end-p_previous_start > interval '180 days'
    OR (p_reason IS NOT NULL AND p_reason NOT IN ('purchase','delivery','payment','return','other','unclassified'))
    OR ((p_cursor_at IS NULL) <> (p_cursor_id IS NULL)) OR (p_reason IS NULL AND p_cursor_id IS NOT NULL)
  THEN RAISE EXCEPTION 'invalid_case_reason_range'; END IF;

  WITH visible AS (
    SELECT c.case_reason,c.csat,c.created_at FROM public.conversations c
    WHERE c.workspace_id=p_workspace_id AND c.deleted_at IS NULL AND NOT coalesce(c.is_spam,false)
      AND ((c.created_at >= p_start AND c.created_at < p_end)
        OR (c.created_at >= p_previous_start AND c.created_at < p_previous_end))
      AND (c.channel NOT IN ('gmail','outlook','zoho') OR EXISTS (
        SELECT 1 FROM public.channel_connections cc WHERE cc.id=c.connection_id AND cc.workspace_id=p_workspace_id AND cc.created_by=p_actor_id
      ))
  ), buckets AS (
    SELECT reason,
      count(v.created_at) FILTER (WHERE v.created_at>=p_start AND v.created_at<p_end) AS current_count,
      count(v.created_at) FILTER (WHERE v.created_at>=p_previous_start AND v.created_at<p_previous_end) AS previous_count,
      count(v.created_at) FILTER (WHERE v.created_at>=p_start AND v.created_at<p_end AND v.csat IN (-1,1)) AS rated_count,
      count(v.created_at) FILTER (WHERE v.created_at>=p_start AND v.created_at<p_end AND v.csat=1) AS positive_count
    FROM unnest(ARRAY['purchase','delivery','payment','return','other','unclassified']) reason
    LEFT JOIN visible v ON coalesce(v.case_reason,'unclassified')=reason GROUP BY reason
  ) SELECT jsonb_agg(jsonb_build_object('reason',reason,'current_count',current_count,'previous_count',previous_count,
    'rated_count',rated_count,'positive_count',positive_count) ORDER BY current_count DESC,reason) INTO summary FROM buckets;

  IF p_reason IS NOT NULL THEN
    WITH page AS (
      SELECT c.id,c.channel,c.created_at,coalesce(c.case_reason,'unclassified') AS reason,c.csat
      FROM public.conversations c WHERE c.workspace_id=p_workspace_id AND c.deleted_at IS NULL AND NOT coalesce(c.is_spam,false)
        AND c.created_at>=p_start AND c.created_at<p_end AND coalesce(c.case_reason,'unclassified')=p_reason
        AND (c.channel NOT IN ('gmail','outlook','zoho') OR EXISTS (
          SELECT 1 FROM public.channel_connections cc WHERE cc.id=c.connection_id AND cc.workspace_id=p_workspace_id AND cc.created_by=p_actor_id
        ))
        AND (p_cursor_id IS NULL OR (c.created_at,c.id)<(p_cursor_at,p_cursor_id))
      ORDER BY c.created_at DESC,c.id DESC LIMIT 21
    ), numbered AS (SELECT *,row_number() OVER(ORDER BY created_at DESC,id DESC) AS n FROM page)
    SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'channel',channel,'created_at',created_at,'reason',reason,
        'csat',CASE WHEN csat IN (-1,1) THEN csat ELSE NULL END) ORDER BY created_at DESC,id DESC) FILTER(WHERE n<=20),'[]'::jsonb),
      CASE WHEN count(*)>20 THEN (jsonb_agg(jsonb_build_object('created_at',created_at,'id',id) ORDER BY created_at DESC,id DESC)->19) ELSE NULL END
    INTO cases,next_cursor FROM numbered;
  END IF;
  RETURN jsonb_build_object('start',p_start,'end',p_end,'previous_start',p_previous_start,'previous_end',p_previous_end,
    'observed_at',statement_timestamp(),'rows',summary,'selected_reason',p_reason,'cases',cases,'next_cursor',next_cursor);
END;
$$;
REVOKE ALL ON FUNCTION public.case_reason_report(uuid,uuid,timestamptz,timestamptz,timestamptz,timestamptz,text,timestamptz,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.case_reason_report(uuid,uuid,timestamptz,timestamptz,timestamptz,timestamptz,text,timestamptz,uuid) TO service_role;
NOTIFY pgrst,'reload schema';
