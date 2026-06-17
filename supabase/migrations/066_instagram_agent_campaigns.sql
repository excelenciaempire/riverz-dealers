-- ============================================================
-- 066 — Instagram Agent campaigns.
--
-- Backs the "Agente de Instagram" surface (/agente-instagram). The agent
-- turns a natural-language goal into a 1:1 Instagram campaign plan
-- (audience, DM copy, offer, follow-up, comment reply). This migration adds
-- the persistence so a generated plan stops being ephemeral and becomes a
-- reviewable, launchable, attributable campaign.
--
--   instagram_campaigns            — one row per campaign (the saved plan +
--                                    lifecycle status + rolled-up metrics).
--   instagram_campaign_recipients  — one row per person the agent reaches,
--                                    tracking the funnel (queued → sent →
--                                    replied → converted) for attribution.
--
-- The send/reply transport already exists (instagramAdapter.sendText,
-- igCommentAdapter.sendText); a later launch worker reads queued recipients
-- and dispatches through it. RLS scopes everything to the workspace via the
-- shared is_workspace_member() helper, consistent with the post-057 model.
-- ============================================================

CREATE TABLE IF NOT EXISTS instagram_campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,

  name TEXT NOT NULL,
  goal TEXT NOT NULL,
  -- draft  : plan generado, sin lanzar (default)
  -- active : el agente está contactando a la audiencia
  -- paused : pausado por el usuario ("Pausar agente")
  -- done   : campaña finalizada
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'active', 'paused', 'done')),

  -- El plan completo tal como lo devuelve /api/ai/instagram-agent
  -- (audience, message, offer, follow_up, comment_reply, funnel…).
  plan JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- Código de descuento desnormalizado para atribución por código.
  offer_code TEXT,
  -- Embudo real acumulado (contacted/replies/conversions/revenue +
  -- incrementalidad: treatment vs control).
  metrics JSONB NOT NULL DEFAULT '{}'::jsonb,

  -- % de la audiencia reservada como grupo de control (holdout) para medir
  -- incrementalidad real, no atribución de último toque. 0 = sin holdout.
  holdout_pct SMALLINT NOT NULL DEFAULT 10
    CHECK (holdout_pct BETWEEN 0 AND 50),

  launched_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ig_campaigns_workspace
  ON instagram_campaigns (workspace_id, status);

CREATE INDEX IF NOT EXISTS idx_ig_campaigns_offer_code
  ON instagram_campaigns (workspace_id, offer_code)
  WHERE offer_code IS NOT NULL;

ALTER TABLE instagram_campaigns ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Members manage ig campaigns" ON instagram_campaigns;
CREATE POLICY "Members manage ig campaigns" ON instagram_campaigns FOR ALL
  USING (is_workspace_member(workspace_id))
  WITH CHECK (is_workspace_member(workspace_id));

DROP TRIGGER IF EXISTS set_updated_at ON instagram_campaigns;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON instagram_campaigns
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();


CREATE TABLE IF NOT EXISTS instagram_campaign_recipients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL
    REFERENCES instagram_campaigns(id) ON DELETE CASCADE,
  -- SET NULL para que un borrado GDPR del contacto no huérfane la métrica.
  contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,

  -- queued    : en cola para enviar
  -- sent      : DM enviado
  -- replied   : la persona respondió
  -- converted : compró (atribuida vía offer_code / orden)
  -- skipped   : descartada (opt-out, fuera de ventana 24h, etc.)
  -- failed    : el envío falló
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'sent', 'replied', 'converted', 'skipped', 'failed')),

  -- ID del comentario/historia de Instagram que originó el contacto, para
  -- atribución "de qué engagement nació".
  source_external_id TEXT,
  error TEXT,

  -- Grupo de control: si TRUE, NO se le envía DM; sirve de línea base para
  -- medir incrementalidad. Sus compras cuentan como conversión "orgánica".
  is_holdout BOOLEAN NOT NULL DEFAULT FALSE,

  -- Lead scoring (Claude): intención de compra, sentimiento y spam.
  lead_score TEXT CHECK (lead_score IN ('high', 'medium', 'low')),
  lead_sentiment TEXT CHECK (lead_sentiment IN ('positive', 'neutral', 'negative')),
  is_spam BOOLEAN NOT NULL DEFAULT FALSE,

  -- Ingreso atribuido a este destinatario (orden de Shopify matcheada).
  revenue NUMERIC(12, 2),
  currency TEXT,

  -- Respuesta pública al comentario de origen (comment-moderation): id de la
  -- respuesta publicada por Meta + cuándo, para no responder dos veces.
  comment_reply_external_id TEXT,
  comment_replied_at TIMESTAMPTZ,

  sent_at TIMESTAMPTZ,
  replied_at TIMESTAMPTZ,
  converted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (campaign_id, contact_id)
);

CREATE INDEX IF NOT EXISTS idx_ig_recipients_campaign_status
  ON instagram_campaign_recipients (campaign_id, status);

ALTER TABLE instagram_campaign_recipients ENABLE ROW LEVEL SECURITY;

-- Scope por la campaña padre: si el usuario es miembro del workspace de la
-- campaña, gestiona sus destinatarios.
DROP POLICY IF EXISTS "Members manage ig recipients" ON instagram_campaign_recipients;
CREATE POLICY "Members manage ig recipients" ON instagram_campaign_recipients FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM instagram_campaigns c
      WHERE c.id = instagram_campaign_recipients.campaign_id
        AND is_workspace_member(c.workspace_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM instagram_campaigns c
      WHERE c.id = instagram_campaign_recipients.campaign_id
        AND is_workspace_member(c.workspace_id)
    )
  );
