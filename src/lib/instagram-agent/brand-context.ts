import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Brand voice + knowledge for grounding the Instagram agent's copy.
 *
 * Blueberry's edge is "your brand voice, not generic AI" — its copy is
 * grounded in the brand's tone, catalog and site. We already capture that:
 * the WhatsApp agent built from the store URL (Firecrawl crawl, see
 * /api/ai/agents/generate-from-url) stores the brand persona + scraped site
 * knowledge on `ai_agents`. Here we reuse it to make the IG DMs sound on-brand
 * and persuasive instead of generic.
 */
export interface BrandContext {
  name: string | null;
  /** The brand persona / system voice (how the brand talks). */
  voice: string | null;
  /** Scraped site knowledge (products, benefits, policies, FAQ). */
  knowledge: string | null;
  tone: string | null;
  language: string | null;
}

/**
 * Load the workspace's brand context from its AI agent. Picks the active
 * agent with the freshest knowledge; returns null when the workspace has no
 * agent yet (then the copy just falls back to catalog-only grounding).
 *
 * Works under RLS (authenticated client, own workspace) and service-role.
 */
export async function loadBrandContext(
  db: SupabaseClient,
  workspaceId: string,
): Promise<BrandContext | null> {
  const { data } = await db
    .from('ai_agents')
    .select('name, persona, knowledge, tone, language, is_active, updated_at')
    .eq('workspace_id', workspaceId)
    .order('is_active', { ascending: false })
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  const a = data as {
    name?: string | null;
    persona?: string | null;
    knowledge?: string | null;
    tone?: string | null;
    language?: string | null;
  };
  const ctx: BrandContext = {
    name: a.name ?? null,
    voice: a.persona ?? null,
    knowledge: a.knowledge ?? null,
    tone: a.tone ?? null,
    language: a.language ?? null,
  };
  // Nothing usable → behave like "no brand context".
  if (!ctx.voice && !ctx.knowledge && !ctx.name) return null;
  return ctx;
}

/**
 * Compact brand brief for prompts. Knowledge is capped so a big crawl
 * doesn't blow the token budget; the voice/tone are kept whole because
 * they're short and high-signal.
 */
export function brandBrief(
  brand: BrandContext | null,
  knowledgeCap = 2000,
): string {
  if (!brand) return '';
  const parts: string[] = [];
  if (brand.name) parts.push(`Marca: ${brand.name}`);
  if (brand.tone) parts.push(`Tono: ${brand.tone}`);
  if (brand.voice) parts.push(`Voz de marca:\n${brand.voice.trim()}`);
  if (brand.knowledge) {
    parts.push(
      `Conocimiento de la marca (de su web):\n${brand.knowledge
        .trim()
        .slice(0, knowledgeCap)}`,
    );
  }
  return parts.join('\n\n');
}
