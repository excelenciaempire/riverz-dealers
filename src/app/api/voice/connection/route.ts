import { NextResponse } from 'next/server';
import type { VoiceConnectionConfig } from '@/types';
import { createClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/channels/admin-client';
import { csrfGuard } from '@/lib/csrf';
import { serverError } from '@/lib/api/errors';

/**
 * Voice channel connection config (per workspace). Stores the merchant's DID,
 * inbound toggle, monthly minutes cap and kill switch on the
 * channel_connections row with channel='voice'. Session-authenticated.
 *
 * GET  ?workspace_id=  → { config, status } | { config: null }
 * PUT  { workspace_id, config } → upsert
 */
async function requireMember(userId: string, workspaceId: string): Promise<boolean> {
  const { data } = await supabaseAdmin()
    .from('workspace_members')
    .select('id')
    .eq('workspace_id', workspaceId)
    .eq('user_id', userId)
    .maybeSingle();
  return Boolean(data);
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

  const { data } = await supabaseAdmin()
    .from('channel_connections')
    .select('config, status')
    .eq('workspace_id', workspaceId)
    .eq('channel', 'voice')
    .maybeSingle();

  return NextResponse.json({
    config: (data as { config?: VoiceConnectionConfig } | null)?.config ?? null,
    status: (data as { status?: string } | null)?.status ?? null,
  });
}

export async function PUT(request: Request) {
  const block = await csrfGuard(request);
  if (block) return block;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const body = (await request.json().catch(() => null)) as {
    workspace_id?: string;
    config?: VoiceConnectionConfig;
  } | null;
  if (!body?.workspace_id) {
    return NextResponse.json({ error: 'workspace_id required' }, { status: 400 });
  }
  if (!(await requireMember(user.id, body.workspace_id))) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const cfg: VoiceConnectionConfig = {
    phone_number: body.config?.phone_number?.trim() || undefined,
    country: body.config?.country?.trim() || undefined,
    inbound_enabled: Boolean(body.config?.inbound_enabled),
    monthly_minutes_limit:
      body.config?.monthly_minutes_limit != null
        ? Number(body.config.monthly_minutes_limit)
        : null,
    kill_switch: Boolean(body.config?.kill_switch),
    recording_enabled: Boolean(body.config?.recording_enabled),
    transfer_number: body.config?.transfer_number?.trim() || undefined,
  };
  const status = cfg.phone_number ? 'connected' : 'pending';

  try {
    const admin = supabaseAdmin();
    const { data: existing } = await admin
      .from('channel_connections')
      .select('id')
      .eq('workspace_id', body.workspace_id)
      .eq('channel', 'voice')
      .maybeSingle();

    if (existing) {
      await admin
        .from('channel_connections')
        .update({ config: cfg, status, label: 'Voz' })
        .eq('id', (existing as { id: string }).id);
    } else {
      await admin.from('channel_connections').insert({
        workspace_id: body.workspace_id,
        channel: 'voice',
        label: 'Voz',
        status,
        config: cfg,
      });
    }
    return NextResponse.json({ ok: true, config: cfg, status });
  } catch (err) {
    return serverError(err, 'save voice connection failed');
  }
}
