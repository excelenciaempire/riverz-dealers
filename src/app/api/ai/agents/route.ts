import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/channels/admin-client';
import { csrfGuard } from '@/lib/csrf';
import { serverError } from '@/lib/api/errors';
import { encrypt } from '@/lib/whatsapp/encryption';
import type { AiAgent } from '@/lib/ai/types';

/**
 * List + create endpoints for AI customer-service agents.
 * Workspace-scoped — the caller must be a member of the workspace.
 *
 * GET    /api/ai/agents?workspace_id=<uuid>
 * POST   /api/ai/agents          body: { workspace_id, name, ...defaults }
 */
export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const workspaceId = new URL(request.url).searchParams.get('workspace_id');
  if (!workspaceId) {
    return NextResponse.json({ error: 'workspace_id required' }, { status: 400 });
  }

  const admin = supabaseAdmin();
  const { data: member } = await admin
    .from('workspace_members')
    .select('id')
    .eq('workspace_id', workspaceId)
    .eq('user_id', user.id)
    .maybeSingle();
  if (!member) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { data, error } = await admin
    .from('ai_agents')
    .select('*, ai_agent_channels(channel)')
    .eq('workspace_id', workspaceId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false });
  if (error) return serverError(error);

  // Never leak the encrypted key.
  const safe = (data ?? []).map((a) => stripKey(a as AgentWithChannels));
  return NextResponse.json({ agents: safe });
}

export async function POST(request: Request) {
  const block = await csrfGuard(request);
  if (block) return block;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = (await request.json().catch(() => null)) as Partial<AiAgent> & {
    workspace_id?: string;
    channels?: string[];
    product_ids?: string[];
    api_key?: string;
  } | null;
  if (!body?.workspace_id || !body.name?.trim()) {
    return NextResponse.json(
      { error: 'workspace_id + name required' },
      { status: 400 },
    );
  }

  const admin = supabaseAdmin();
  const { data: member } = await admin
    .from('workspace_members')
    .select('id')
    .eq('workspace_id', body.workspace_id)
    .eq('user_id', user.id)
    .maybeSingle();
  if (!member) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const payload: Record<string, unknown> = {
    workspace_id: body.workspace_id,
    name: body.name.trim(),
    is_active: body.is_active ?? false,
    persona: body.persona ?? '',
    knowledge: body.knowledge ?? null,
    knowledge_url: body.knowledge_url ?? null,
    language: body.language ?? 'es',
    tone: body.tone ?? 'friendly',
    max_response_chars: body.max_response_chars ?? 500,
    reply_delay_seconds: body.reply_delay_seconds ?? 0,
    context_messages: body.context_messages ?? 10,
    response_mode: body.response_mode ?? 'single',
    inbound_debounce_seconds: body.inbound_debounce_seconds ?? 15,
    reply_when_assigned: body.reply_when_assigned ?? false,
    reply_outside_hours: body.reply_outside_hours ?? true,
    business_hours: body.business_hours ?? null,
    escalate_keywords: body.escalate_keywords ?? [],
    escalate_after_messages: body.escalate_after_messages ?? 0,
    provider: body.provider ?? 'anthropic',
    model: body.model ?? 'claude-haiku-4-5-20251001',
    scope: body.scope ?? 'workspace',
    product_scope: body.product_scope ?? 'all',
    priority: body.priority ?? 0,
    created_by: user.id,
  };
  if (body.api_key && body.api_key.trim()) {
    payload.api_key_encrypted = encrypt(body.api_key.trim());
  }

  const { data: created, error } = await admin
    .from('ai_agents')
    .insert(payload)
    .select()
    .single();
  if (error || !created) {
    return serverError(error);
  }

  if (body.scope === 'channels' && Array.isArray(body.channels) && body.channels.length) {
    await admin.from('ai_agent_channels').insert(
      body.channels.map((channel) => ({
        agent_id: (created as AiAgent).id,
        channel,
      })),
    );
  }
  if (
    body.product_scope === 'specific' &&
    Array.isArray(body.product_ids) &&
    body.product_ids.length
  ) {
    await admin.from('ai_agent_products').insert(
      body.product_ids.map((product_id) => ({
        agent_id: (created as AiAgent).id,
        product_id,
      })),
    );
  }

  // Re-read with relations so the client can drop it into its grid
  // optimistically.
  const { data: fresh } = await admin
    .from('ai_agents')
    .select('*, ai_agent_channels(channel), ai_agent_products(product_id)')
    .eq('id', (created as AiAgent).id)
    .maybeSingle();
  return NextResponse.json(
    { agent: stripKey((fresh ?? created) as AiAgent) },
    { status: 201 },
  );
}

type AgentWithChannels = AiAgent & {
  ai_agent_channels?: { channel: string }[];
};

function stripKey<T extends AiAgent>(a: T): Omit<T, 'api_key_encrypted'> & {
  has_api_key: boolean;
} {
  const { api_key_encrypted, ...rest } = a;
  return { ...rest, has_api_key: Boolean(api_key_encrypted) };
}
