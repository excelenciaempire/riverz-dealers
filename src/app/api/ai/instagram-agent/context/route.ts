import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { loadAudienceStats } from '@/lib/instagram-agent/audience-stats';
import { resolveWorkspaceId } from '@/lib/instagram-agent/workspace';
import { resolveIgAgent } from '@/lib/instagram-agent/agent-link';
import { getLocale } from '@/lib/i18n/server';
import { translate } from '@/lib/i18n/translate';

/**
 * GET /api/ai/instagram-agent/context
 *
 * Cheap, no-LLM snapshot of what the agent has to work with — reachable
 * contacts + catalog size — so the command bar can show real numbers in its
 * live "thinking" states ("Escaneando tu audiencia (1,240 personas)…") before
 * the plan is generated. RLS scopes the counts to the caller's workspace.
 *
 * The headline number is the INSTAGRAM-reachable audience (contacts that came
 * from an IG DM or comment and have a usable IG-scoped id), NOT the total
 * contact count — a WhatsApp-first store has thousands of contacts the IG agent
 * can never DM. We also surface how many are inside Meta's 24h messaging window
 * right now, since only those can receive a free-form DM (messaging_type=RESPONSE).
 */
export async function GET() {
  const locale = await getLocale();
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json(
      { error: translate(locale, 'errAi.notAuthenticated') },
      { status: 401 },
    );

  const workspaceId = await resolveWorkspaceId(supabase, user.id);
  const [
    { count: totalCount },
    audience,
    { count: productCount },
    { data: cur },
    { count: igConns },
    { data: agentRows },
    defaultAgent,
    { count: researchedCount },
    { count: subscriberCount },
  ] = await Promise.all([
      supabase.from('contacts').select('*', { count: 'exact', head: true }),
      loadAudienceStats(supabase),
      supabase.from('shopify_products').select('*', { count: 'exact', head: true }),
      supabase
        .from('shopify_products')
        .select('currency')
        .not('currency', 'is', null)
        .limit(1)
        .maybeSingle(),
      supabase
        .from('channel_connections')
        .select('id', { count: 'exact', head: true })
        .eq('channel', 'instagram')
        .eq('status', 'connected'),
      // Qué voz de marca escribirá los DMs — visible y elegible en la UI, para
      // que un agente de otro producto no hable en nombre de la marca sin que
      // nadie lo note.
      supabase
        .from('ai_agents')
        .select('id, name, is_active')
        .is('deleted_at', null)
        .order('is_active', { ascending: false })
        .order('updated_at', { ascending: false })
        .limit(20),
      workspaceId
        ? resolveIgAgent(supabase, workspaceId)
        : Promise.resolve({ id: null }),
      // Cuántas personas tienen el perfil ya investigado. Es lo único que
      // distingue un DM personalizado de uno con el nombre puesto, así que la
      // pantalla tiene que poder decir si ese trabajo está pasando.
      supabase
        .from('contact_ig_profile')
        .select('contact_id', { count: 'exact', head: true })
        .not('opener_hint', 'is', null),
      // Suscriptores: los que dieron permiso de Marketing Messages. Es el único
      // número de esta pantalla que NO caduca — al resto lo mata el reloj de
      // Meta en horas o días.
      supabase
        .from('meta_marketing_optins')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'active'),
    ]);

  return NextResponse.json({
    // Total across all channels — kept for internal use, no longer the headline.
    total_contacts: totalCount ?? 0,
    // Full IG-sourced history (context, not a promise of reach).
    instagram_reachable: audience.instagram_total,
    // The honest headline: who can receive a message RIGHT NOW.
    reachable_now: audience.reachable_now,
    in_window_24h: audience.dm_window_24h,
    comment_window_7d: audience.comment_window_7d,
    /** Personas con el perfil ya investigado (tienen gancho de apertura). */
    researched: researchedCount ?? 0,
    /** Dieron permiso: se les puede escribir cuando el comercio quiera. */
    subscribers: subscriberCount ?? 0,
    instagram_connected: (igConns ?? 0) > 0,
    agents: (agentRows ?? []) as Array<{ id: string; name: string }>,
    default_agent_id: defaultAgent.id,
    product_count: productCount ?? 0,
    has_catalog: (productCount ?? 0) > 0,
    currency: (cur as { currency?: string } | null)?.currency ?? 'USD',
  });
}
