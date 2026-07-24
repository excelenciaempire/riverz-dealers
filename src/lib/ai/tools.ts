/**
 * Tool definitions + agentic loop para el asistente IA.
 *
 * Por ahora hay una sola tool: `lookup_order`. Se la pasamos a Claude
 * sólo cuando el workspace tiene una conexión Shopify activa — sin
 * conexión no tiene sentido exponerla porque no podríamos resolver la
 * llamada.
 *
 * El loop agentic es deliberadamente acotado: máximo 3 iteraciones de
 * tool-use. Si el modelo no llega a una respuesta final en 3 turnos,
 * forzamos un texto de fallback. Esto evita loops infinitos en caso de
 * bugs de modelo / herramienta.
 */

import Anthropic from '@anthropic-ai/sdk'
import { lookupCustomerOrders } from '@/lib/shopify/order-lookup'
import {
  createCheckoutLink,
  fmtMoney,
  type CheckoutConfig,
  type PaymentHint,
} from '@/lib/shopify/create-checkout'
import {
  createShopifyOrder,
  type CreateOrderInput,
  type ShippingAddressInput,
} from '@/lib/shopify/create-order'
import { supabaseAdmin } from '@/lib/channels/admin-client'
import { recordOrderAttribution } from '@/lib/instagram-agent/order-attribution'
import { enqueueCall } from '@/lib/voice/queue'

export const AGENTIC_LOOP_MAX_ITERS = 3

/** Context the chat agent needs to escalate a conversation to a phone call. */
export interface VoiceEscalationContext {
  workspaceId: string
  agentId: string
  contactId: string
}

/**
 * Tool: the CHAT agent decides, mid-conversation, to place a phone call when
 * that serves the customer better than text (they ask for it, they're stuck,
 * high-value/urgent). Only exposed when the agent has voice + "AI decides"
 * enabled and the contact has a phone. The call still respects calling hours,
 * opt-out and limits (enqueueCall), so the model can't force an off-hours call.
 */
export const ESCALATE_TO_CALL_TOOL: Anthropic.Tool = {
  name: 'escalate_to_call',
  description:
    'Programá una LLAMADA telefónica de vos (la IA) al cliente cuando convenga más que seguir por texto: el cliente pide que lo llamen, está frustrado, el tema es urgente o de alto valor, o la conversación se estancó. Usala con criterio — la mayoría se resuelve por texto. La llamada respeta el horario permitido y no se hace si el cliente pidió no ser llamado. Pasá un motivo corto.',
  input_schema: {
    type: 'object' as const,
    properties: {
      reason: {
        type: 'string',
        description: 'Por qué conviene llamar (una frase corta).',
      },
    },
    required: ['reason'],
  },
}

/** Contexto de Shopify resuelto por el caller (runner o test endpoint). */
export interface ShopifyToolContext {
  shopDomain: string
  accessToken: string
  apiVersion: string
  customerPhone?: string
  customerEmail?: string
  /** Variant id del producto pinned (detección de producto en el
   *  mensaje del cliente). Lo usa `create_checkout` para armar el
   *  cart-permalink correcto. Opcional — si no hay, la tool cae a
   *  config.default_variant_id. */
  pinnedVariantId?: string | null
  /** Dominio público de la storefront (ej. "pilarargentina.store"),
   *  cacheado por el caller cuando lo conoce. Si null, `create_checkout`
   *  llama a /shop.json para resolverlo. */
  storefrontDomain?: string | null
  /** Config de checkout por-workspace (fila de workspace_checkout_config).
   *  Si null o sin offers, `create_checkout` corre en AUTO MODE. */
  config?: CheckoutConfig | null
  /** Divisa canónica del workspace (ISO 4217) ya resuelta por el runner:
   *  config de checkout → tienda Shopify detectada → catálogo → default.
   *  Se usa como fallback de precios/pedidos en vez de un 'ARS' hardcodeado. */
  currency?: string | null

