-- Merge partial settings atomically so simultaneous UI/Operator saves do not lose fields.
BEGIN;
SET LOCAL lock_timeout = '5s';
CREATE OR REPLACE FUNCTION public.update_webchat_settings(p_workspace_id uuid, p_patch jsonb)
RETURNS public.channel_connections
LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$
  INSERT INTO public.channel_connections (workspace_id, channel, label, config, status)
  VALUES (p_workspace_id, 'webchat', 'Chat web', p_patch,
    CASE WHEN p_patch->>'enabled' = 'true' THEN 'connected' ELSE 'disconnected' END)
  ON CONFLICT (workspace_id) WHERE channel = 'webchat' DO UPDATE
  SET config = COALESCE(channel_connections.config, '{}'::jsonb) || EXCLUDED.config,
      status = CASE WHEN (COALESCE(channel_connections.config, '{}'::jsonb) || EXCLUDED.config)->>'enabled' = 'true' THEN 'connected' ELSE 'disconnected' END,
      updated_at = now()
  RETURNING *;
$$;
REVOKE ALL ON FUNCTION public.update_webchat_settings(uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_webchat_settings(uuid, jsonb) TO service_role;
NOTIFY pgrst, 'reload schema';
COMMIT;
