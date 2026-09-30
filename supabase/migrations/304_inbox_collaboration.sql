-- Private collaboration is deliberately separate from customer messages.
ALTER TABLE public.conversations ADD COLUMN IF NOT EXISTS case_priority text NOT NULL DEFAULT 'normal'
  CHECK (case_priority IN ('normal','high','urgent'));
ALTER TABLE public.conversations ADD COLUMN IF NOT EXISTS case_reason text
  CHECK (case_reason IN ('purchase','delivery','payment','return','other'));
CREATE INDEX IF NOT EXISTS conversations_case_work ON public.conversations(workspace_id, case_priority, case_reason);

CREATE TABLE IF NOT EXISTS public.conversation_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  author_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  body text NOT NULL CHECK (length(btrim(body)) BETWEEN 1 AND 5000),
  mentioned_user_ids uuid[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS conversation_notes_thread ON public.conversation_notes(workspace_id, conversation_id, created_at DESC, id DESC);
ALTER TABLE public.conversation_notes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.conversation_notes FROM anon, authenticated;
GRANT SELECT ON public.conversation_notes TO authenticated;
GRANT ALL ON public.conversation_notes TO service_role;
DROP POLICY IF EXISTS conversation_notes_read ON public.conversation_notes;
CREATE POLICY conversation_notes_read ON public.conversation_notes FOR SELECT TO authenticated USING (public.is_workspace_member(workspace_id)
  AND EXISTS (SELECT 1 FROM public.conversations c WHERE c.id = conversation_id AND c.deleted_at IS NULL
    AND (c.channel NOT IN ('gmail','outlook','zoho') OR EXISTS (SELECT 1 FROM public.channel_connections cc
      WHERE cc.id = c.connection_id AND cc.created_by = auth.uid()))));

CREATE TABLE IF NOT EXISTS public.workspace_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  note_id uuid NOT NULL REFERENCES public.conversation_notes(id) ON DELETE CASCADE,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(note_id, user_id)
);
CREATE INDEX IF NOT EXISTS workspace_notifications_inbox ON public.workspace_notifications(workspace_id, user_id, created_at DESC);
ALTER TABLE public.workspace_notifications ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.workspace_notifications FROM anon, authenticated;
GRANT SELECT ON public.workspace_notifications TO authenticated;
GRANT ALL ON public.workspace_notifications TO service_role;
DROP POLICY IF EXISTS workspace_notifications_read ON public.workspace_notifications;
CREATE POLICY workspace_notifications_read ON public.workspace_notifications FOR SELECT TO authenticated
  USING (user_id = auth.uid() AND public.is_workspace_member(workspace_id)
    AND EXISTS (SELECT 1 FROM public.conversations c WHERE c.id = conversation_id AND c.deleted_at IS NULL
      AND (c.channel NOT IN ('gmail','outlook','zoho') OR EXISTS (SELECT 1 FROM public.channel_connections cc
        WHERE cc.id = c.connection_id AND cc.created_by = auth.uid()))));

CREATE TABLE IF NOT EXISTS public.conversation_presence (
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  session_id uuid NOT NULL,
  composing boolean NOT NULL DEFAULT false,
  version bigint NOT NULL DEFAULT 0,
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (conversation_id, user_id, session_id)
);
CREATE INDEX IF NOT EXISTS conversation_presence_live ON public.conversation_presence(workspace_id, conversation_id, expires_at);
ALTER TABLE public.conversation_presence ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.conversation_presence FROM anon, authenticated;
GRANT ALL ON public.conversation_presence TO service_role;