  // ── Order creation (tool create_order) ──
  /** Si el agente tiene permitido crear pedidos reales (ai_agents
   *  .puede_crear_pedidos). El caller decide exponer la tool según esto. */
  canCreateOrders?: boolean
  /** Identificadores para persistir el pedido en la tabla `orders` de
   *  Riverz tras crearlo en Shopify. */
  workspaceId?: string | null
  agentId?: string | null
  contactId?: string | null
  conversationId?: string | null
  channel?: string | null
  /** Nombre del contacto, prellenado desde la conversación. */
  contactName?: string | null
  /** Modo simulación: el panel de prueba lo activa para que create_order
   *  NO cree un pedido real ni escriba en la base. */
  dryRun?: boolean
}

/** Definición JSON-Schema de la tool `lookup_order` (formato Anthropic). */
export const LOOKUP_ORDER_TOOL: Anthropic.Tool = {
  name: 'lookup_order',
  description:
    'Busca un pedido del cliente en Shopify. Usalo cuando la clienta pregunte por el estado de su pedido, dónde está, cuándo llega, su tracking, o si quiere ver qué compró. Podés buscar por número de pedido (si lo da) o por su teléfono. Devuelve un resumen del pedido con estado de pago, envío, productos y tracking si existe.',
  input_schema: {
    type: 'object' as const,
    properties: {
      order_number: {
        type: 'string',
        description:
          'Número de pedido (ej. "1042" o "#1042"). Opcional — si no lo tenés, igual buscá por el teléfono del cliente.',
      },
      reason: {
        type: 'string',
        description:
          'Por qué llamás esta tool (tracking, estado, devolución, etc.). Una frase corta.',
      },
    },
    required: ['reason'],
  },
}

/**
 * Construye la definición JSON-Schema de la tool `create_checkout`
 * (formato Anthropic) según la config de checkout del workspace.
 *
 * El modelo la llama cuando la clienta ya quiere ir al checkout de
 * Shopify (Shopify maneja dirección, tarjeta, Mercado Pago — no lo
 * pedimos por chat). El cart-permalink que devuelve dispara
 * automáticamente el descuento por bundle (Käching Bundles Cart
 * Function) sin necesidad de código de descuento.
 *
 *   - Si la config tiene `offers` (BUNDLE MODE), el input pide `offer`
 *     (enum con las keys de la config; descripciones armadas con el
 *     label + total de cada oferta). Pilar mantiene su enum de 3 keys.
 *   - Si NO hay offers (AUTO MODE), el input pide `quantity` (las
 *     unidades que quiere la clienta); el precio sale del producto real.
 */
export function buildCheckoutTool(
  config: CheckoutConfig | null,
): Anthropic.Tool {
  const offers = config?.offers ?? null
  const bundleMode = !!(config?.enabled && offers && offers.length > 0)
  const currency = config?.currency || 'ARS'

  const transferAmount =
    typeof config?.transfer_discount_amount === 'number'
      ? config.transfer_discount_amount
      : null
  const transferLabel = config?.transfer_discount_label || 'transferencia'
  const hasTransferDiscount = transferAmount != null && transferAmount > 0

  const payment_hint = {
    type: 'string' as const,
    enum: ['card_or_mp', 'transfer'],
    description: hasTransferDiscount
      ? `Si la clienta dijo que va a pagar por ${transferLabel}, pasá "transfer" para aplicarle el descuento de ${fmtMoney(transferAmount!, currency)}. Para todo lo demás (tarjeta, Mercado Pago) usá "card_or_mp".`
      : 'Método de pago. Para tarjeta o Mercado Pago usá "card_or_mp".',
  }

  if (bundleMode) {
    const enumeration = (offers ?? [])
      .map((o) => `${o.key} = ${o.label} (${fmtMoney(o.total, currency)})`)
      .join('. ')
    return {
      name: 'create_checkout',
      description: hasTransferDiscount
        ? `Generá el link de checkout de Shopify para la clienta cuando ya eligió una oferta. Le pasás la oferta y opcionalmente que va a pagar por ${transferLabel} para aplicarle el descuento de ${fmtMoney(transferAmount!, currency)}. Devolvés el link listo para que la clienta haga click y termine el pago en Shopify (que ya maneja tarjeta + Mercado Pago).`
        : 'Generá el link de checkout de Shopify para la clienta cuando ya eligió una oferta. Le pasás la oferta. Devolvés el link listo para que la clienta haga click y termine el pago en Shopify.',
      input_schema: {
        type: 'object' as const,
        properties: {
          offer: {
            type: 'string',
            enum: (offers ?? []).map((o) => o.key),
            description: `Oferta que eligió la clienta. ${enumeration}.`,
          },
          payment_hint,
        },
        required: ['offer'],
      },
    }
  }

  // AUTO MODE
  return {
    name: 'create_checkout',
    description:
      'Generá el link de checkout de Shopify para la clienta cuando ya quiere comprar. Pasá la cantidad de unidades que quiere. Devolvés el link listo para que la clienta haga click y termine el pago en Shopify. Cotizá sólo el precio real del producto; no inventes descuentos ni cupones.',
    input_schema: {
      type: 'object' as const,
      properties: {
        quantity: {
          type: 'integer',
          minimum: 1,
          default: 1,
          description:
            'Cantidad de unidades que quiere la clienta. Por defecto 1.',
        },
        payment_hint,
      },
      required: [],
    },
  }
}

