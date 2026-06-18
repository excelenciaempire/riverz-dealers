import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

/**
 * GET /api/ai/instagram-agent/context
 *
 * Cheap, no-LLM snapshot of what the agent has to work with — reachable
 * contacts + catalog size — so the command bar can show real numbers in its
 * live "thinking" states ("Escaneando tu audiencia (1,240 personas)…") before
 * the plan is generated. RLS scopes the counts to the caller's workspace.
 */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

  const [{ count: contactCount }, { count: productCount }, { data: cur }] =
    await Promise.all([
      supabase.from('contacts').select('*', { count: 'exact', head: true }),
      supabase.from('shopify_products').select('*', { count: 'exact', head: true }),
      supabase
        .from('shopify_products')
        .select('currency')
        .not('currency', 'is', null)
        .limit(1)
        .maybeSingle(),
    ]);

  return NextResponse.json({
    total_contacts: contactCount ?? 0,
    product_count: productCount ?? 0,
    has_catalog: (productCount ?? 0) > 0,
    currency: (cur as { currency?: string } | null)?.currency ?? 'USD',
  });
}
