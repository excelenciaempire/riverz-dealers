import { NextResponse } from 'next/server';
import type { Contact, VoiceCall } from '@/types';
import type { AiAgent } from '@/lib/ai/types';
import { serverError } from '@/lib/api/errors';
import { supabaseAdmin } from '@/lib/channels/admin-client';
import { assertVoiceWorkerAuth } from '@/lib/voice/auth';
import { resolveShopifyContext } from '@/lib/ai/runner';
import { runTool } from '@/lib/ai/tools';
import { resolveWorkspaceCurrency } from '@/lib/products/currency';

/**
 * POST /api/internal/voice/tool
 * Bridges the worker's function tools to the existing Shopify tool logic
 * (lookup_order / create_checkout / create_order). The worker forwards the
 * model's tool call; we run it server-side with the call's workspace context
 * and return the JSON string the model should see as the tool result.
 * Auth: Bearer VOICE_WORKER_SECRET.
 */
export async function POST(request: Request) {
  try {
    assertVoiceWorkerAuth(request);
  } catch (r) {
    if (r instanceof Response) return r;
    throw r;
  }

  const body = (await request.json().catch(() => null)) as {
    call_id?: string;
    tool?: string;
    input?: unknown;
  } | null;
  if (!body?.call_id || !body.tool) {
    return NextResponse.json({ error: 'call_id and tool required' }, { status: 400 });
  }

  const db = supabaseAdmin();
  try {
    const { data: callRow } = await db
      .from('voice_calls')
      .select('*')
      .eq('id', body.call_id)
      .maybeSingle();
    if (!callRow) return NextResponse.json({ error: 'call_not_found' }, { status: 404 });
    const call = callRow as VoiceCall;

    const { data: contactRow } = await db
      .from('contacts')
      .select('*')
      .eq('id', call.contact_id)
      .maybeSingle();
    if (!contactRow) return NextResponse.json({ error: 'contact_not_found' }, { status: 404 });
    const contact = contactRow as Contact;

    const { data: agentRow } = await db
      .from('ai_agents')
      .select('puede_crear_pedidos')
      .eq('id', call.agent_id)
      .maybeSingle();
    const canCreateOrders =
      (agentRow as Pick<AiAgent, 'puede_crear_pedidos'> | null)?.puede_crear_pedidos === true;

    const shopify = await resolveShopifyContext(db, call.workspace_id, contact, null);
    if (shopify) {
      const currency = await resolveWorkspaceCurrency(db, call.workspace_id);
      shopify.canCreateOrders = canCreateOrders;
      shopify.workspaceId = call.workspace_id;
      shopify.agentId = call.agent_id;
      shopify.contactId = call.contact_id;
      shopify.conversationId = call.conversation_id;
      shopify.channel = 'voice';
      shopify.contactName = contact.name ?? null;
      shopify.currency = shopify.config?.currency || currency;
    }

    const result = await runTool(body.tool, body.input ?? {}, shopify);
    return NextResponse.json({ ok: true, result });
  } catch (err) {
    return serverError(err, 'voice tool failed');
  }
}