CREATE OR REPLACE FUNCTION public.update_conversation_presence(p_workspace_id uuid, p_conversation_id uuid, p_user_id uuid, p_session_id uuid, p_composing boolean, p_version bigint)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.workspace_members WHERE workspace_id = p_workspace_id AND user_id = p_user_id)
    OR NOT EXISTS (SELECT 1 FROM public.conversations c WHERE c.workspace_id = p_workspace_id AND c.id = p_conversation_id AND c.deleted_at IS NULL
      AND (c.channel NOT IN ('gmail','outlook','zoho') OR EXISTS (SELECT 1 FROM public.channel_connections cc WHERE cc.id = c.connection_id AND cc.created_by = p_user_id)))
    OR p_version IS NULL OR p_version < 1 OR p_version > 9007199254740991
  THEN RAISE EXCEPTION 'invalid_presence_context'; END IF;
  DELETE FROM public.conversation_presence WHERE workspace_id = p_workspace_id AND expires_at < now() - interval '1 day';
  INSERT INTO public.conversation_presence(workspace_id,conversation_id,user_id,session_id,composing,version,expires_at)
    VALUES(p_workspace_id,p_conversation_id,p_user_id,p_session_id,p_composing,p_version,now() + interval '60 seconds')
    ON CONFLICT(conversation_id,user_id,session_id) DO UPDATE SET composing=EXCLUDED.composing,version=EXCLUDED.version,expires_at=EXCLUDED.expires_at
      WHERE conversation_presence.version < EXCLUDED.version;
END $$;
REVOKE ALL ON FUNCTION public.update_conversation_presence(uuid,uuid,uuid,uuid,boolean,bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_conversation_presence(uuid,uuid,uuid,uuid,boolean,bigint) TO service_role;

-- Idempotency and mention delivery share a transaction. No channel send call.
CREATE OR REPLACE FUNCTION public.add_conversation_note(p_id uuid, p_workspace_id uuid, p_conversation_id uuid, p_author_id uuid, p_body text, p_mentions uuid[])
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE existing public.conversation_notes;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.workspace_members WHERE workspace_id = p_workspace_id AND user_id = p_author_id)
    OR NOT EXISTS (SELECT 1 FROM public.conversations WHERE workspace_id = p_workspace_id AND id = p_conversation_id AND deleted_at IS NULL)
    OR length(btrim(p_body)) NOT BETWEEN 1 AND 5000 OR p_body IS NULL
    OR cardinality(p_mentions) > 20 OR p_mentions IS NULL
    OR EXISTS (SELECT 1 FROM unnest(p_mentions) u WHERE NOT EXISTS
      (SELECT 1 FROM public.workspace_members WHERE workspace_id = p_workspace_id AND user_id = u))
  THEN RAISE EXCEPTION 'invalid_note_context'; END IF;
  IF EXISTS (SELECT 1 FROM public.conversations c WHERE c.id = p_conversation_id AND c.channel IN ('gmail','outlook','zoho')
    AND (NOT EXISTS (SELECT 1 FROM public.channel_connections cc WHERE cc.id = c.connection_id AND cc.created_by = p_author_id)
      OR EXISTS (SELECT 1 FROM unnest(p_mentions) u WHERE u <> p_author_id)))
  THEN RAISE EXCEPTION 'invalid_note_context'; END IF;
  INSERT INTO public.conversation_notes(id, workspace_id, conversation_id, author_id, body, mentioned_user_ids)
    VALUES (p_id, p_workspace_id, p_conversation_id, p_author_id, btrim(p_body), p_mentions) ON CONFLICT(id) DO NOTHING;
  IF NOT FOUND THEN
    SELECT * INTO existing FROM public.conversation_notes WHERE id = p_id;
    IF existing.workspace_id <> p_workspace_id OR existing.conversation_id <> p_conversation_id
      OR existing.author_id IS DISTINCT FROM p_author_id OR existing.body <> btrim(p_body)
      OR existing.mentioned_user_ids <> p_mentions THEN RAISE EXCEPTION 'note_id_conflict'; END IF;
    RETURN p_id;
  END IF;
  INSERT INTO public.workspace_notifications(workspace_id, user_id, conversation_id, note_id)
    SELECT p_workspace_id, u, p_conversation_id, p_id FROM (SELECT DISTINCT unnest(p_mentions) AS u) m
      WHERE u <> p_author_id ON CONFLICT DO NOTHING;
  RETURN p_id;
