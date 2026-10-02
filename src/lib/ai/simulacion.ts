import { getAnthropic } from '@/lib/ai/anthropic-client';
import { loadHttpAssistantTools } from './http-actions';
import { revitalyFeedbackBrief, ensureRevitalyIntroduction } from './revitaly-channel-policy';
import { revitalyTransferReply } from './revitaly-transfer';
import { revitalyDiscountReply } from './revitaly-discounts';
import { revitalyTransferShippingReply } from './revitaly-transfer-shipping';
import { loadRevitalyWhatsAppPolicy, revitalyWhatsAppRedirectText } from './revitaly-whatsapp-policy';
import { loadRevitalyPackagingNotice } from './revitaly-packaging';
import {emailDispositionForPolicy,emailRedirectText,isEmailChannel,loadEmailPolicy} from './email-policy';
import { MODELO_POR_DEFECTO, reguladoPorEsfuerzo } from '@/lib/ai/esfuerzo';
import { untrustedContext } from '@/lib/ai/input-security';
import { recortarSalida, salidaParaCliente } from '@/lib/ai/salida';
import { IG_DM_MAX_CHARS, SURFACE_RULES } from '@/lib/ai/super-agent';
import { orderConversationModel } from './order-conversation-policy';
import { recoveryHasExistingOrder } from './recovery-policy';
import { isDeliveryIncidentHandoff } from '@/lib/automations/delivery-incident-context';
import { cargarReglas, reglasATexto } from '@/lib/ai/guidance';
import { withDocumentKnowledge } from './document-sources';
import { resolveAnthropicKey } from '@/lib/ai/platform-key';
import {
  armarSystemPrompt,
  buildSystemPrompt,
  construirHerramientas,
  detectInboundProduct,
  guardasDeSalida,
  loadProductCatalog,
  productoUnicoAsignado,
  productosPermitidos,
  splitReplyForMode,
  systemDelTurno,
} from '@/lib/ai/runner';
import { asksForCurrentOffer, asksForPrice } from '@/lib/products/price-integrity';
import { refreshLivePricing } from '@/lib/shopify/live-pricing';
import { resolverRegistro } from '@/lib/ai/registro-rioplatense';
import { runWithTools, type ShopifyToolContext, type SystemPorCapas } from '@/lib/ai/tools';
import type { AiAgent } from '@/lib/ai/types';
import { loadAgentToolContext } from './tool-context';
import { supabaseAdmin } from '@/lib/channels/admin-client';
import { REGLAS_COMENTARIO_PUBLICO } from '@/lib/channels/publicacion';
import { resolveStoreForLookup } from '@/lib/commerce/order-lookup';
import { cargarPerfilOperativo } from '@/lib/operacion/perfil-operativo';
import { resolveWorkspaceCurrency } from '@/lib/products/currency';
import type { CheckoutConfig } from '@/lib/shopify/create-checkout';
import { topeDeDescuento } from '@/lib/shopify/discounts';
import { shopifyApiVersion } from '@/lib/shopify/oauth';
import { decrypt } from '@/lib/whatsapp/encryption';
import { CHANNELS, type Channel, type Contact } from '@/types';

/**
 * Correr el agente como en producción, sin tocar ningún canal.
 *
 * Es el corazón de "Probar" (por agente) y de "Probar como cliente" (por
 * comercio): el mismo `buildSystemPrompt` y `construirHerramientas` que el
 * runner. Lo único distinto es lo que TIENE que ser distinto:
 *
 *   - no hay conversación ni contacto de verdad, así que nada se guarda en la
 *     bandeja ni cuenta para la facturación;
 *   - `simulacion` corta toda herramienta que deje huella afuera (crear un
 *     pedido, cobrar, emitir un cupón, pedirle permiso al dueño por WhatsApp),
 *     y el corte está en `runTool`, no acá: una herramienta nueva queda
 *     cubierta sin que nadie se acuerde de cubrirla.
 */

/** Cuántos turnos previos se aceptan. Es una prueba, no una conversación. */
const MAX_HISTORIAL = 20;

