import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getLocale } from '@/lib/i18n/server';
import { translate } from '@/lib/i18n/translate';

/**
 * GET /api/ai/instagram-agent/approvals
 *
 * Lists proactive DMs drafted by the agent and held for human approval —
 * recipients in `pending_review` (created when the linked agent's
 * proactive_send_mode is 'approval' or 'hybrid_intent' for a non-high lead).
 * RLS scopes them to the caller's workspace via the campaign policy.
 */
export async function GET() {
  const locale = await getLocale();
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json(
      { error: translate(locale, 'errAi.notAuthenticated') },
      { status: 401 },
    );
  }

  const { data, error } = await supabase
    .from('instagram_campaign_recipients')
    .select(
      'id, draft_text, discount_code, lead_score, created_at, contacts(name), instagram_campaigns!inner(name)',
    )
    .eq('status', 'pending_review')
    .order('created_at', { ascending: false })
    .limit(100);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  type Row = {
    id: string;
    draft_text: string | null;
    discount_code: string | null;
    lead_score: string | null;
    created_at: string;
    contacts: { name: string | null } | { name: string | null }[] | null;
    instagram_campaigns: { name: string } | { name: string }[] | null;
  };
  const approvals = ((data ?? []) as Row[]).map((r) => {
    const contact = Array.isArray(r.contacts) ? r.contacts[0] : r.contacts;
    const campaign = Array.isArray(r.instagram_campaigns)
      ? r.instagram_campaigns[0]
      : r.instagram_campaigns;
    return {
      id: r.id,
      draft_text: r.draft_text ?? '',
      discount_code: r.discount_code,
      lead_score: r.lead_score,
      created_at: r.created_at,
      contact_name: contact?.name ?? null,
      campaign_name: campaign?.name ?? null,
    };
  });

  return NextResponse.json({ approvals });
}
