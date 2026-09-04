import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { csrfGuard } from '@/lib/csrf';
import { resolveWorkspaceId } from '@/lib/instagram-agent/workspace';
import { emitWebhook } from '@/lib/webhooks/outbound';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const block = await csrfGuard(request); if (block) return block;
  const supabase = await createClient(); const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const workspaceId = await resolveWorkspaceId(supabase, user.id); const { id } = await params;
  const { data: member } = workspaceId ? await supabase.from('workspace_members').select('role').eq('workspace_id', workspaceId).eq('user_id', user.id).maybeSingle() : { data: null };
  if (member?.role !== 'admin') return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  if (!workspaceId || !id) return NextResponse.json({ error: 'invalid_webhook' }, { status: 400 });
  await emitWebhook(workspaceId, 'conversation.created', { test: true, source: 'riverz', endpoint_id: id }, id);
  return NextResponse.json({ success: true });
}
