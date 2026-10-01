-- Read-only aggregation: no pending execution or run history is changed.
CREATE OR REPLACE FUNCTION public.automation_waiting_counts(
  p_workspace_id uuid, p_automation_id uuid, p_actor_id uuid
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE result jsonb;
BEGIN
  IF p_workspace_id IS NULL OR p_automation_id IS NULL OR p_actor_id IS NULL
    OR NOT EXISTS (SELECT 1 FROM public.workspace_members WHERE workspace_id = p_workspace_id AND user_id = p_actor_id)
    OR NOT EXISTS (SELECT 1 FROM public.automations WHERE workspace_id = p_workspace_id AND id = p_automation_id AND deleted_at IS NULL)
  THEN RAISE EXCEPTION 'automation_waiting_not_found'; END IF;

  WITH waits AS (
    SELECT s.id, count(p.id) AS waiting
    FROM public.automation_steps s
    JOIN public.automation_pending_executions p
      ON p.automation_id = p_automation_id AND p.workspace_id = p_workspace_id AND p.status = 'pending'
      AND p.parent_step_id IS NOT DISTINCT FROM s.parent_step_id
      AND p.branch IS NOT DISTINCT FROM s.branch
      AND p.next_step_position = s.position + 1
    WHERE s.automation_id = p_automation_id AND s.step_type = 'wait'
    GROUP BY s.id
  )
  SELECT jsonb_build_object(
    'counts', coalesce(jsonb_object_agg(id::text, waiting), '{}'::jsonb),
    'total', coalesce(sum(waiting), 0)
  ) INTO result FROM waits;
  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.automation_waiting_counts(uuid,uuid,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.automation_waiting_counts(uuid,uuid,uuid) TO service_role;
NOTIFY pgrst, 'reload schema';