/**
 * Tool por defecto (AUTO MODE, sin config) para callers que importan el
 * símbolo estático. El runner usa `buildCheckoutTool(config)` con la
 * config del workspace.
 */
export const CREATE_CHECKOUT_TOOL: Anthropic.Tool = buildCheckoutTool(null)

/**
 * Construye la tool `create_order` (formato Anthropic). Crea un PEDIDO
 * REAL en Shopify — sólo se expone cuando el agente tiene
 * `puede_crear_pedidos` activo. La forma (offer vs quantity) sigue la
 * misma config de checkout que el resto del flujo.
 *
 * El campo `confirmed` es un forcing-function: el modelo sólo debe
 * mandarlo en true cuando la clienta confirmó EXPLÍCITAMENTE el pedido
 * final (producto, cantidad, total y, si aplica, dirección). La tool
 * rechaza la creación si llega en false.
 */
export function buildOrderTool(config: CheckoutConfig | null): Anthropic.Tool {
  const offers = config?.offers ?? null
  const bundleMode = !!(config?.enabled && offers && offers.length > 0)
  const currency = config?.currency || 'ARS'

  const transferAmount =
    typeof config?.transfer_discount_amount === 'number'
      ? config.transfer_discount_amount
      : null
  const transferLabel = config?.transfer_discount_label || 'transferencia'
  const hasTransferDiscount = transferAmount != null && transferAmount > 0

  const properties: Record<string, unknown> = {
    customer_name: {
      type: 'string',
      description:
        'Nombre y apellido del cliente para el pedido. Pedilo si no lo sabés.',
    },
    customer_phone: {
      type: 'string',
      description:
        'Teléfono del cliente. Opcional — si no lo pasás se usa el del chat.',
    },
    customer_email: {
      type: 'string',
      description: 'Correo del cliente (opcional, recomendado si lo tenés).',
    },
    shipping_address: {
      type: 'object',
      description:
        'Dirección de envío. Pedila para productos físicos antes de crear el pedido.',
      properties: {
        address1: { type: 'string', description: 'Calle y número.' },
        address2: { type: 'string', description: 'Piso/depto (opcional).' },
        city: { type: 'string', description: 'Ciudad/localidad.' },
        province: { type: 'string', description: 'Provincia/estado.' },
        zip: { type: 'string', description: 'Código postal.' },
        country: { type: 'string', description: 'País.' },
      },
    },
    payment_hint: {
      type: 'string',
      enum: ['card_or_mp', 'transfer'],
      description: hasTransferDiscount
        ? `Cómo va a pagar. "transfer" si paga por ${transferLabel} (crédito de ${fmtMoney(transferAmount!, currency)} al confirmar); "card_or_mp" para tarjeta/Mercado Pago.`
        : 'Cómo va a pagar: "card_or_mp" para tarjeta/Mercado Pago, "transfer" para transferencia.',
    },
    note: {
      type: 'string',
      description:
        'Nota interna para el equipo (opcional): aclaraciones del cliente, referencias, etc.',
    },
    confirmed: {
      type: 'boolean',
      description:
        'true SOLO si la clienta confirmó explícitamente el pedido final (producto, cantidad, total y dirección si aplica). Si todavía no confirmó, NO llames esta tool.',
    },
  }

  const required: string[] = ['customer_name', 'confirmed']

  if (bundleMode) {
    const enumeration = (offers ?? [])
      .map((o) => `${o.key} = ${o.label} (${fmtMoney(o.total, currency)})`)
      .join('. ')
    properties.offer = {
      type: 'string',
      enum: (offers ?? []).map((o) => o.key),
      description: `Oferta que eligió la clienta. ${enumeration}.`,
    }
    required.push('offer')
  } else {
    properties.quantity = {
      type: 'integer',
      minimum: 1,
      default: 1,
      description: 'Cantidad de unidades. Por defecto 1.',
    }
  }

  return {
    name: 'create_order',
    description:
      'Crea el PEDIDO REAL en Shopify cuando la clienta YA confirmó qué quiere comprar. Antes de llamarla: reuní el producto/cantidad, el nombre, los datos de envío si es producto físico y el método de pago; mostrale el resumen y el total, y esperá su confirmación explícita. Llamala una sola vez, con confirmed=true. Devuelve el número de pedido para que se lo pases a la clienta. Si todavía falta info o no confirmó, NO la llames: seguí preguntando.',
    input_schema: {
      type: 'object' as const,
      properties: properties as Anthropic.Tool.InputSchema['properties'],
      required,
    },
  }
}

