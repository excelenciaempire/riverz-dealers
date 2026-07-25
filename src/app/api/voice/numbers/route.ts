import { NextResponse } from 'next/server';
import type { VoiceConnectionConfig } from '@/types';
import { createClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/channels/admin-client';
import { csrfGuard } from '@/lib/csrf';
import { serverError } from '@/lib/api/errors';
import {
  orderNumber,
  releaseNumber,
  findOwnedNumber,
  type PhoneNumberType,
} from '@/lib/voice/telnyx-numbers';

/**
 * Voice phone numbers — per-workspace self-serve provisioning.
 *   GET    → the workspace's current number (from the voice connection config)
 *   POST   → order a number (PAID) + attach it + persist as the workspace DID
 *   DELETE → release the number (stops the rental) + clear the config
 * Session-authenticated (workspace member).
 */

async function member(userId: string, workspaceId: string): Promise<boolean> {
  const { data } = await supabaseAdmin()
    .from('workspace_members')
    .select('id')
    .eq('workspace_id', workspaceId)
    .eq('user_id', userId)
    .maybeSingle();
  return Boolean(data);
}

/** Buying/releasing a number is paid + destructive → admins only, matching
 *  every other channel-connect action in the app. */
async function admin(userId: string, workspaceId: string): Promise<boolean> {
  const { data } = await supabaseAdmin()
    .from('workspace_members')
    .select('id')
    .eq('workspace_id', workspaceId)
    .eq('user_id', userId)
    .eq('role', 'admin')
    .maybeSingle();
  return Boolean(data);
}

async function readVoiceConfig(
  workspaceId: string,
): Promise<{ id: string | null; config: VoiceConnectionConfig }> {
  // limit(1) (not maybeSingle): if a race ever produced two voice rows, don't
  // throw — take the earliest deterministically.
  const { data } = await supabaseAdmin()
    .from('channel_connections')
    .select('id, config')
    .eq('workspace_id', workspaceId)
    .eq('channel', 'voice')
    .order('created_at', { ascending: true })
    .limit(1);
  const row = (data as { id?: string; config?: VoiceConnectionConfig }[] | null)?.[0] ?? null;
  return { id: row?.id ?? null, config: row?.config ?? {} };
}

async function writeVoiceConfig(
  workspaceId: string,
  id: string | null,
  config: VoiceConnectionConfig,
  status: string,
): Promise<void> {
  if (id) {
    await supabaseAdmin()
      .from('channel_connections')
      .update({ config, status, updated_at: new Date().toISOString() })
      .eq('id', id);
  } else {
    await supabaseAdmin()
      .from('channel_connections')
      .insert({ workspace_id: workspaceId, channel: 'voice', config, status });
  }
}

export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const workspaceId = new URL(request.url).searchParams.get('workspace_id');
  if (!workspaceId) return NextResponse.json({ error: 'workspace_id required' }, { status: 400 });
  if (!(await member(user.id, workspaceId)))
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const { config } = await readVoiceConfig(workspaceId);
  return NextResponse.json({
    phone_number: config.phone_number ?? null,
    country: config.country ?? null,
    telnyx_number_id: config.telnyx_number_id ?? null,
  });
}

export async function POST(request: Request) {
  const block = await csrfGuard(request);
  if (block) return block;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const body = (await request.json().catch(() => null)) as {
    workspace_id?: string;
    phone_number?: string;
    country?: string;
    type?: PhoneNumberType;
    requirement_group_id?: string;
  } | null;
  if (!body?.workspace_id || !body.phone_number) {
    return NextResponse.json({ error: 'workspace_id and phone_number required' }, { status: 400 });
  }
  if (!(await admin(user.id, body.workspace_id)))
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const { id, config } = await readVoiceConfig(body.workspace_id);
  // One number per workspace: refuse if one is already provisioned (release
  // first). Guard on either field so a missing id can't reopen the door.
  if (config.telnyx_number_id || config.phone_number) {
    return NextResponse.json({ error: 'number_already_provisioned' }, { status: 409 });
  }

  try {
    const ordered = await orderNumber({
      phoneNumber: body.phone_number,
      requirementGroupId: body.requirement_group_id,
      customerReference: body.workspace_id,
      // Same (workspace, number) retry → Telnyx dedupes, never double-bills.
      idempotencyKey: `voice-${body.workspace_id}-${body.phone_number}`,
    });
    const nextConfig: VoiceConnectionConfig = {
      ...config,
      phone_number: ordered.phone_number,
      country: body.country ?? config.country,
      telnyx_number_id: ordered.id || undefined,
    };
    await writeVoiceConfig(body.workspace_id, id, nextConfig, 'connected');
    return NextResponse.json(
      { ok: true, phone_number: ordered.phone_number, status: ordered.status },
      { status: 201 },
    );
  } catch (err) {
    return serverError(err, 'number order failed');
  }
}

export async function DELETE(request: Request) {
  const block = await csrfGuard(request);
  if (block) return block;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const workspaceId = new URL(request.url).searchParams.get('workspace_id');
  if (!workspaceId) return NextResponse.json({ error: 'workspace_id required' }, { status: 400 });
  if (!(await admin(user.id, workspaceId)))
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const { id, config } = await readVoiceConfig(workspaceId);
  try {
    // Prefer the stored Telnyx id; fall back to a lookup by number.
    let telnyxId = config.telnyx_number_id;
    if (!telnyxId && config.phone_number) {
      telnyxId = (await findOwnedNumber(config.phone_number))?.id;
    }
    if (telnyxId) await releaseNumber(telnyxId);
    const nextConfig: VoiceConnectionConfig = {
      ...config,
      phone_number: undefined,
      telnyx_number_id: undefined,
    };
    await writeVoiceConfig(workspaceId, id, nextConfig, 'disconnected');
    return NextResponse.json({ ok: true });
  } catch (err) {
    return serverError(err, 'number release failed');
  }
}
