import { NextResponse } from 'next/server';
import { createVoiceCampaign, changeVoiceCampaignStatus, VoiceCampaignInputError } from '@/lib/voice/campaign-settings';
import { isMemberOfLiveWorkspace } from '@/lib/workspaces/resolve';
import { getT } from '@/lib/i18n/server';
import { createClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/channels/admin-client';
import { csrfGuard } from '@/lib/csrf';
import { serverError } from '@/lib/api/errors';

/**
 * Voice campaigns — bulk outbound calls over a segment.
 *   GET  ?workspace_id=  → list
 *   POST → create (draft or running)
 *   PATCH → change status (start/pause/cancel)
 * Session-authenticated; caller must be a workspace member.
 */
async function requireMember(userId: string, workspaceId: string): Promise<boolean> {
  return isMemberOfLiveWorkspace(supabaseAdmin(), userId, workspaceId);
}

export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const workspaceId = new URL(request.url).searchParams.get('workspace_id');
  if (!workspaceId) return NextResponse.json({ error: 'workspace_id required' }, { status: 400 });
  if (!(await requireMember(user.id, workspaceId))) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  const { data, error } = await supabaseAdmin()
    .from('voice_campaigns')
    .select('*')
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) return serverError(error);
  return NextResponse.json({ campaigns: data ?? [] });
}

export async function POST(request: Request) {
  const block = await csrfGuard(request);
  if (block) return block;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => null);
  if (!body || typeof body.workspace_id !== 'string') return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  if (!(await requireMember(user.id, body.workspace_id))) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  try {
    const campaign = await createVoiceCampaign(supabaseAdmin(), body.workspace_id, body);
    return NextResponse.json({ campaign }, { status: 201 });
  } catch (error) { return campaignError(error); }
}

export async function PATCH(request: Request) {
  const block = await csrfGuard(request);
  if (block) return block;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => null);
  if (!body || typeof body.workspace_id !== 'string') return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  if (!(await requireMember(user.id, body.workspace_id))) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  try {
    return NextResponse.json(await changeVoiceCampaignStatus(supabaseAdmin(), body.workspace_id, body.id, body.status));
  } catch (error) { return campaignError(error); }
}

async function campaignError(error: unknown) {
  if (error instanceof VoiceCampaignInputError) return NextResponse.json({ error: (await getT())('voice.campaignInvalid') }, { status: 400 });
  return serverError(error);
}