export type TurnoSimulado = { role: 'user' | 'assistant'; content: string };

export interface RespuestaSimulada {
  reply: string;
  chunks: string[];
  herramientas: unknown;
  usage: { input_tokens: number; output_tokens: number; iterations: number };
  /**
   * Lo que en vivo no sale: un importe que no es un precio autorizado, o algo
   * que el comercio prohibió y la reescritura no pudo sacar. En producción el
   * cliente no recibe nada y la conversación pasa a una persona.
   */
  bloqueo?: { tipo: 'precio_no_autorizado' | 'respuesta_prohibida'; detalle: string };
}

export class SinClaveError extends Error {
  constructor() {
    super('missing_api_key');
    this.name = 'SinClaveError';
  }
}

export async function simularRespuesta(
  admin: ReturnType<typeof supabaseAdmin>,
  a: AiAgent,
  input: {
    message: string;
    historial: TurnoSimulado[];
    simulatedPhone?: string | null;
    simulatedChannel: Channel;
    /**
     * Lo que la automatización dejó en la conversación al entregarla
     * (`conversations.automation_context`): las variables del pedido y lo
     * que fijó `set_context`. Con esto el prompt suma los mismos bloques que
     * producción (recuperación asignada, pedido actual).
     */
    automationContext?: Record<string, unknown> | null;
    /**
     * 'comentario' compone como `composeSuperAgentReply`: las reglas de la
     * primera respuesta a un comentario, las herramientas en modo comentario y
     * el tope de un DM de Instagram. Es lo que después se publica y se manda
     * por privado; sin esto la prueba contestaba con las reglas de otra
     * superficie.
     */
    superficie?: 'comentario';
    /** Lo que producción averigua antes de componer (crítica, producto, hilo). */
    extraBrief?: string | null;
    /** El triaje vio un problema: verifica, contesta y pasa a una persona (`instruccionDeTraspaso`). */
    traspaso?: string | null;
    /** El nombre que el cliente de prueba tiene en su perfil. */
    nombreCliente?: string | null;
  }
): Promise<RespuestaSimulada> {
  a=await loadAgentToolContext(admin,a,input.simulatedChannel);
  const packagingNotice = await loadRevitalyPackagingNotice(admin, a.workspace_id, input.message, a.language);
  if (packagingNotice) {
    return { reply: packagingNotice, chunks: [packagingNotice], herramientas: [],
      usage: { input_tokens: 0, output_tokens: 0, iterations: 0 } };
  }
  const whatsappPolicy = await loadRevitalyWhatsAppPolicy(admin, a.workspace_id, input.simulatedChannel);
  if (whatsappPolicy) {
    const reply = revitalyWhatsAppRedirectText(whatsappPolicy, a.language);
    return { reply, chunks: [reply], herramientas: [], usage: { input_tokens: 0, output_tokens: 0, iterations: 0 } };
  }
  if (isEmailChannel(input.simulatedChannel)) {
    const policy=await loadEmailPolicy(admin,a.workspace_id);
    const disposition=emailDispositionForPolicy(policy,{
      workspaceId:a.workspace_id,channel:input.simulatedChannel,text:input.message,
      alreadyRedirected:input.historial.some(m=>m.role==='assistant'&&m.content.includes('https://wa.me/')),
    });
    if(disposition==='ignore'||disposition==='review') return {
      reply:'',chunks:[],herramientas:[],usage:{input_tokens:0,output_tokens:0,iterations:0},
      bloqueo:{tipo:'respuesta_prohibida',detalle:a.language.startsWith('en')
        ? disposition==='ignore'?'No automatic reply: notification or acknowledgement.':'Team review required; no repeated redirect.'
        : disposition==='ignore'?'Sin respuesta automática: notificación o agradecimiento.':'Requiere revisión del equipo; no se repite la redirección.'},
    };
    const redirect=emailRedirectText(policy,a.language);
    if(redirect)return {reply:redirect,chunks:[redirect],herramientas:[],usage:{input_tokens:0,output_tokens:0,iterations:0}};
  }
  const reglasCrudas = await cargarReglas(admin, a.workspace_id, a.id);
  const discountReply = !input.traspaso && input.superficie !== 'comentario' ? revitalyDiscountReply({
    workspaceId: a.workspace_id, agentId: a.id, channel: input.simulatedChannel,
    language: a.language, inbound: input.message, rules: reglasCrudas,
  }) : null;
  const transferReply = !input.traspaso && input.superficie !== 'comentario' ? revitalyTransferReply({
    workspaceId: a.workspace_id, agentId: a.id, channel: input.simulatedChannel,
    language: a.language, inbound: input.message, rules: reglasCrudas,
  }) : null;
  const shippingReply = input.superficie !== 'comentario' ? revitalyTransferShippingReply({ workspaceId: a.workspace_id,
    agentId: a.id, channel: input.simulatedChannel, language: a.language, inbound: input.message,
    rules: reglasCrudas, history: input.historial }) : null;
  const transferAndShipping = [discountReply, transferReply, shippingReply].filter(Boolean).join('\n\n');
  if (transferAndShipping) {
    const reply = ensureRevitalyIntroduction({ workspaceId: a.workspace_id, channel: input.simulatedChannel,
      language: a.language, text: transferAndShipping, hasPriorReply: input.historial.some(m => m.role === 'assistant') });
    return { reply, chunks: splitReplyForMode(reply, a.response_mode),
      herramientas: [], usage: { input_tokens: 0, output_tokens: 0, iterations: 0 } };
  }
  const resolvedKey = await resolveAnthropicKey(admin, {
    workspaceId: a.workspace_id,
    agentKeyEncrypted: a.api_key_encrypted,
  });
  const apiKey = resolvedKey?.key;
  if (!apiKey) throw new SinClaveError();

  // El mismo enganche de producto que producción: es lo que fija el producto
  // y trae su material de entrenamiento al prompt.
  const automationContext = input.automationContext ?? null;
  const productMatch =
    (await detectInboundProduct(
      admin,
      a.workspace_id,
      [input.message, automationContext?.first_item, automationContext?.order_items]
        .filter(Boolean)
        .join('\n')
    )) ?? (await productoUnicoAsignado(admin, a, a.workspace_id));
  // Igual que producción: para COTIZAR se verifica la página pública en este
  // mismo turno, y sin esa verificación ningún importe sale.
  const priceQuestion = asksForPrice(input.message);
  let priceVerified = !priceQuestion;
  if (asksForCurrentOffer(input.message) && productMatch) {
    priceVerified = (await refreshLivePricing(admin, productMatch.product_id)).ok;
  }
  const [products, businessCurrency, permitidos, topeDescuento, perfilOperativo] =
    await Promise.all([
      loadProductCatalog(admin, a, a.workspace_id, productMatch),
      resolveWorkspaceCurrency(admin, a.workspace_id),
      productosPermitidos(admin, a, a.workspace_id),
      topeDeDescuento(admin, a.workspace_id).catch(() => 0),
      cargarPerfilOperativo(admin, a.workspace_id),
    ]);
  const reglas = reglasATexto(reglasCrudas);

  // Un contacto de mentira, con la forma de uno real. No se guarda en ningún
  // lado: existe para que el prompt tenga a quién nombrar.
  const contacto = {
    id: '',
    workspace_id: a.workspace_id,
    channel: input.simulatedChannel,
    external_id: 'prueba',
    name: input.nombreCliente ?? null,
    phone: input.simulatedPhone?.trim() || null,
    email: null,
  } as unknown as Contact;

  const shopify = await resolveShopifyContextForWorkspace(
    admin,
    a.workspace_id,
    input.simulatedPhone ?? undefined
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

  // De vos o de tú, según el teléfono simulado (o el número del comercio).
  const registro = await resolverRegistro({
    db: admin,
    workspaceId: a.workspace_id,
    idioma: a.language,
    contact: contacto,
  });
  // Un comentario se compone como en `composeSuperAgentReply`: el mismo
  // `buildSystemPrompt` sin perfil ni canal, más las reglas de la primera
  // respuesta a un comentario y lo que producción averiguó antes. Sin los
  // bloques de pedido: esa superficie no los lleva.
  const comentario = input.superficie === 'comentario';
  const knowledgeAgent = await withDocumentKnowledge(admin, a);

  // La misma lista que produccion, resuelta por la pizarra del comercio.
  // `hayContacto` va en true a propósito: lo que hay que previsualizar es lo
  // que el agente PUEDE hacer, y lo que dejaría huella lo corta `runTool`.
  const tools = construirHerramientas({
    agent: a,
    hayContacto: true,
    caseReasonAvailable: true,
    deliveryIssue: isDeliveryIncidentHandoff(automationContext),
    shopify,
    otherStore: otraTienda,
    // Nunca se llama por teléfono a nadie desde una prueba.
    voiceCtx: null,
    topeDescuento: comentario ? 0 : topeDescuento,
    ...(comentario ? { modo: 'comentario' as const } : {}),
  });
  const httpTools = await loadHttpAssistantTools(admin, { workspaceId: a.workspace_id, agentId: a.id,
    channel: input.simulatedChannel, locale: a.language?.startsWith('en') ? 'en' : 'es' });
  tools.push(...httpTools.map(tool => tool.tool));

  let system: string | SystemPorCapas;
  if (comentario) {
    system =
      buildSystemPrompt(
        knowledgeAgent,
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
        registro
      ) + `\n\n## Estás contestando un COMENTARIO\n${SURFACE_RULES}`;
    if (input.extraBrief?.trim()) {
      system += `\n\n${untrustedContext('conversation_brief', input.extraBrief.trim())}`;
    }
    system += revitalyFeedbackBrief(a.workspace_id, input.message);
  } else {
    // Las mismas capas que producción (`systemDelTurno`), con la misma caché.
    const partes = systemDelTurno(
      armarSystemPrompt(
        knowledgeAgent,
        contacto,
        contacto,
        null,
        [],
        { messages: [], rollingSummary: null, idleResetHint: null },
        products,
        productMatch,
        shopify,
        esComentarioPublico(input.simulatedChannel) ? REGLAS_COMENTARIO_PUBLICO : null,
        businessCurrency,
        reglas,
        registro,
        perfilOperativo,
        input.simulatedChannel
      ),
      {
        agent: a,
        recoveryContext: automationContext,
        channel: input.simulatedChannel,
        traspaso: input.traspaso,
        inboundText: input.message,
      }
    );
    // El pedido de la prueba es de ejemplo: en la tienda no existe, y buscarlo
    // terminaba en "no encontré tu pedido", que en vivo nunca pasa porque ahí
    // el pedido es real. Se contesta con lo que trae el contexto.
    if (automationContext?.order_name) {
      partes.turno = [
        partes.turno,
        '## Prueba\nEl pedido de este contexto es de ejemplo y no está en la tienda. No lo busques con herramientas: contesta con los datos del contexto como si la búsqueda los hubiera devuelto.',
      ]
        .filter(Boolean)
        .join('\n\n');
    }
    system = partes;
  }

  const client = getAnthropic(apiKey, {
    db: admin,
    workspaceId: a.workspace_id,
    concepto: 'ia_asistencia',
    detalle: { superficie: 'panel', para: 'simulacion', agente: a.id },
    origenDeLaClave: resolvedKey?.source,
  });
  const maxComentario = Math.min(a.max_response_chars || 500, IG_DM_MAX_CHARS);
  const modeloComentario = a.model || MODELO_POR_DEFECTO;
  const result = await runWithTools(client, {
    ...(comentario
      ? {
          model: modeloComentario,
          max_tokens:
            Math.max(64, Math.min(2048, Math.ceil(maxComentario / 2))) +
            (reguladoPorEsfuerzo(modeloComentario) ? 4000 : 0),
        }
      : {
          model: orderConversationModel({ workspaceId: a.workspace_id, configuredModel: a.model || 'claude-sonnet-5-5', hasOrder: recoveryHasExistingOrder(automationContext), messages: [...input.historial, { content: input.message }] }),
          reasoningEffort: 'high' as const,
          max_tokens: 4000 + Math.max(64, Math.min(2048, Math.ceil((a.max_response_chars || 500) / 2))),
        }),
    system,
    messages: [...input.historial, { role: 'user' as const, content: input.message }],
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
      httpSimulationLocale: a.language?.startsWith('en') ? 'en' : 'es',
    },
  });

  const usage = {
    input_tokens: result.promptTokens,
    output_tokens: result.completionTokens,
    iterations: result.iterations,
  };
  // Probar cuesta lo mismo que contestar: es el agente entero corriendo.
  // Un comentario sale en UN mensaje y con la misma limpieza que producción.
  if (comentario) {
    const limpio = salidaParaCliente(result.text) ?? '';
    const text = limpio.length > maxComentario ? recortarSalida(limpio, maxComentario) : limpio;
    return { reply: text, chunks: text ? [text] : [], herramientas: result.herramientas, usage };
  }

  // Las mismas guardas que en vivo, en el mismo orden. Sin esto la prueba
  // mostraba respuestas que producción frena —un precio que no es de la
  // tienda, algo que el comercio prohibió— y el comercio aprobaba lo que su
  // cliente nunca iba a recibir.
  let text: string;
  try {
    const salida = await guardasDeSalida(admin, a, result.text, {
      billingContext: { superficie: 'panel' },
      products,
      productMatch,
      reglasCrudas,
      inboundText: input.message,
      priceIntegrity: { priceQuestion, priceVerified },
      transferDiscount: shopify?.config?.transfer_discount_amount,
      handoffContext: automationContext?.retention_handoff ? null : automationContext,
    });
    text = ensureRevitalyIntroduction({ workspaceId: a.workspace_id, channel: input.simulatedChannel,
      language: a.language, text: salida.texto, hasPriorReply: input.historial.some(m => m.role === 'assistant') });
  } catch (err) {
    const motivo = err instanceof Error ? err.message : String(err);
    const tipo = motivo.startsWith('price_integrity:')
      ? 'precio_no_autorizado'
      : motivo.startsWith('respuesta_prohibida:')
        ? 'respuesta_prohibida'
        : null;
    if (!tipo) throw err;
    return {
      reply: '',
      chunks: [],
      herramientas: result.herramientas,
      usage,
      bloqueo: { tipo, detalle: motivo.slice(motivo.indexOf(':') + 1).trim() },
    };
  }
  return {
    reply: text,
    chunks: splitReplyForMode(text, a.response_mode),
    // Qué herramientas usó. Es la mitad de lo que un comercio quiere ver al
    // probar: no sólo qué contestó, sino si fue a buscar el dato o se lo
    // inventó.
    herramientas: result.herramientas,
    usage,
  };
}

/** El hilo previo que manda la pantalla, acotado y con la forma que pide la API. */
export function normalizarHistorial(valor: unknown): TurnoSimulado[] {
  if (!Array.isArray(valor)) return [];
  const turnos = valor
    .map((t) => {
      const role = (t as { role?: unknown })?.role;
      const content = (t as { content?: unknown })?.content;
      if (role !== 'user' && role !== 'assistant') return null;
      if (typeof content !== 'string' || !content.trim()) return null;
      return { role, content: content.trim().slice(0, 4000) };
    })
    .filter(Boolean) as TurnoSimulado[];
  // La API exige que el hilo arranque con el usuario.
  while (turnos.length && turnos[0].role !== 'user') turnos.shift();
  return turnos.slice(-MAX_HISTORIAL);
}

export function canalSimulado(value: unknown): Channel {
  return typeof value === 'string' && (CHANNELS as readonly string[]).includes(value)
    ? (value as Channel)
    : 'webchat';
}

function esComentarioPublico(channel: Channel): boolean {
  return channel === 'ig_comment' || channel === 'fb_comment' || channel === 'tiktok_comment';
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
  simulatedPhone: string | undefined
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
