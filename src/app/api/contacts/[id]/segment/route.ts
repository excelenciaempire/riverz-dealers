import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import {
  generateContactSegment,
  isSegmentFresh,
  type ContactSegment,
} from '@/lib/contacts/segment';

/**
 * GET /api/contacts/[id]/segment[?refresh=1]
 *
 * Returns the contact's AI segment (label + traits) plus their most recent
 * inbound message ("recent activity"). Computes + caches it lazily the first
 * time, reuses the cache for ~14 days, and recomputes on ?refresh=1. RLS
 * scopes every read/write to the caller's workspace.
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

  const { data: contact } = await supabase
    .from('contacts')
    .select('id, name, ai_segment, ai_summary')
    .eq('id', id)
    .maybeSingle();
  if (!contact) return NextResponse.json({ error: 'No encontrado' }, { status: 404 });

  const c = contact as {
    id: string;
    name: string | null;
    ai_segment: ContactSegment | null;
    ai_summary: string | null;
  };

  // Latest inbound message (recent activity) + a window of history for the
  // segment. One round-trip: pull the contact's conversations, then messages.
  const { data: convs } = await supabase
    .from('conversations')
    .select('id')
    .eq('contact_id', id);
  const convIds = (convs ?? []).map((x: { id: string }) => x.id);

  let messages: string[] = [];
  let recentActivity: string | null = null;
  if (convIds.length > 0) {
    const { data: msgs } = await supabase
      .from('messages')
      .select('content_text')
      .in('conversation_id', convIds)
      .eq('sender_type', 'customer')
      .order('created_at', { ascending: false })
      .limit(20);
    messages = (msgs ?? [])
      .map((m: { content_text: string | null }) => m.content_text ?? '')
      .filter(Boolean);
    recentActivity = messages[0] ?? null;
  }

  const url = new URL(request.url);
  const forceRefresh = url.searchParams.get('refresh') === '1';

  // Serve the cache unless stale or forced.
  if (!forceRefresh && isSegmentFresh(c.ai_segment)) {
    return NextResponse.json({ segment: c.ai_segment, recent_activity: recentActivity });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    // No model available — return whatever cache exists (possibly null).
    return NextResponse.json({ segment: c.ai_segment ?? null, recent_activity: recentActivity });
  }

  const generated = await generateContactSegment(apiKey, {
    name: c.name,
    messages,
    purchaseSummary: c.ai_summary,
  });
  if (!generated) {
    return NextResponse.json({ segment: c.ai_segment ?? null, recent_activity: recentActivity });
  }

  const segment: ContactSegment = {
    label: generated.label,
    traits: generated.traits,
    computed_at: new Date().toISOString(),
  };
  await supabase.from('contacts').update({ ai_segment: segment }).eq('id', id);

  return NextResponse.json({ segment, recent_activity: recentActivity });
}
