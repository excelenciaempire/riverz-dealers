/**
 * Voice AI — bulk outbound call campaigns.
 *
 * A campaign targets a saved segment; the cron enqueues calls in batches (each
 * call still respects the agent's calling window, monthly limit, opt-out and
 * kill switch via enqueueCall). Progress is a simple cursor in stats.enqueued;
 * when it reaches the segment size the campaign is done.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { VoiceCampaign } from '@/types';
import type { SegmentMatchMode, SegmentRule } from '@/lib/segments/types';
import { resolveSegment } from '@/lib/segments/resolve';
import { enqueueCall } from './queue';

/** Contacts enqueued per campaign per cron run (keeps each run bounded). */
const BATCH = 50;

async function runOne(db: SupabaseClient, c: VoiceCampaign): Promise<number> {
  if (!c.segment_id) {
    await db.from('voice_campaigns').update({ status: 'done' }).eq('id', c.id);
    return 0;
  }
  const { data: seg } = await db
    .from('contact_segments')
    .select('rules, match_mode')
    .eq('id', c.segment_id)
    .maybeSingle();
  if (!seg) {
    await db.from('voice_campaigns').update({ status: 'done' }).eq('id', c.id);
    return 0;
  }
  const { contacts } = await resolveSegment(
    db,
    c.workspace_id,
    (seg as { rules: SegmentRule[] }).rules ?? [],
    (seg as { match_mode: SegmentMatchMode }).match_mode
  );

  const already = c.stats?.enqueued ?? 0;
  const slice = contacts.slice(already, already + BATCH);
  let enqueued = 0;
  for (const contact of slice) {
    const res = await enqueueCall({
      workspaceId: c.workspace_id,
      agentId: c.agent_id,
      contactId: contact.id,
      callType: c.call_type,
      context: {
        campaign_id: c.id,
        ...(c.objective ? { objective_override: c.objective } : {}),
      },
      origin: 'campaign',
      recordSkip: true,
    });
    if (res.enqueued) enqueued++;
  }

  const newEnqueued = already + slice.length;
  const done = newEnqueued >= contacts.length;
  await db
    .from('voice_campaigns')
    .update({
      stats: { total: contacts.length, enqueued: newEnqueued, done },
      status: done ? 'done' : 'running',
      updated_at: new Date().toISOString(),
    })
    .eq('id', c.id);
  return enqueued;
}

/** Advance every running campaign by one batch. Never throws. */
export async function runVoiceCampaigns(db: SupabaseClient): Promise<{ campaigns: number; enqueued: number }> {
  let enqueued = 0;
  let campaigns = 0;
  try {
    const { data } = await db
      .from('voice_campaigns')
      .select('*')
      .eq('status', 'running')
      .order('created_at', { ascending: true })
      .limit(20);
    for (const c of (data ?? []) as VoiceCampaign[]) {
      campaigns++;
      try {
        enqueued += await runOne(db, c);
      } catch (err) {
        console.error('[voice] campaign run failed:', c.id, err);
      }
    }
  } catch (err) {
    console.error('[voice] runVoiceCampaigns failed:', err);
  }
  return { campaigns, enqueued };
}