/**
 * Ejecuta una `tool_use` que devuelve Claude. Devuelve el `tool_result`
 * con un payload JSON que el modelo pueda interpretar fácilmente.
 */
export async function runTool(
  toolName: string,
  toolInput: unknown,
  shopify: ShopifyToolContext | null,
  voice: VoiceEscalationContext | null = null,
): Promise<string> {
  if (toolName === 'escalate_to_call') {
    if (!voice) {
      return JSON.stringify({
        error: 'voice_not_available',
        message: 'No podés programar llamadas en este agente. Seguí ayudando por texto.',
      })
    }
    const input = (toolInput ?? {}) as { reason?: string }
    // Dedupe: una sola llamada por IA en la última hora para este contacto,
    // así el modelo no encola varias si insiste.
    const db = supabaseAdmin()
    const since = new Date(Date.now() - 60 * 60_000).toISOString()
    const { count } = await db
      .from('voice_calls')
      .select('id', { count: 'exact', head: true })
      .eq('contact_id', voice.contactId)
      .eq('call_type', 'followup')
      .gte('created_at', since)
    if ((count ?? 0) > 0) {
      return JSON.stringify({
        scheduled: false,
        message: 'Ya hay una llamada programada hace poco. Seguí ayudando por texto.',
      })
    }
    const res = await enqueueCall({
      workspaceId: voice.workspaceId,
      agentId: voice.agentId,
      contactId: voice.contactId,
      callType: 'followup',
      context: { reason: input.reason ?? '', escalated_by_ai: true },
    })
    if (!res.enqueued) {
      return JSON.stringify({
        scheduled: false,
        reason: res.reason,
        message:
          'No se pudo programar la llamada ahora (horario, opt-out o límite). Seguí ayudando por texto.',
      })
    }
    return JSON.stringify({
      scheduled: true,
      message:
        'Llamada programada. Avisale al cliente con naturalidad que lo vas a llamar en breve.',
    })
  }
  if (toolName === 'lookup_order') {
    if (!shopify) {
      return JSON.stringify({
        error: 'no_shopify_connection',
        message: 'El workspace no tiene Shopify conectado.',
      })
    }
    const input = (toolInput ?? {}) as {
      order_number?: string
      reason?: string
    }
    const result = await lookupCustomerOrders({
      shopDomain: shopify.shopDomain,
      accessToken: shopify.accessToken,
      apiVersion: shopify.apiVersion,
      customerPhone: shopify.customerPhone,
      customerEmail: shopify.customerEmail,
      orderNumber: input.order_number,
    })
    if (!result.found) {
      // Travel the explicit "don't invent" instruction with the empty
      // result so the model never paraphrases "found:false" into
      // "tu pedido está en proceso". Local to the failure case so it
      // doesn't grow the system prompt on every turn.
      return JSON.stringify({
        found: false,
        orders: [],
        instruction:
          'No se encontró ningún pedido con esos datos. NO inventes información del pedido (estado, tracking, fecha de envío). Decile al cliente que no lo encontraste y pedile el número de pedido (ej. #1042) o que confirme el teléfono/correo con el que compró.',
      })
    }
    return JSON.stringify(result)
  }
  if (toolName === 'create_checkout') {
    if (!shopify) {
      return JSON.stringify({
        error: 'no_shopify_connection',
        message: 'El workspace no tiene Shopify conectado.',
      })
    }
    const input = (toolInput ?? {}) as {
      offer?: string
      quantity?: number
      payment_hint?: PaymentHint
    }
    const config = shopify.config ?? null
    const bundleMode = !!(
      config?.enabled &&
      config.offers &&
      config.offers.length > 0
    )
    if (bundleMode && !input.offer) {
      const valid = (config?.offers ?? []).map((o) => o.key).join(' | ')
      return JSON.stringify({
        error: 'missing_offer',
        message: `Pasá la oferta (${valid}).`,
      })
    }
    const result = await createCheckoutLink(
      {
        offer: input.offer,
        quantity: input.quantity,
        payment_hint: input.payment_hint,
      },
      {
        shopDomain: shopify.shopDomain,
        accessToken: shopify.accessToken,
        apiVersion: shopify.apiVersion,
        pinnedVariantId: shopify.pinnedVariantId ?? null,
        storefrontDomain: shopify.storefrontDomain ?? null,
        config,
        currency: shopify.currency ?? null,
      },
    )
    // Registrar "pago pendiente" en la conversación: hace al asistente
    // consciente de que mandó el link y habilita el follow-up de
    // recuperación si el cliente no paga. Fail-soft. No en dry-run.
    if (
      !shopify.dryRun &&
      shopify.conversationId &&
      !('error' in result) &&
      result.checkout_url
    ) {
      try {
        await supabaseAdmin()
          .from('conversations')
          .update({
            pending_checkout_at: new Date().toISOString(),
            pending_checkout_url: result.checkout_url,
          })
          .eq('id', shopify.conversationId)
      } catch (err) {
        console.error('[ai] no pude marcar pending_checkout:', err)
      }
    }
    return JSON.stringify(result)
  }
  if (toolName === 'create_order') {
    if (!shopify) {
      return JSON.stringify({
        error: 'no_shopify_connection',
        message: 'El workspace no tiene Shopify conectado.',
      })
    }
    if (!shopify.canCreateOrders) {
      return JSON.stringify({
        error: 'orders_disabled',
        message:
          'Este asistente no tiene habilitado crear pedidos. No prometas el pedido; ofrecé pasar la conversación a una persona del equipo.',
      })
    }
    const input = (toolInput ?? {}) as {
      offer?: string
      quantity?: number
      payment_hint?: PaymentHint
      customer_name?: string
      customer_phone?: string
      customer_email?: string
      shipping_address?: ShippingAddressInput
      note?: string
      confirmed?: boolean
    }
    // En modo simulación (panel de prueba) NO exigimos confirmed para que
    // el tester pueda ver el comportamiento del modelo; en producción
    // (dryRun=false) el gate sí aplica.
    if (input.confirmed !== true && !shopify.dryRun) {
      return JSON.stringify({
        error: 'not_confirmed',
        message:
          'No crees el pedido hasta que la clienta confirme explícitamente. Mostrale el resumen (producto, cantidad, total y dirección si aplica) y pedile que confirme; recién ahí llamá create_order con confirmed=true.',
      })
    }
    const config = shopify.config ?? null
    const orderInput: CreateOrderInput = {
      offer: input.offer,
      quantity: input.quantity,
      payment_hint: input.payment_hint,
      customer_name: input.customer_name,
      customer_phone: input.customer_phone,
      customer_email: input.customer_email,
      shipping_address: input.shipping_address,
      note: input.note,
    }

    // Modo simulación (panel de prueba): no creamos pedido real ni
    // escribimos en la base — devolvemos un eco para que el tester vea
    // que el modelo habría cerrado el pedido.
    if (shopify.dryRun) {
      return JSON.stringify({
        dry_run: true,
        message:
          '(Simulación) En producción crearía el pedido real en Shopify con estos datos. No se creó nada.',
        echo: orderInput,
      })
    }

    const result = await createShopifyOrder(orderInput, {
      shopDomain: shopify.shopDomain,
      accessToken: shopify.accessToken,
      apiVersion: shopify.apiVersion,
      pinnedVariantId: shopify.pinnedVariantId ?? null,
      customerPhone: shopify.customerPhone ?? null,
      customerEmail: shopify.customerEmail ?? null,
      config,
      currency: shopify.currency ?? null,
    })
    if ('error' in result) {
      return JSON.stringify(result)
    }

    // Espejo en Riverz (tabla orders). Fail-soft: si la persistencia
    // falla, el pedido YA existe en Shopify, así que NO le decimos a la
    // clienta que falló — sólo lo logueamos.
    if (shopify.workspaceId) {
      try {
        await supabaseAdmin()
          .from('orders')
          .insert({
            workspace_id: shopify.workspaceId,
            contact_id: shopify.contactId ?? null,
            agent_id: shopify.agentId ?? null,
            conversation_id: shopify.conversationId ?? null,
            channel: shopify.channel ?? null,
            shop_domain: shopify.shopDomain,
            shopify_order_id: result.shopify_order_id,
            order_number: result.order_number,
            order_status_url: result.order_status_url,
            currency: result.currency,
            total_price: result.total_price,
            line_items: result.line_items,
            customer_name: result.customer_name,
            customer_phone: result.customer_phone,
            customer_email: result.customer_email,
            shipping_address: result.shipping_address,
            payment_method: result.payment_method,
            financial_status: 'pending',
            status: 'created',
            created_by: 'ai',
            note: input.note ?? null,
          })
      } catch (err) {
        console.error('[ai] order created in Shopify but Riverz insert failed:', err)
      }
      // Attribute to the Instagram engine when the order came from an IG
      // conversation → the unified order-attribution ledger (source 'agent').
      if (shopify.channel === 'instagram' || shopify.channel === 'ig_comment') {
        await recordOrderAttribution(supabaseAdmin(), {
          workspaceId: shopify.workspaceId,
          shopifyOrderId: result.shopify_order_id,
          orderName: result.order_number,
          source: 'agent',
          contactId: shopify.contactId ?? null,
          channel: shopify.channel,
          revenue: result.total_price,
          currency: result.currency,
        })
      }
    }

    return JSON.stringify(result)
  }
  return JSON.stringify({
    error: 'unknown_tool',
    message: `Tool '${toolName}' no implementada.`,
  })
}

