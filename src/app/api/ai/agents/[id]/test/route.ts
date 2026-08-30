import { NextResponse } from 'next/server';
import { cobrarUsoDeIa } from '@/lib/wallet/cobrar-uso';
import { getAnthropic } from '@/lib/ai/anthropic-client';
import { resolveAnthropicKey } from '@/lib/ai/platform-key';
import { createClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/channels/admin-client';
import { csrfGuard } from '@/lib/csrf';
import { aiBudgetGuard } from '@/lib/ai/rate-limit';
import { serverError } from '@/lib/api/errors';
import { getLocale } from '@/lib/i18n/server';
import { translate } from '@/lib/i18n/translate';
import { decrypt } from '@/lib/whatsapp/encryption';
import type { AiAgent } from '@/lib/ai/types';
import type { Contact } from '@/types';
import {
  buildSystemPrompt,
  construirHerramientas,
  detectInboundProduct,
  loadProductCatalog,
  productosPermitidos,
  splitReplyForMode,
} from '@/lib/ai/runner';
import { topeDeDescuento } from '@/lib/shopify/discounts';
import { cargarReglas, reglasATexto } from '@/lib/ai/guidance';
import { resolveStoreForLookup } from '@/lib/commerce/order-lookup';
import { resolveWorkspaceCurrency } from '@/lib/products/currency';
import { runWithTools, type ShopifyToolContext } from '@/lib/ai/tools';
import { shopifyApiVersion } from '@/lib/shopify/oauth';
import type { CheckoutConfig } from '@/lib/shopify/create-checkout';

/**
 * Probar el agente sin tocar ningún canal.
 *
 * Esto tenía que ser una vista previa de producción y era otra cosa: armaba el
 * prompt a mano —sin el material de los productos, sin el research, sin las
 * reglas por producto, sin el rol, sin la política de ofertas—, exponía tres
 * herramientas de dieciséis sin mirar la pizarra del comercio, y era SIN
 * ESTADO: cada mensaje era el primero, así que no se podía probar una
 * confirmación, un escalamiento por cantidad de respuestas, ni nada que
 * necesitara dos turnos. El comercio probaba un agente y publicaba otro.
 *
 * Ahora usa `buildSystemPrompt` y `construirHerramientas`, los mismos que corre
 * el runner. Lo único que cambia es lo que TIENE que cambiar:
 *
 *   - no hay conversación ni contacto de verdad, así que nada se guarda en la
 *     bandeja ni cuenta para la facturación;
 *   - `simulacion` corta toda herramienta que deje huella afuera (crear un
 *     pedido, cobrar, emitir un cupón, pedirle permiso al dueño por WhatsApp),
 *     y el corte está en `runTool`, no acá: una herramienta nueva queda
 *     cubierta sin que nadie se acuerde de cubrirla.
 *
 * POST /api/ai/agents/[id]/test
 *   body: { message: string, historial?: {role,content}[], simulated_phone?: string }
 *   → { reply, chunks, herramientas, usage }
 */

/** Cuántos turnos previos se aceptan. Es una prueba, no una conversación. */
const MAX_HISTORIAL = 20;

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
    historial?: unknown;
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

  const overBudget = await aiBudgetGuard((agent as AiAgent).workspace_id);
  if (overBudget) return overBudget;

  const a = agent as AiAgent;
  try {
    const resolvedKey = await resolveAnthropicKey(admin, {
      workspaceId: a.workspace_id,
      agentKeyEncrypted: a.api_key_encrypted,
    });
    const apiKey = resolvedKey?.key;
    if (!apiKey) {
      return NextResponse.json(
        { error: translate(locale, 'errAi.missingApiKey') },
        { status: 500 },
      );
    }

    // El hilo de la prueba. Sin esto cada mensaje era el primero: se podía
    // probar un saludo y nada más.
    const historial = normalizarHistorial(body?.historial);

    // El mismo enganche de producto que producción: es lo que fija el producto
    // y trae su material de entrenamiento al prompt.
    const productMatch = await detectInboundProduct(admin, a.workspace_id, message);
    const [products, businessCurrency, permitidos, reglas, topeDescuento] =
      await Promise.all([
        loadProductCatalog(admin, a, a.workspace_id, productMatch),
        resolveWorkspaceCurrency(admin, a.workspace_id),
        productosPermitidos(admin, a, a.workspace_id),
        cargarReglas(admin, a.workspace_id, a.id).then(reglasATexto),
        topeDeDescuento(admin, a.workspace_id).catch(() => 0),
      ]);

    // Un contacto de mentira, con la forma de uno real. No se guarda en ningún
    // lado: existe para que el prompt tenga a quién nombrar.
    const contacto = {
      id: '',
      workspace_id: a.workspace_id,
      channel: 'webchat',
      external_id: 'prueba',
      name: null,
      phone: body?.simulated_phone?.trim() || null,
      email: null,
    } as unknown as Contact;

    const shopify = await resolveShopifyContextForWorkspace(
      admin,
      a.workspace_id,
      body?.simulated_phone,
    );
    if (shopify) {
      shopify.dryRun = true;
      shopify.canCreateOrders = a.puede_crear_pedidos === true;
      shopify.workspaceId = a.workspace_id;
      shopify.agentId = a.id;
      shopify.currency = shopify.config?.currency || businessCurrency;
    }
    const otraTienda = shopify
      ? null
      : await (async () => {
          const t = await resolveStoreForLookup(admin, a.workspace_id);
          if (!t || t.platform === 'shopify') return null;
          return { ...t, customerEmail: null, customerPhone: null };
        })();

    const system = buildSystemPrompt(
      a,
      contacto,
      contacto,
      null,
      [],
      { messages: [], rollingSummary: null, idleResetHint: null },
      products,
      productMatch,
      shopify,
      null,
      businessCurrency,
      reglas,
    );

    // La misma lista que produccion, resuelta por la pizarra del comercio.
    // `hayContacto` va en true a propósito: lo que hay que previsualizar es lo
    // que el agente PUEDE hacer, y lo que dejaría huella lo corta `runTool`.
    const tools = construirHerramientas({
      agent: a,
      hayContacto: true,
      shopify,
      otherStore: otraTienda,
      // Nunca se llama por teléfono a nadie desde una prueba.
      voiceCtx: null,
      topeDescuento,
    });

    const client = getAnthropic(apiKey);
    const result = await runWithTools(client, {
      model: a.model || 'claude-haiku-4-5-20251001',
      max_tokens: Math.max(
        64,
        Math.min(2048, Math.ceil((a.max_response_chars || 500) / 2)),
      ),
      system,
      messages: [...historial, { role: 'user' as const, content: message }],
      tools,
      shopify,
      otherStore: otraTienda,
      localOrders: {
        db: admin,
        workspaceId: a.workspace_id,
        // Sin contacto real: las herramientas que escriben sobre una persona
        // devuelven su error de siempre, que es exactamente lo que pasaría.
        contactId: '',
        agentId: a.id,
        permitidos,
        simulacion: true,
      },
    });

    // Probar cuesta lo mismo que contestar: es el agente entero corriendo.
    void cobrarUsoDeIa(admin, a.workspace_id, {
      concepto: 'ia_asistencia',
      modelo: a.model || 'claude-haiku-4-5-20251001',
      uso: {
        prompt: result.promptTokens ?? 0,
        salida: result.completionTokens ?? 0,
        cacheLeida: result.cacheReadTokens ?? 0,
        cacheEscrita: result.cacheWriteTokens ?? 0,
      },
      origenDeLaClave: resolvedKey?.source ?? null,
      referenciaTipo: 'agent',
      referenciaId: a.id,
      detalle: { para: 'probar_agente' },
    });

    const text = result.text;
    return NextResponse.json({
      reply: text,
      chunks: splitReplyForMode(text, a.response_mode),
      // Qué herramientas usó. Es la mitad de lo que un comercio quiere ver al
      // probar: no sólo qué contestó, sino si fue a buscar el dato o se lo
      // inventó.
      herramientas: result.herramientas,
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

/** El hilo previo que manda la pantalla, acotado y con la forma que pide la API. */
function normalizarHistorial(valor: unknown): Array<{ role: 'user' | 'assistant'; content: string }> {
  if (!Array.isArray(valor)) return [];
  const turnos = valor
    .map((t) => {
      const role = (t as { role?: unknown })?.role;
      const content = (t as { content?: unknown })?.content;
      if (role !== 'user' && role !== 'assistant') return null;
      if (typeof content !== 'string' || !content.trim()) return null;
      return { role, content: content.trim().slice(0, 4000) };
    })
    .filter(Boolean) as Array<{ role: 'user' | 'assistant'; content: string }>;
  // La API exige que el hilo arranque con el usuario.
  while (turnos.length && turnos[0].role !== 'user') turnos.shift();
  return turnos.slice(-MAX_HISTORIAL);
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
      .eq('platform', 'shopify')
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
      .eq('platform', 'shopify')
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
