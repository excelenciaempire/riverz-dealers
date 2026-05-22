-- ============================================================
-- Unified inbox migration: workspaces + multi-channel.
--
-- Transforms the single-tenant WhatsApp-only schema into a
-- multi-tenant multi-channel inbox.
--
--   * workspaces + workspace_members (admin/agent roles)
--   * channel enum across contacts/conversations/messages
--   * channel_connections (generic replacement for whatsapp_config)
--   * external_id on contacts (PSID, IG id, email, etc.)
--   * comments_meta for ad/post comments
--
-- Idempotent — safe to re-run during development.
-- ============================================================

-- ── 1. WORKSPACES ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS workspaces (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  slug TEXT UNIQUE,
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_workspaces_owner ON workspaces(owner_id);

ALTER TABLE workspaces ENABLE ROW LEVEL SECURITY;

-- ── 2. WORKSPACE_MEMBERS ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS workspace_members (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'agent' CHECK (role IN ('admin', 'agent')),
  invited_email TEXT,
  invited_by UUID REFERENCES auth.users(id),
  joined_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (workspace_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_members_user ON workspace_members(user_id);
CREATE INDEX IF NOT EXISTS idx_members_workspace ON workspace_members(workspace_id);

ALTER TABLE workspace_members ENABLE ROW LEVEL SECURITY;

-- ── 3. WORKSPACE_INVITES (pre-signup invites) ───────────────────
CREATE TABLE IF NOT EXISTS workspace_invites (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'agent' CHECK (role IN ('admin', 'agent')),
  token TEXT NOT NULL UNIQUE,
  invited_by UUID NOT NULL REFERENCES auth.users(id),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '14 days'),
  accepted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_invites_workspace ON workspace_invites(workspace_id);
CREATE INDEX IF NOT EXISTS idx_invites_email ON workspace_invites(email);

ALTER TABLE workspace_invites ENABLE ROW LEVEL SECURITY;

-- ── 4. HELPERS: is_workspace_member / is_workspace_admin ────────
CREATE OR REPLACE FUNCTION is_workspace_member(p_workspace UUID)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM workspace_members
    WHERE workspace_id = p_workspace
      AND user_id = auth.uid()
  );
$$ LANGUAGE sql STABLE SECURITY DEFINER;

CREATE OR REPLACE FUNCTION is_workspace_admin(p_workspace UUID)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM workspace_members
    WHERE workspace_id = p_workspace
      AND user_id = auth.uid()
      AND role = 'admin'
  );
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- ── 5. WORKSPACE RLS POLICIES ───────────────────────────────────
DROP POLICY IF EXISTS "Members can view workspaces" ON workspaces;
CREATE POLICY "Members can view workspaces" ON workspaces FOR SELECT
  USING (is_workspace_member(id));

DROP POLICY IF EXISTS "Admins can update workspaces" ON workspaces;
CREATE POLICY "Admins can update workspaces" ON workspaces FOR UPDATE
  USING (is_workspace_admin(id));

DROP POLICY IF EXISTS "Authenticated can create workspaces" ON workspaces;
CREATE POLICY "Authenticated can create workspaces" ON workspaces FOR INSERT
  WITH CHECK (auth.uid() = owner_id);

DROP POLICY IF EXISTS "Owners can delete workspaces" ON workspaces;
CREATE POLICY "Owners can delete workspaces" ON workspaces FOR DELETE
  USING (auth.uid() = owner_id);

DROP POLICY IF EXISTS "Members can view memberships" ON workspace_members;
CREATE POLICY "Members can view memberships" ON workspace_members FOR SELECT
  USING (is_workspace_member(workspace_id));

DROP POLICY IF EXISTS "Admins can manage memberships" ON workspace_members;
CREATE POLICY "Admins can manage memberships" ON workspace_members FOR ALL
  USING (is_workspace_admin(workspace_id));

DROP POLICY IF EXISTS "Members can view invites" ON workspace_invites;
CREATE POLICY "Members can view invites" ON workspace_invites FOR SELECT
  USING (is_workspace_member(workspace_id));

DROP POLICY IF EXISTS "Admins can manage invites" ON workspace_invites;
CREATE POLICY "Admins can manage invites" ON workspace_invites FOR ALL
  USING (is_workspace_admin(workspace_id));

-- ── 6. ADD workspace_id TO EXISTING TABLES ──────────────────────
ALTER TABLE contacts             ADD COLUMN IF NOT EXISTS workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE;
ALTER TABLE tags                 ADD COLUMN IF NOT EXISTS workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE;
ALTER TABLE custom_fields        ADD COLUMN IF NOT EXISTS workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE;
ALTER TABLE conversations        ADD COLUMN IF NOT EXISTS workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE;
ALTER TABLE message_templates    ADD COLUMN IF NOT EXISTS workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE;
ALTER TABLE broadcasts           ADD COLUMN IF NOT EXISTS workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE;
ALTER TABLE automations          ADD COLUMN IF NOT EXISTS workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE;
ALTER TABLE automation_logs      ADD COLUMN IF NOT EXISTS workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE;
ALTER TABLE flows                            ADD COLUMN IF NOT EXISTS workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE;
ALTER TABLE flow_runs                        ADD COLUMN IF NOT EXISTS workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE;
ALTER TABLE automation_pending_executions    ADD COLUMN IF NOT EXISTS workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_contacts_workspace          ON contacts(workspace_id);
CREATE INDEX IF NOT EXISTS idx_conversations_workspace     ON conversations(workspace_id);
CREATE INDEX IF NOT EXISTS idx_message_templates_workspace ON message_templates(workspace_id);
CREATE INDEX IF NOT EXISTS idx_broadcasts_workspace        ON broadcasts(workspace_id);
CREATE INDEX IF NOT EXISTS idx_automations_workspace       ON automations(workspace_id);
CREATE INDEX IF NOT EXISTS idx_flows_workspace             ON flows(workspace_id);

-- ── 7. CHANNEL TYPE + COLUMNS ───────────────────────────────────
-- Channel taxonomy used everywhere.
--   whatsapp     — WhatsApp Cloud API (Meta)
--   instagram    — Instagram DMs (Meta Graph API, IG Messaging)
--   messenger    — Facebook Messenger (Meta Graph API)
--   gmail        — Gmail (Google API / OAuth)
--   outlook      — Outlook / Hotmail (Microsoft Graph)
--   fb_comment   — Facebook ad / post comment
--   ig_comment   — Instagram ad / post comment

ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS channel TEXT NOT NULL DEFAULT 'whatsapp'
    CHECK (channel IN ('whatsapp','instagram','messenger','gmail','outlook','fb_comment','ig_comment')),
  ADD COLUMN IF NOT EXISTS external_id TEXT,
  ALTER COLUMN phone DROP NOT NULL;
-- One contact identity per (workspace, channel, external_id) — phone OR ig handle OR email.
CREATE UNIQUE INDEX IF NOT EXISTS uq_contact_identity
  ON contacts(workspace_id, channel, external_id)
  WHERE external_id IS NOT NULL;

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS channel TEXT NOT NULL DEFAULT 'whatsapp'
    CHECK (channel IN ('whatsapp','instagram','messenger','gmail','outlook','fb_comment','ig_comment')),
  ADD COLUMN IF NOT EXISTS connection_id UUID,
  ADD COLUMN IF NOT EXISTS subject TEXT,
  ADD COLUMN IF NOT EXISTS thread_external_id TEXT;

-- Wider content_type for emails + comments + interactive.
ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_content_type_check;
ALTER TABLE messages
  ADD CONSTRAINT messages_content_type_check
  CHECK (content_type IN ('text','image','document','audio','video','location','template','interactive','email','comment'));

ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS channel TEXT NOT NULL DEFAULT 'whatsapp'
    CHECK (channel IN ('whatsapp','instagram','messenger','gmail','outlook','fb_comment','ig_comment')),
  ADD COLUMN IF NOT EXISTS subject TEXT,
  ADD COLUMN IF NOT EXISTS html_body TEXT,
  ADD COLUMN IF NOT EXISTS attachments JSONB;

-- ── 8. CHANNEL_CONNECTIONS (generic replacement for whatsapp_config) ─
-- A workspace can hold N connections, one per (channel, external account).
-- Tokens are AES-256-GCM ciphertext (same key as whatsapp_config used).
CREATE TABLE IF NOT EXISTS channel_connections (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  channel TEXT NOT NULL CHECK (channel IN ('whatsapp','instagram','messenger','gmail','outlook','fb_comment','ig_comment')),
  label TEXT,                          -- human label ("Soporte ES", "info@mio.com")
  status TEXT NOT NULL DEFAULT 'disconnected' CHECK (status IN ('connected','disconnected','error','pending')),
  external_account_id TEXT,            -- phone_number_id, page_id, ig_user_id, email
  config JSONB NOT NULL DEFAULT '{}',  -- non-secret per-channel config (waba_id, verify_token, page name, …)
  secrets JSONB NOT NULL DEFAULT '{}', -- encrypted secrets payload ({ access_token: "...", refresh_token: "...", iv: "..." })
  webhook_secret TEXT,                 -- per-connection verify_token (Meta) / shared HMAC secret
  last_synced_at TIMESTAMPTZ,
  last_error TEXT,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_connections_workspace ON channel_connections(workspace_id);
CREATE INDEX IF NOT EXISTS idx_connections_channel ON channel_connections(channel);
CREATE INDEX IF NOT EXISTS idx_connections_external ON channel_connections(external_account_id);

ALTER TABLE channel_connections ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Members can view connections" ON channel_connections;
DROP POLICY IF EXISTS "Admins can manage connections" ON channel_connections;
CREATE POLICY "Members can view connections" ON channel_connections FOR SELECT
  USING (is_workspace_member(workspace_id));
CREATE POLICY "Admins can manage connections" ON channel_connections FOR ALL
  USING (is_workspace_admin(workspace_id));

CREATE TRIGGER set_updated_at_connections BEFORE UPDATE ON channel_connections
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- conversations.connection_id wired now that channel_connections exists.
ALTER TABLE conversations
  DROP CONSTRAINT IF EXISTS conversations_connection_id_fkey;
ALTER TABLE conversations
  ADD CONSTRAINT conversations_connection_id_fkey
  FOREIGN KEY (connection_id) REFERENCES channel_connections(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_conversations_connection ON conversations(connection_id);

-- ── 9. COMMENTS_META — ad/post identifiers for fb/ig comments ───
-- Comments live in `messages` (channel=fb_comment | ig_comment).
-- This sidecar table stores the post/ad/parent-comment identifiers
-- so we can group threads + reply via Graph API.
CREATE TABLE IF NOT EXISTS comments_meta (
  message_id UUID PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE,
  post_id TEXT,
  parent_comment_id TEXT,
  ad_id TEXT,
  permalink TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_comments_post ON comments_meta(post_id);
CREATE INDEX IF NOT EXISTS idx_comments_ad  ON comments_meta(ad_id);

ALTER TABLE comments_meta ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Members can view comments_meta" ON comments_meta;
CREATE POLICY "Members can view comments_meta" ON comments_meta FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM messages m
    JOIN conversations c ON c.id = m.conversation_id
    WHERE m.id = comments_meta.message_id
      AND is_workspace_member(c.workspace_id)
  ));
DROP POLICY IF EXISTS "Service role insert comments_meta" ON comments_meta;
CREATE POLICY "Service role insert comments_meta" ON comments_meta FOR INSERT WITH CHECK (true);

-- ── 10. REWRITE RLS POLICIES TO USE workspace_id ────────────────
-- Drop old single-user policies and create membership-based ones.
-- During the transition, rows without a workspace_id stay invisible
-- to all members (which is correct — we backfill in code/seed).

DROP POLICY IF EXISTS "Users can manage own contacts" ON contacts;
CREATE POLICY "Members can manage workspace contacts" ON contacts FOR ALL
  USING (workspace_id IS NOT NULL AND is_workspace_member(workspace_id));

DROP POLICY IF EXISTS "Users can manage own tags" ON tags;
CREATE POLICY "Members can manage workspace tags" ON tags FOR ALL
  USING (workspace_id IS NOT NULL AND is_workspace_member(workspace_id));

DROP POLICY IF EXISTS "Users can manage own custom fields" ON custom_fields;
CREATE POLICY "Members can manage workspace custom fields" ON custom_fields FOR ALL
  USING (workspace_id IS NOT NULL AND is_workspace_member(workspace_id));

DROP POLICY IF EXISTS "Users can manage own conversations" ON conversations;
CREATE POLICY "Members can manage workspace conversations" ON conversations FOR ALL
  USING (workspace_id IS NOT NULL AND is_workspace_member(workspace_id));

-- messages inherit via conversations.workspace_id
DROP POLICY IF EXISTS "Users can view own messages" ON messages;
CREATE POLICY "Members can view workspace messages" ON messages FOR ALL
  USING (EXISTS (
    SELECT 1 FROM conversations c
    WHERE c.id = messages.conversation_id
      AND c.workspace_id IS NOT NULL
      AND is_workspace_member(c.workspace_id)
  ));

DROP POLICY IF EXISTS "Users can manage own templates" ON message_templates;
CREATE POLICY "Members can manage workspace templates" ON message_templates FOR ALL
  USING (workspace_id IS NOT NULL AND is_workspace_member(workspace_id));

DROP POLICY IF EXISTS "Users can manage own broadcasts" ON broadcasts;
CREATE POLICY "Members can manage workspace broadcasts" ON broadcasts FOR ALL
  USING (workspace_id IS NOT NULL AND is_workspace_member(workspace_id));

DROP POLICY IF EXISTS "Users can manage own automations" ON automations;
CREATE POLICY "Members can manage workspace automations" ON automations FOR ALL
  USING (workspace_id IS NOT NULL AND is_workspace_member(workspace_id));

DROP POLICY IF EXISTS "Users can view own logs" ON automation_logs;
CREATE POLICY "Members can view workspace logs" ON automation_logs FOR ALL
  USING (workspace_id IS NOT NULL AND is_workspace_member(workspace_id));

DROP POLICY IF EXISTS "Users can manage own flows" ON flows;
CREATE POLICY "Members can manage workspace flows" ON flows FOR ALL
  USING (workspace_id IS NOT NULL AND is_workspace_member(workspace_id));

-- ── 11. AUTO-CREATE PERSONAL WORKSPACE ON SIGNUP ────────────────
-- Every new user gets their own workspace (themselves as admin).
-- They can rename/invite team later.
CREATE OR REPLACE FUNCTION public.handle_new_workspace_for_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_workspace_id UUID;
BEGIN
  INSERT INTO public.workspaces (name, owner_id)
  VALUES (
    COALESCE(NEW.raw_user_meta_data->>'workspace_name',
             SPLIT_PART(NEW.email, '@', 1) || '''s workspace'),
    NEW.id
  )
  RETURNING id INTO v_workspace_id;

  INSERT INTO public.workspace_members (workspace_id, user_id, role)
  VALUES (v_workspace_id, NEW.id, 'admin');

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Failed to create workspace for user %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

ALTER FUNCTION public.handle_new_workspace_for_user() OWNER TO postgres;

DROP TRIGGER IF EXISTS on_auth_user_workspace ON auth.users;
CREATE TRIGGER on_auth_user_workspace
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_workspace_for_user();

-- ── 12. whatsapp_config — gain workspace_id for membership-based RLS ──
-- The legacy single-user table coexists with channel_connections for
-- one migration cycle. Phase 3 of the unified-inbox rollout migrates
-- existing rows into channel_connections and drops this table.
ALTER TABLE whatsapp_config
  ADD COLUMN IF NOT EXISTS workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_whatsapp_config_workspace ON whatsapp_config(workspace_id);

DROP POLICY IF EXISTS "Users can manage own config" ON whatsapp_config;
CREATE POLICY "Admins can manage workspace whatsapp_config" ON whatsapp_config FOR ALL
  USING (workspace_id IS NOT NULL AND is_workspace_admin(workspace_id));
