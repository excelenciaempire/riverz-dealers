import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/channels/admin-client';
import { idColumn } from '@/lib/short-id';

export const dynamic = 'force-dynamic';

/** Results are intentionally based on recorded exposures, never on the current
 * step config. Editing a test cannot rewrite past performance. */
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string; stepId: string }> }
) {
  const { id, stepId } = await context.params;
  const client = await createClient();
  const {
    data: { user },
  } = await client.auth.getUser();
  if (!user)
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const db = supabaseAdmin();
  const { data: automation } = await db
    .from('automations')
    .select('id, workspace_id')
    .eq(idColumn(id), id)
    .maybeSingle();
  if (!automation)
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  const { data: member } = await db
    .from('workspace_members')
    .select('id')
    .eq('workspace_id', automation.workspace_id)
    .eq('user_id', user.id)
    .maybeSingle();
  if (!member)
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const { data, error } = await db
    .from('automation_template_exposures')
    .select('variant_id, response_at, order_id, order_total, order_currency')
    .eq('automation_id', automation.id)
    .eq('automation_step_id', stepId);
  if (error)
    return NextResponse.json(
      { error: 'analytics_unavailable' },
      { status: 500 }
    );
  const variants = { a: empty(), b: empty() };
  for (const row of data ?? []) {
    const metric = variants[row.variant_id as 'a' | 'b'];
    if (!metric) continue;
    metric.sent += 1;
    if (row.response_at) metric.responses += 1;
    if (row.order_id) {
      metric.orders += 1;
      metric.revenue += Number(row.order_total ?? 0);
    }
    if (!metric.currency && row.order_currency)
      metric.currency = row.order_currency;
  }
  return NextResponse.json({
    variants: {
      a: {
        ...variants.a,
        response_rate: rate(variants.a.responses, variants.a.sent),
      },
      b: {
        ...variants.b,
        response_rate: rate(variants.b.responses, variants.b.sent),
      },
    },
  });
}

function empty() {
  return {
    sent: 0,
    responses: 0,
    orders: 0,
    revenue: 0,
    currency: null as string | null,
  };
}
function rate(n: number, d: number) {
  return d ? n / d : null;
}
