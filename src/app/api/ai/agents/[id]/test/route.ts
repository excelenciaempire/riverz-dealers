import { NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/channels/admin-client';
import { csrfGuard } from '@/lib/csrf';
import { decrypt } from '@/lib/whatsapp/encryption';
import type { AiAgent, AiTone } from '@/lib/ai/types';
import { splitReplyForMode } from '@/lib/ai/runner';
import {
  CREATE_CHECKOUT_TOOL,
  LOOKUP_ORDER_TOOL,
  runWithTools,
  type ShopifyToolContext,
} from '@/lib/ai/tools';
import { shopifyApiVersion } from '@/lib/shopify/oauth';

/**
 * Smoke-test an AI agent without involving any channel. Generates a
 * reply for the supplied user message using the agent's persona,
 * knowledge, tone, and provider config, and returns it as JSON.
 *
 * POST /api/ai/agents/[id]/test
 *   body: { message: string, simulated_phone?: string }
 *   response: { reply: string, chunks: string[], usage: {...} }
 *
 * `chunks` respeta el `response_mode` del agente para que el panel de
 * prueba muestre exactamente las burbujas que vería el cliente en
 * WhatsApp. `reply` queda para back-compat.
 *
 * Si el workspace dueño del agente tiene Shopify conectado, se le pasa
 * a Claude la tool `lookup_order` para que pueda probar el flujo de
 * consulta de pedidos. El teléfono del cliente simulado se toma del
 * body (`simulated_phone`); si no llega, la tool igual se expone pero
 * va a devolver "no encontré pedidos".
 */
const TONE_INSTRUCTIONS: Record<AiTone, string> = {
  friendly: 'Conversa con calidez. Usa frases cortas. Evita formalismos rígidos.',
  formal: 'Mantén un registro profesional y formal. Usa "usted".',
  casual: 'Sé directo y cercano. Permítete frases coloquiales.',
  concise: 'Responde en una o dos frases. Sin saludos. Solo lo necesario.',
};

export async function POST(
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

  const body = (await request.json().catch(() => null)) as {
    message?: string;
    simulated_phone?: string;
  } | null;
  const message = body?.message?.trim();
  if (!message) {
    return NextResponse.json({ error: 'message required' }, { status: 400 });
  }

  const admin = supabaseAdmin();
  const { data: agent } = await admin
    .from('ai_agents')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (!agent) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const { data: member } = await admin
    .from('workspace_members')
    .select('id')
    .eq('workspace_id', (agent as AiAgent).workspace_id)
    .eq('user_id', user.id)
    .maybeSingle();
  if (!member) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const a = agent as AiAgent;
  try {
    const apiKey =
      (a.api_key_encrypted ? safeDecrypt(a.api_key_encrypted) : null) ||
      process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: 'Falta la API key (workspace o ANTHROPIC_API_KEY del servidor).' },
        { status: 500 },
      );
    }

    const lines: string[] = [];
    if (a.persona) lines.push(a.persona.trim());
    lines.push(TONE_INSTRUCTIONS[a.tone] ?? '');
    lines.push(`Responde en ${a.language || 'es'}.`);
    lines.push(`Mantente bajo ${a.max_response_chars} caracteres.`);
    if (a.knowledge?.trim()) {
      lines.push('Contexto adicional:');
      lines.push(a.knowledge.trim());
    }
    const system = lines.filter(Boolean).join('\n\n');

    // ── Shopify tool (opcional) ──
    // Resolvemos la conexión cruzando workspace_members: lo mismo que
    // hace el runner en prod cuando elige qué token usar para el lookup.
    const shopify = await resolveShopifyContextForWorkspace(
      admin,
      a.workspace_id,
      body?.simulated_phone,
    );

    const client = new Anthropic({ apiKey });
    const max_tokens = Math.max(
      64,
      Math.min(2048, Math.ceil((a.max_response_chars || 500) / 2)),
    );
    const tools = shopify ? [LOOKUP_ORDER_TOOL, CREATE_CHECKOUT_TOOL] : [];
    const result = await runWithTools(client, {
      model: a.model || 'claude-haiku-4-5-20251001',
      max_tokens,
      system,
      messages: [{ role: 'user', content: message }],
      tools,
      shopify,
    });

    const text = result.text;
    const chunks = splitReplyForMode(text, a.response_mode);

    return NextResponse.json({
      reply: text,
      chunks,
      usage: {
        input_tokens: result.promptTokens,
        output_tokens: result.completionTokens,
        iterations: result.iterations,
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'AI call failed' },
      { status: 502 },
    );
  }
}

function safeDecrypt(value: string): string | null {
  try {
    return decrypt(value);
  } catch {
    return null;
  }
}

/**
 * Levanta el contexto Shopify del workspace del agente.
 *
 * Antes priorizábamos owner_id, pero en workspaces multi-miembro la
 * conexión Shopify suele estar instalada por un miembro que no es el
 * owner. Ahora buscamos CUALQUIER conexión activa cuyo user_id esté en
 * workspace_members del workspace, tomando la más reciente. Esto refleja
 * lo que hace el runner en prod.
 *
 * Devuelve null si no hay conexión activa — el caller usa eso para
 * decidir si exponer la tool o no.
 */
async function resolveShopifyContextForWorkspace(
  admin: ReturnType<typeof supabaseAdmin>,
  workspaceId: string,
  simulatedPhone: string | undefined,
): Promise<ShopifyToolContext | null> {
  const { data: members } = await admin
    .from('workspace_members')
    .select('user_id')
    .eq('workspace_id', workspaceId);
  const memberIds = ((members as { user_id: string }[] | null) ?? [])
    .map((m) => m.user_id)
    .filter(Boolean);
  if (memberIds.length === 0) return null;

  const { data: row } = await admin
    .from('shopify_connections')
    .select('shop_domain, access_token')
    .in('user_id', memberIds)
    .eq('status', 'active')
    .order('installed_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  const conn = row as { shop_domain: string; access_token: string } | null;
  if (!conn?.access_token) return null;
  let accessToken: string;
  try {
    accessToken = decrypt(conn.access_token);
  } catch {
    return null;
  }

  return {
    shopDomain: conn.shop_domain,
    accessToken,
    apiVersion: shopifyApiVersion(),
    customerPhone: simulatedPhone?.trim() || undefined,
  };
}