/**
 * Driver del agentic loop. Recibe un cliente Anthropic ya configurado
 * y los parámetros del primer `messages.create`, ejecuta tools si el
 * modelo las invoca, y devuelve el texto final + uso de tokens
 * acumulado.
 *
 * El caller controla `tools` — si pasa [] desactiva tool-use entero,
 * que es lo que hacemos cuando no hay Shopify conectado.
 */
export async function runWithTools(
  client: Anthropic,
  args: {
    model: string
    max_tokens: number
    system: string
    messages: Anthropic.MessageParam[]
    tools: Anthropic.Tool[]
    shopify: ShopifyToolContext | null
    /** Present → the escalate_to_call tool can place a phone call. */
    voice?: VoiceEscalationContext | null
  },
): Promise<{
  text: string
  promptTokens: number
  completionTokens: number
  iterations: number
  /** True if we exhausted AGENTIC_LOOP_MAX_ITERS still asking for tools
   *  and had to force a final no-tools call. The caller may want to
   *  swap in a fallback message if the model returned empty text. */
  truncated: boolean
}> {
  let messages: Anthropic.MessageParam[] = [...args.messages]
  let promptTokens = 0
  let completionTokens = 0
  let iter = 0

  while (iter < AGENTIC_LOOP_MAX_ITERS) {
    iter += 1
    let response: Anthropic.Message
    try {
      response = await client.messages.create({
        model: args.model,
        max_tokens: args.max_tokens,
        system: args.system,
        messages,
        ...(args.tools.length > 0 ? { tools: args.tools } : {}),
      })
    } catch (err) {
      // On the FIRST iteration only, retry once after rewriting any
      // document blocks in the last user message to text. Anthropic
      // rejects PDFs exceeding the document block's page/size caps
      // with a 400; without this rescue, the customer sees nothing.
      const isFirstIter = iter === 1
      const isApiError =
        err instanceof Anthropic.APIError && err.status === 400
      const msg = err instanceof Error ? err.message : String(err)
      const looksLikePdfReject =
        /document|page|too large|exceeds|invalid.*pdf/i.test(msg)
      if (isFirstIter && isApiError && looksLikePdfReject) {
        messages = rewriteLastUserDocumentToText(messages)
        response = await client.messages.create({
          model: args.model,
          max_tokens: args.max_tokens,
          system: args.system,
          messages,
          ...(args.tools.length > 0 ? { tools: args.tools } : {}),
        })
      } else {
        throw err
      }
    }

    promptTokens += response.usage?.input_tokens ?? 0
    completionTokens += response.usage?.output_tokens ?? 0

    if (response.stop_reason !== 'tool_use') {
      const text = response.content
        .filter(
          (b): b is Anthropic.TextBlock => b.type === 'text',
        )
        .map((b) => b.text)
        .join('')
        .trim()
      return {
        text,
        promptTokens,
        completionTokens,
        iterations: iter,
        truncated: false,
      }
    }

    // El modelo pidió ejecutar una o más tools. Le devolvemos el
    // historial completo (assistant con los content blocks tal cual)
    // + un user-turn con los tool_result respectivos, y volvemos al
    // top del loop.
    messages = [
      ...messages,
      { role: 'assistant', content: response.content },
    ]
    const toolResults: Anthropic.ToolResultBlockParam[] = []
    for (const block of response.content) {
      if (block.type !== 'tool_use') continue
      const result = await runTool(block.name, block.input, args.shopify, args.voice ?? null)
      toolResults.push({
        type: 'tool_result',
        tool_use_id: block.id,
        content: result,
      })
    }
    messages = [...messages, { role: 'user', content: toolResults }]
  }

  // Si después de AGENTIC_LOOP_MAX_ITERS el modelo sigue pidiendo
  // tools, hacemos una llamada final SIN tools para forzar un texto.
  let final: Anthropic.Message
  try {
    final = await client.messages.create({
      model: args.model,
      max_tokens: args.max_tokens,
      system: args.system,
      messages,
    })
  } catch {
    // Si la llamada final falla (timeout/overloaded/etc.), no lanzamos:
    // devolvemos texto vacío + truncated para que el runner dispare su
    // fallback existente en vez de explotar.
    return {
      text: '',
      promptTokens,
      completionTokens,
      iterations: iter + 1,
      truncated: true,
    }
  }
  promptTokens += final.usage?.input_tokens ?? 0
  completionTokens += final.usage?.output_tokens ?? 0
  const text = final.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim()
  return {
    text,
    promptTokens,
    completionTokens,
    iterations: iter + 1,
    truncated: true,
  }
}

/**
 * Walk the message history backwards to the last user turn and rewrite
 * any `type: 'document'` blocks into a text block apologizing for the
 * unprocessable PDF. Used to rescue a single Anthropic 400 caused by a
 * PDF that exceeds the document-block limits — without this, the
 * customer sees an empty reply because the outer catch logs failed.
 */
function rewriteLastUserDocumentToText(
  messages: Anthropic.MessageParam[],
): Anthropic.MessageParam[] {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (m.role !== 'user') continue
    if (typeof m.content === 'string') return messages
    const content = m.content as Anthropic.ContentBlockParam[]
    let touched = false
    const rewritten: Anthropic.ContentBlockParam[] = content.map((b) => {
      if (b.type === 'document') {
        touched = true
        return {
          type: 'text',
          text: '[el cliente envió un PDF que no pude procesar — pedile amablemente que mande solo las páginas relevantes o un resumen]',
        }
      }
      return b
    })
    if (!touched) return messages
    const next = [...messages]
    next[i] = { role: 'user', content: rewritten }
    return next
  }
  return messages
}
