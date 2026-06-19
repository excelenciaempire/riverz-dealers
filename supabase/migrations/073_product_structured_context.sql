-- 073_product_structured_context.sql
-- Richer per-product context for the AI agent (Phase 1 of the products
-- redesign). All additive + nullable so existing rows and the current
-- training_material path keep working unchanged. The runner injects these
-- when present; the Productos UI lets the merchant edit them.
--
--   structured_research   typed research the agent can slice
--                         { audience, pains[], desires[],
--                           objections[{objection, rebuttal}],
--                           differentiators[], use_cases[], specs[], lingo[] }
--   say_guidelines        what to emphasize about this product
--   never_say             string[] of forbidden claims (guardrail-as-data)
--   escalation_triggers   string[] phrases that should hand off to a human
--   allowed_offers        [{label, total, conditions}] valid offers/prices
--   health_sensitive      flips the health-claims guard per product
--   training_material_built_at  staleness vs scraped_at / ai_research_generated_at

alter table public.shopify_products
  add column if not exists structured_research jsonb,
  add column if not exists say_guidelines text,
  add column if not exists never_say jsonb,
  add column if not exists escalation_triggers jsonb,
  add column if not exists allowed_offers jsonb,
  add column if not exists health_sensitive boolean not null default false,
  add column if not exists training_material_built_at timestamptz;