END $$;
REVOKE ALL ON FUNCTION public.add_conversation_note(uuid, uuid, uuid, uuid, text, uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.add_conversation_note(uuid, uuid, uuid, uuid, text, uuid[]) TO service_role;

-- Keep existing personal filters and allow an explicitly shared view.
ALTER TABLE public.inbox_saved_filters ADD COLUMN IF NOT EXISTS is_shared boolean NOT NULL DEFAULT false;
DROP POLICY IF EXISTS inbox_saved_filters_select ON public.inbox_saved_filters;
CREATE POLICY inbox_saved_filters_select ON public.inbox_saved_filters FOR SELECT TO authenticated
  USING (public.is_workspace_member(workspace_id) AND (user_id = auth.uid() OR is_shared));
DROP POLICY IF EXISTS inbox_saved_filters_insert ON public.inbox_saved_filters;
CREATE POLICY inbox_saved_filters_insert ON public.inbox_saved_filters FOR INSERT TO authenticated
  WITH CHECK (public.is_workspace_member(workspace_id) AND user_id = auth.uid());
DROP POLICY IF EXISTS inbox_saved_filters_update ON public.inbox_saved_filters;
CREATE POLICY inbox_saved_filters_update ON public.inbox_saved_filters FOR UPDATE TO authenticated
  USING (public.is_workspace_member(workspace_id) AND user_id = auth.uid())
  WITH CHECK (public.is_workspace_member(workspace_id) AND user_id = auth.uid());
DROP POLICY IF EXISTS inbox_saved_filters_delete ON public.inbox_saved_filters;
CREATE POLICY inbox_saved_filters_delete ON public.inbox_saved_filters FOR DELETE TO authenticated
  USING (public.is_workspace_member(workspace_id) AND user_id = auth.uid());
CREATE TABLE IF NOT EXISTS public.conversation_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  source_conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  target_conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  linked_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  linked_at timestamptz NOT NULL DEFAULT now(),
  unlinked_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  unlinked_at timestamptz,
  CHECK (source_conversation_id < target_conversation_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS conversation_links_active ON public.conversation_links(workspace_id,source_conversation_id,target_conversation_id) WHERE unlinked_at IS NULL;
ALTER TABLE public.conversation_links ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.conversation_links FROM anon, authenticated;
GRANT ALL ON public.conversation_links TO service_role;
CREATE OR REPLACE FUNCTION public.check_conversation_link() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.workspace_members WHERE workspace_id = NEW.workspace_id AND user_id = NEW.linked_by)
    OR NOT EXISTS (SELECT 1 FROM public.conversations a JOIN public.conversations b ON a.contact_id = b.contact_id
      WHERE a.id = NEW.source_conversation_id AND b.id = NEW.target_conversation_id
        AND a.workspace_id = NEW.workspace_id AND b.workspace_id = NEW.workspace_id AND a.deleted_at IS NULL AND b.deleted_at IS NULL
        AND (a.channel NOT IN ('gmail','outlook','zoho') OR EXISTS(SELECT 1 FROM public.channel_connections cc WHERE cc.id = a.connection_id AND cc.created_by = NEW.linked_by))
        AND (b.channel NOT IN ('gmail','outlook','zoho') OR EXISTS(SELECT 1 FROM public.channel_connections cc WHERE cc.id = b.connection_id AND cc.created_by = NEW.linked_by)))
  THEN RAISE EXCEPTION 'invalid_conversation_link'; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS check_conversation_link ON public.conversation_links;
CREATE TRIGGER check_conversation_link BEFORE INSERT ON public.conversation_links FOR EACH ROW EXECUTE FUNCTION public.check_conversation_link();
REVOKE ALL ON FUNCTION public.check_conversation_link() FROM PUBLIC, anon, authenticated;
NOTIFY pgrst, 'reload schema';
