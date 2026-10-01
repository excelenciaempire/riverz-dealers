import crypto from 'node:crypto';
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/flows/admin-client';
import { csrfGuard } from '@/lib/csrf';
import { resolveWorkspaceId } from '@/lib/instagram-agent/workspace';
import { WEBHOOK_EVENTS } from '@/lib/webhooks/outbound';
import { isPublicHttpsUrl } from '@/lib/security/url-guard';
import { safeLocale } from '@/lib/i18n/server';
import { translate } from '@/lib/i18n/translate';

async function session() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const workspaceId = await resolveWorkspaceId(supabase, user.id);
  if (!workspaceId) return null;
  const { data: member } = await supabase.from('workspace_members').select('role').eq('workspace_id', workspaceId).eq('user_id', user.id).maybeSingle();
  return member?.role === 'admin' ? { user, workspaceId } : null;
}

export async function GET() {
  const auth = await session();
  if (!auth) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { data, error } = await supabaseAdmin().from('webhook_endpoints')
    .select('id, name, url, events, is_active, created_at, updated_at, webhook_deliveries(status_code, succeeded, delivered_at)')
    .eq('workspace_id', auth.workspaceId).order('created_at', { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ endpoints: data ?? [], events: WEBHOOK_EVENTS });
}

export async function POST(request: Request) {
  const block = await csrfGuard(request); if (block) return block;
  const auth = await session();
  if (!auth) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const body = await request.json().catch(() => ({})) as { name?: string; url?: string; events?: string[] };
  const name = typeof body?.name === 'string' ? body.name.trim() : '';
  const url = typeof body?.url === 'string' ? body.url.trim() : '';
  const events = Array.isArray(body?.events) ? [...new Set(body.events.filter((event): event is (typeof WEBHOOK_EVENTS)[number] => typeof event === 'string' && WEBHOOK_EVENTS.includes(event as (typeof WEBHOOK_EVENTS)[number])))] : [];
  if (!name || name.length > 80 || !url || url.length > 2048 || !isPublicHttpsUrl(url) || !events.length) return NextResponse.json({ code: 'invalid_webhook', error: translate(await safeLocale(), 'settings.webhookInvalid') }, { status: 400 });
  const secret = crypto.randomBytes(32).toString('hex');
  const { data, error } = await supabaseAdmin().from('webhook_endpoints').insert({ workspace_id: auth.workspaceId, created_by: auth.user.id, name, url, events, secret }).select('id, name, url, events, is_active, created_at').single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ endpoint: data, secret }, { status: 201 });
}

export async function DELETE(request: Request) {
  const block = await csrfGuard(request); if (block) return block;
  const auth = await session(); if (!auth) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const id = new URL(request.url).searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'invalid_webhook' }, { status: 400 });
  const { error } = await supabaseAdmin().from('webhook_endpoints').delete().eq('id', id).eq('workspace_id', auth.workspaceId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
