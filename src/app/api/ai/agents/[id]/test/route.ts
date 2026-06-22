import { NextResponse } from 'next/server';
import { getAnthropic } from '@/lib/ai/anthropic-client';
import { createClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/channels/admin-client';
import { csrfGuard } from '@/lib/csrf';
import { serverError } from '@/lib/api/errors';
import { getLocale } from '@/lib/i18n/server';
import { translate } from '@/lib/i18n/translate';
import { decrypt } from '@/lib/whatsapp/encryption';
import type { AiAgent, AiTone } from '@/lib/ai/types';
import { splitReplyForMode } from '@/lib/ai/runner';
import { appendBusinessScopeGuardrails } from '@/lib/ai/guardrails';
import {
  buildCheckoutTool,
  buildOrderTool,
  LOOKUP_ORDER_TOOL,
  runWithTools,
  type ShopifyToolContext,
} from '@/lib/ai/tools';
import { shopifyApiVersion } from '@/lib/shopify/oauth';
import type { CheckoutConfig } from '@/lib/shopify/create-checkout';

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
  const locale = await getLocale();
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json(
      { error: translate(locale, 'errAi.unauthorized') },
      { status: 401 },
    );

  const body = (await request.json().catch(() => null)) as {
    message?: string;
    simulated_phone?: string;
  } | null;
  const message = body?.message?.trim();
  if (!message) {
    return NextResponse.json(
      { error: translate(locale, 'errAi.messageRequired') },
      { status: 400 },
    );
  }

  const admin = supabaseAdmin();
  const { data: agent } = await admin
    .from('ai_agents')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (!agent)
    return NextResponse.json(
      { error: translate(locale, 'errAi.notFound') },
      { status: 404 },
    );

  const { data: member } = await admin
    .from('workspace_members')
    .select('id')
    .eq('workspace_id', (agent as AiAgent).workspace_id)
    .eq('user_id', user.id)
    .maybeSingle();
  if (!member)
    return NextResponse.json(
      { error: translate(locale, 'errAi.forbidden') },
      { status: 403 },
    );

  const a = agent as AiAgent;
  try {
    const apiKey =
      (a.api_key_encrypted ? safeDecrypt(a.api_key_encrypted) : null) ||
      process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: translate(locale, 'errAi.missingApiKey') },
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
    // Same server-enforced business-scope guardrails the prod runner appends,
    // so the test panel mirrors live behavior (incl. off-topic refusals).
    appendBusinessScopeGuardrails(lines, a.name);
    const system = lines.filter(Boolean).join('\n\n');

    // ── Shopify tool (opcional) ──
    // Resolvemos la conexión cruzando workspace_members: lo mismo que
    // hace el runner en prod cuando elige qué token usar para el lookup.
    const shopify = await resolveShopifyContextForWorkspace(
      admin,
      a.workspace_id,
      body?.simulated_phone,
    );
    // dryRun: el panel de prueba NUNCA crea pedidos reales. canCreateOrders
    // refleja el toggle del agente para que el tester vea la tool si aplica.
    if (shopify) {
      shopify.dryRun = true;
      shopify.canCreateOrders = a.puede_crear_pedidos === true;
      shopify.workspaceId = a.workspace_id;
      shopify.agentId = a.id;
    }

    const client = getAnthropic(apiKey);
    const max_tokens = Math.max(
      64,
      Math.min(2048, Math.ceil((a.max_response_chars || 500) / 2)),
    );
    const tools = shopify
      ? [
          LOOKUP_ORDER_TOOL,
          buildCheckoutTool(shopify.config ?? null),
          ...(shopify.canCreateOrders
            ? [buildOrderTool(shopify.config ?? null)]
            : []),
        ]
      : [];
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
    return serverError(err, translate(locale, 'errAi.testGenerateFailed'), 502);
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
 * Post-055 leemos shopify_connections por workspace_id directo. Si no
 * hay match, caemos al lookup vía workspace_members como red de
 * seguridad para filas pre-migración.
 *
 * Devuelve null si no hay conexión activa — el caller usa eso para
 * decidir si exponer la tool o no.
 */
async function resolveShopifyContextForWorkspace(
  admin: ReturnType<typeof supabaseAdmin>,
  workspaceId: string,
  simulatedPhone: string | undefined,
): Promise<ShopifyToolContext | null> {
  // Primary: shopify_connections.workspace_id.
  let conn: { shop_domain: string; access_token: string } | null = null;
  {
    const { data: row } = await admin
      .from('shopify_connections')
      .select('shop_domain, access_token')
      .eq('workspace_id', workspaceId)
      .eq('status', 'active')
      .order('installed_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    conn = row as { shop_domain: string; access_token: string } | null;
  }

  if (!conn) {
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
    conn = row as { shop_domain: string; access_token: string } | null;
  }

  if (!conn?.access_token) return null;
  let accessToken: string;
  try {
    accessToken = decrypt(conn.access_token);
  } catch {
    return null;
  }

  // Per-workspace checkout config (BUNDLE vs AUTO mode). Same source the
  // prod runner reads from, so the test panel mirrors live behavior.
  const { data: cfg } = await admin
    .from('workspace_checkout_config')
    .select('*')
    .eq('workspace_id', workspaceId)
    .maybeSingle();

  return {
    shopDomain: conn.shop_domain,
    accessToken,
    apiVersion: shopifyApiVersion(),
    customerPhone: simulatedPhone?.trim() || undefined,
    config: (cfg as CheckoutConfig | null) ?? null,
  };
}
