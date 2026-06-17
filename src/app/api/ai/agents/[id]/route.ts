import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { serverError } from '@/lib/api/errors';
import { supabaseAdmin } from '@/lib/channels/admin-client';
import { csrfGuard } from '@/lib/csrf';
import { encrypt } from '@/lib/whatsapp/encryption';
import type { AiAgent, AiScope } from '@/lib/ai/types';

async function requireMember(agentId: string, userId: string) {
  const admin = supabaseAdmin();
  const { data: agent } = await admin
    .from('ai_agents')
    .select('id, workspace_id')
    .eq('id', agentId)
    .maybeSingle();
  if (!agent) return null;
  const { data: member } = await admin
    .from('workspace_members')
    .select('id')
    .eq('workspace_id', (agent as { workspace_id: string }).workspace_id)
    .eq('user_id', userId)
    .maybeSingle();
  if (!member) return null;
  return agent as { id: string; workspace_id: string };
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const block = await csrfGuard(request);
  if (block) return block;
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const target = await requireMember(id, user.id);
  if (!target) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const body = (await request.json().catch(() => null)) as
    | (Partial<AiAgent> & {
        channels?: string[];
        product_ids?: string[];
        api_key?: string;
      })
    | null;
  if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });

  const admin = supabaseAdmin();
  const update: Record<string, unknown> = {};
  const ALLOWED: (keyof AiAgent)[] = [
    'name',
    'is_active',
    'persona',
    'knowledge',
    'knowledge_url',
    'language',
    'tone',
    'max_response_chars',
    'reply_delay_seconds',
    'context_messages',
    'response_mode',
    'inbound_debounce_seconds',
    'reply_when_assigned',
    'reply_outside_hours',
    'business_hours',
    'escalate_keywords',
    'escalate_after_messages',
    'provider',
    'model',
    'scope',
    'product_scope',
    'priority',
  ];
  for (const k of ALLOWED) {
    if (k in body) update[k] = body[k];
  }
  if (typeof body.api_key === 'string') {
    update.api_key_encrypted = body.api_key.trim() ? encrypt(body.api_key.trim()) : null;
  }

  if (Object.keys(update).length) {
    const { error } = await admin.from('ai_agents').update(update).eq('id', id);
    if (error) return serverError(error);
  }

  // Replace per-channel bindings when channels are provided.
  if (Array.isArray(body.channels)) {
    await admin.from('ai_agent_channels').delete().eq('agent_id', id);
    if ((update.scope ?? 'workspace') === 'channels' && body.channels.length) {
      await admin
        .from('ai_agent_channels')
        .insert(body.channels.map((channel) => ({ agent_id: id, channel })));
    }
  }
  // Even if channels weren't sent, if scope flipped to 'workspace', clear bindings.
  if ((update.scope as AiScope | undefined) === 'workspace') {
    await admin.from('ai_agent_channels').delete().eq('agent_id', id);
  }

  // Replace per-product bindings when provided.
  if (Array.isArray(body.product_ids)) {
    await admin.from('ai_agent_products').delete().eq('agent_id', id);
    if ((update.product_scope ?? 'all') === 'specific' && body.product_ids.length) {
      await admin
        .from('ai_agent_products')
        .insert(body.product_ids.map((product_id) => ({ agent_id: id, product_id })));
    }
  }
  if ((update.product_scope as AiAgent['product_scope'] | undefined) === 'all') {
    await admin.from('ai_agent_products').delete().eq('agent_id', id);
  }

  // Re-read the agent (with relations) so the client can optimistically
  // patch its local state without a follow-up GET.
  const { data: fresh } = await admin
    .from('ai_agents')
    .select('*, ai_agent_channels(channel), ai_agent_products(product_id)')
    .eq('id', id)
    .maybeSingle();
  const safe = fresh
    ? (() => {
        const { api_key_encrypted, ...rest } = fresh as AiAgent;
        return { ...rest, has_api_key: Boolean(api_key_encrypted) };
      })()
    : null;
  return NextResponse.json({ ok: true, agent: safe });
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const block = await csrfGuard(request);
  if (block) return block;
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const target = await requireMember(id, user.id);
  if (!target) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // Soft-delete via migration 059's `deleted_at` column. Partial index
  // `idx_ai_agents_workspace_active` ignores tombstones so the runner
  // stops picking this agent immediately, while ai_replies history is
  // preserved for analytics.
  const { error } = await supabaseAdmin()
    .from('ai_agents')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id)
    .is('deleted_at', null);
  if (error) return serverError(error);
  return NextResponse.json({ ok: true });
}
