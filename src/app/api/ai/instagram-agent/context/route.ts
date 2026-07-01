import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
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

  const windowStart = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const [
    { count: totalCount },
    { count: reachableCount },
    { count: inWindowCount },
    { count: productCount },
    { data: cur },
  ] = await Promise.all([
    supabase.from('contacts').select('*', { count: 'exact', head: true }),
    supabase
      .from('contacts')
      .select('*', { count: 'exact', head: true })
      .in('channel', ['instagram', 'ig_comment'])
      .not('external_id', 'is', null),
    supabase
      .from('contacts')
      .select('*', { count: 'exact', head: true })
      .in('channel', ['instagram', 'ig_comment'])
      .not('external_id', 'is', null)
      .gt('updated_at', windowStart),
    supabase.from('shopify_products').select('*', { count: 'exact', head: true }),
    supabase
      .from('shopify_products')
      .select('currency')
      .not('currency', 'is', null)
      .limit(1)
      .maybeSingle(),
  ]);

  return NextResponse.json({
    // Total across all channels — kept for internal use, no longer the headline.
    total_contacts: totalCount ?? 0,
    // The honest "reachable" number: only IG-sourced, DM-addressable contacts.
    instagram_reachable: reachableCount ?? 0,
    // Subset inside Meta's 24h window right now (can receive a DM immediately).
    in_window_24h: inWindowCount ?? 0,
    product_count: productCount ?? 0,
    has_catalog: (productCount ?? 0) > 0,
    currency: (cur as { currency?: string } | null)?.currency ?? 'USD',
  });
}
