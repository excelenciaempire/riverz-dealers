ALTER TABLE public.conversations ADD COLUMN IF NOT EXISTS manual_unread boolean NOT NULL DEFAULT false;
ALTER TABLE public.conversations ADD COLUMN IF NOT EXISTS is_spam boolean NOT NULL DEFAULT false;
ALTER TABLE public.conversations ADD COLUMN IF NOT EXISTS inbox_control_version bigint NOT NULL DEFAULT 0 CHECK(inbox_control_version>=0);
-- Existing client updates remain compatible; the new controls require the audited RPC.
CREATE OR REPLACE FUNCTION public.protect_inbox_disposition() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_user IN ('authenticated','anon') AND
    (NEW.manual_unread IS DISTINCT FROM OLD.manual_unread OR NEW.is_spam IS DISTINCT FROM OLD.is_spam OR NEW.inbox_control_version IS DISTINCT FROM OLD.inbox_control_version)
    THEN RAISE EXCEPTION 'inbox_disposition_command_required'; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS protect_inbox_disposition ON public.conversations;
CREATE TRIGGER protect_inbox_disposition BEFORE UPDATE ON public.conversations FOR EACH ROW EXECUTE FUNCTION public.protect_inbox_disposition();
CREATE TABLE IF NOT EXISTS public.inbox_disposition_events (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  action text NOT NULL CHECK(action IN ('read','unread','spam','restore')),
  expected_version bigint NOT NULL,
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS inbox_disposition_case ON public.inbox_disposition_events(workspace_id,conversation_id,created_at DESC);
ALTER TABLE public.inbox_disposition_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.inbox_disposition_events FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.inbox_disposition_events TO authenticated;
GRANT ALL ON public.inbox_disposition_events TO service_role;
DROP POLICY IF EXISTS inbox_disposition_read ON public.inbox_disposition_events;
CREATE POLICY inbox_disposition_read ON public.inbox_disposition_events FOR SELECT TO authenticated USING(
  public.is_workspace_member(workspace_id) AND EXISTS(SELECT 1 FROM public.conversations c
  WHERE c.id=conversation_id AND c.workspace_id=inbox_disposition_events.workspace_id AND c.deleted_at IS NULL
    AND (c.channel NOT IN ('gmail','outlook','zoho') OR EXISTS(SELECT 1 FROM public.channel_connections cc WHERE cc.id=c.connection_id AND cc.created_by=auth.uid()))));
CREATE OR REPLACE FUNCTION public.set_inbox_disposition(p_id uuid,p_workspace_id uuid,p_conversation_id uuid,p_actor_id uuid,p_action text,p_expected_version bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE c public.conversations; prior public.inbox_disposition_events; answer jsonb;
BEGIN
  IF p_id IS NULL OR p_action IS NULL OR p_action NOT IN ('read','unread','spam','restore') OR p_expected_version IS NULL OR p_expected_version<0
    OR NOT EXISTS(SELECT 1 FROM public.workspace_members WHERE workspace_id=p_workspace_id AND user_id=p_actor_id)
    THEN RAISE EXCEPTION 'invalid_inbox_disposition'; END IF;
  SELECT * INTO c FROM public.conversations WHERE workspace_id=p_workspace_id AND id=p_conversation_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND OR (c.channel IN ('gmail','outlook','zoho') AND NOT EXISTS(SELECT 1 FROM public.channel_connections cc WHERE cc.id=c.connection_id AND cc.created_by=p_actor_id))
    THEN RAISE EXCEPTION 'invalid_inbox_disposition'; END IF;
  SELECT * INTO prior FROM public.inbox_disposition_events WHERE id=p_id;
  IF FOUND THEN
    IF prior.workspace_id IS DISTINCT FROM p_workspace_id OR prior.conversation_id IS DISTINCT FROM p_conversation_id OR prior.actor_id IS DISTINCT FROM p_actor_id
      OR prior.action IS DISTINCT FROM p_action OR prior.expected_version IS DISTINCT FROM p_expected_version THEN RAISE EXCEPTION 'inbox_disposition_conflict'; END IF;
    RETURN prior.result;
  END IF;
  IF c.inbox_control_version<>p_expected_version THEN RAISE EXCEPTION 'inbox_disposition_changed'; END IF;
  -- Reading remains available when the business is read-only. Edits do not.
  IF p_action<>'read' AND public.workspace_billing_write_allowed(p_workspace_id) IS DISTINCT FROM true THEN RAISE EXCEPTION 'subscription_read_only'; END IF;
  UPDATE public.conversations SET
    manual_unread=CASE WHEN p_action='unread' THEN true WHEN p_action='read' THEN false ELSE manual_unread END,
    unread_count=CASE WHEN p_action='read' THEN 0 WHEN p_action='unread' THEN greatest(coalesce(unread_count,0),1) ELSE unread_count END,
    is_spam=CASE WHEN p_action='spam' THEN true WHEN p_action='restore' THEN false ELSE is_spam END,
    inbox_control_version=inbox_control_version+1,updated_at=now()
    WHERE id=p_conversation_id RETURNING jsonb_build_object('manual_unread',manual_unread,'unread_count',unread_count,'is_spam',is_spam,'version',inbox_control_version) INTO answer;
  INSERT INTO public.inbox_disposition_events(id,workspace_id,conversation_id,actor_id,action,expected_version,result)
    VALUES(p_id,p_workspace_id,p_conversation_id,p_actor_id,p_action,p_expected_version,answer);
  RETURN answer;
END $$;
REVOKE ALL ON FUNCTION public.set_inbox_disposition(uuid,uuid,uuid,uuid,text,bigint) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.set_inbox_disposition(uuid,uuid,uuid,uuid,text,bigint) TO service_role;
