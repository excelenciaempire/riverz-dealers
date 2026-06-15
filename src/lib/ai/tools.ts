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

import type Anthropic from '@anthropic-ai/sdk'
import { lookupCustomerOrders } from '@/lib/shopify/order-lookup'

export const AGENTIC_LOOP_MAX_ITERS = 3

/** Contexto de Shopify resuelto por el caller (runner o test endpoint). */
export interface ShopifyToolContext {
  shopDomain: string
  accessToken: string
  apiVersion: string
  customerPhone?: string
  customerEmail?: string
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
 * Ejecuta una `tool_use` que devuelve Claude. Devuelve el `tool_result`
 * con un payload JSON que el modelo pueda interpretar fácilmente.
 */
export async function runTool(
  toolName: string,
  toolInput: unknown,
  shopify: ShopifyToolContext | null,
): Promise<string> {
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
  },
): Promise<{
  text: string
  promptTokens: number
  completionTokens: number
  iterations: number
}> {
  let messages: Anthropic.MessageParam[] = [...args.messages]
  let promptTokens = 0
  let completionTokens = 0
  let iter = 0

  while (iter < AGENTIC_LOOP_MAX_ITERS) {
    iter += 1
    const response = await client.messages.create({
      model: args.model,
      max_tokens: args.max_tokens,
      system: args.system,
      messages,
      ...(args.tools.length > 0 ? { tools: args.tools } : {}),
    })

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
      return { text, promptTokens, completionTokens, iterations: iter }
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
      const result = await runTool(block.name, block.input, args.shopify)
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
  const final = await client.messages.create({
    model: args.model,
    max_tokens: args.max_tokens,
    system: args.system,
    messages,
  })
  promptTokens += final.usage?.input_tokens ?? 0
  completionTokens += final.usage?.output_tokens ?? 0
  const text = final.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim()
  return { text, promptTokens, completionTokens, iterations: iter + 1 }
}
