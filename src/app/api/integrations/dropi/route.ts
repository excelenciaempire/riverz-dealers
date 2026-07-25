import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/channels/admin-client';
import { csrfGuard } from '@/lib/csrf';
import { encrypt } from '@/lib/whatsapp/encryption';
import { resolveWorkspaceId } from '@/lib/instagram-agent/workspace';
import type { DropiConfig } from '@/lib/integrations/dropi';

/**
 * Dropi integration (COD fulfillment). Per-workspace API key (encrypted) + a
 * small config (base_url / orders_path / integration_id). Writes go through the
 * service role (dropi_connections has member-SELECT RLS only).
 *   GET    — connected? + config (never the key)
 *   POST   — save/update key + config
 *   DELETE — disconnect
 */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const workspaceId = await resolveWorkspaceId(supabase, user.id);
  if (!workspaceId) return NextResponse.json({ connected: false, config: {} });

  const { data } = await supabaseAdmin()
    .from('dropi_connections')
    .select('api_key_encrypted, config, status')
    .eq('workspace_id', workspaceId)
    .maybeSingle();
  const row = data as {
    api_key_encrypted: string | null;
    config: DropiConfig | null;
    status: string;
  } | null;
  return NextResponse.json({
    connected: !!row && row.status === 'connected' && !!row.api_key_encrypted,
    has_key: !!row?.api_key_encrypted,
    config: row?.config ?? {},
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

  const workspaceId = await resolveWorkspaceId(supabase, user.id);
  if (!workspaceId) return NextResponse.json({ error: 'no_workspace' }, { status: 403 });

  const body = (await request.json().catch(() => ({}))) as {
    api_key?: string;
    config?: DropiConfig;
  };

  const update: Record<string, unknown> = {
    workspace_id: workspaceId,
    status: 'connected',
    config: {
      base_url: body.config?.base_url?.trim() || undefined,
      orders_path: body.config?.orders_path?.trim() || undefined,
      integration_id: body.config?.integration_id?.trim() || undefined,
    },
    updated_at: new Date().toISOString(),
  };
  if (typeof body.api_key === 'string' && body.api_key.trim()) {
    update.api_key_encrypted = encrypt(body.api_key.trim());
  }

  const { error } = await supabaseAdmin()
    .from('dropi_connections')
    .upsert(update, { onConflict: 'workspace_id' });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true, connected: true });
}

export async function DELETE(request: Request) {
  const block = await csrfGuard(request);
  if (block) return block;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const workspaceId = await resolveWorkspaceId(supabase, user.id);
  if (!workspaceId) return NextResponse.json({ error: 'no_workspace' }, { status: 403 });

  const { error } = await supabaseAdmin()
    .from('dropi_connections')
    .delete()
    .eq('workspace_id', workspaceId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true, connected: false });
}
