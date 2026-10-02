import { traceTool } from '@/lib/observability/latitude';
import { DEALER_SYSTEM, dealerToolset, isDealerTool, runDealerTool } from '@/lib/dealers/agent-tools';
import { isDealerDeployment } from '@/lib/dealers/config';
import { secureSystemPrompt, toolCallAllowed } from './input-security'
import { toolPermissionKey } from './toolbox'
import { redactModelSecrets } from '@/lib/security/model-secrets'
import { observeTool,publicToolStatus } from './turn-evidence'
import { isHttpAssistantTool, runHttpAssistantTool, type HttpAssistantToolRuntime } from './http-actions'
import { classifyCaseReason,type CaseReasonRuntime } from './case-reason-tool'

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

import { filtroDeNumero } from '@/lib/orders/numero'
import { esfuerzo } from './esfuerzo'
import { armarLinkDeCompra } from '@/lib/commerce/create-checkout'
import Anthropic from '@anthropic-ai/sdk'
import type { SupabaseClient } from '@supabase/supabase-js'
import { lookupCustomerOrders } from '@/lib/shopify/order-lookup'
import { resolveCarrierTrackingUrl } from '@/lib/shopify/carrier-tracking'
import { dropiContextForModel } from '@/lib/logistics/dropi-order-evidence'
import { DEUNA_DROPI_WORKSPACE } from '@/lib/logistics/dropi-release-policy'
import { claveDeTelefono } from '@/lib/whatsapp/phone-utils'
import { resolveStoreForLookup, lookupOrderNonShopify } from '@/lib/commerce/order-lookup'
import { informarPago } from '@/lib/payments/reported-payment'
import { createCheckoutLink, fmtMoney, type CheckoutConfig, type PaymentHint } from '@/lib/shopify/create-checkout'
import { type CreateOrderInput, type ShippingAddressInput } from '@/lib/shopify/create-order'
import { crearPedidoConEspejo } from '@/lib/orders/crear'
import { supabaseAdmin } from '@/lib/channels/admin-client'
import { enqueueCall } from '@/lib/voice/queue'
import {
  addUnitsToFirstLineItem,
  replaceUnfulfilledOrderItems,
} from '@/lib/shopify/order-edit'
import { searchProducts } from '@/lib/products/search'
import type { ProductHit } from '@/lib/products/search'
import { proponerCancelacion, proponerReembolso } from './postventa'
import { crearLinkDePago } from '@/lib/mercadopago/preference'
import { emitirCupon } from '@/lib/shopify/discounts'
import { crearPedidoLocalConEspejo } from '@/lib/orders/crear'
import { abrirDevolucion, type AbrirDevolucionInput } from '@/lib/returns/open'
import { registrarHueco } from './answer-gaps'
import { cerrarConversacion, etiquetarContacto, verContacto, verProducto } from './bandeja'
import { gestionarRecompra } from './recompras'
import { aplicarDesenlace } from './desenlace'
import { validateWorkspaceShippingAddress } from '@/lib/addresses/google-validation'

/**
 * Cuántas veces puede pedir herramientas antes de tener que contestar.
 *
 * Eran 3, que alcanzaban cuando había una sola herramienta por respuesta.
 * Con el juego completo, un pedido normal encadena varias — buscar el producto,
 * mirar el pedido anterior, armar el carrito— y a la cuarta se quedaba sin
 * vueltas y contestaba a medias. Seis cubre esas cadenas y sigue siendo un
 * techo: es un cortafuegos contra un bucle, no un presupuesto a gastar.
 */
export const AGENTIC_LOOP_MAX_ITERS = 6

/**
 * Cuántas pausas de servidor se toleran, aparte de las vueltas.
 *
 * Cuatro: la búsqueda web admite hasta tres por respuesta y cada una puede
 * pausar, más una de aire. Pasado eso se corta igual que antes — un bucle de
 * pausas sin freno es una llamada que no termina nunca.
 */
export const MAX_PAUSAS = 4

/** Context the chat agent needs to escalate a conversation to a phone call. */
export interface VoiceEscalationContext {
  workspaceId: string
  agentId: string
  contactId: string
  assistantId: string
  conversationId: string
  language?: string | null
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
    'Programa una LLAMADA telefónica de ti (la IA) al cliente ÚNICAMENTE después de que el cliente la haya pedido o haya aceptado explícitamente tu propuesta de llamarlo. Si parece útil llamar, primero ofrécelo por chat y espera una respuesta afirmativa. NUNCA uses esta herramienta por frustración, urgencia, valor o conversación estancada sin ese consentimiento. La llamada respeta el horario permitido y no se hace si el cliente pidió no ser llamado. Pasa un motivo corto.',
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

/** Edita un pedido únicamente después de confirmar las unidades y variantes. */
export const UPDATE_ORDER_TOOL: Anthropic.Tool = {
  name: 'update_order',
  description:
    'Actualiza el pedido real en Shopify después de que el cliente confirmó exactamente qué recibirá. Para corregir una oferta o variantes usa items con los variant_id reales, quantity, free y confirmed=true; esto reemplaza todas las unidades pendientes. Para un upsell simple durante una llamada puedes usar add_units. Llámala una sola vez y nunca antes de la confirmación explícita.',
  input_schema: {
    type: 'object' as const,
    properties: {
      add_units: {
        type: 'integer',
        minimum: 1,
        description: 'Cuántas unidades extra sumar al pedido.',
      },
      items: {
        type: 'array',
        minItems: 1,
        maxItems: 20,
        description:
          'Lista final y completa de variantes confirmadas. Reemplaza las unidades aún no despachadas del pedido.',
        items: {
          type: 'object',
          properties: {
            variant_id: {
              type: 'string',
              description: 'ID real de la variante de Shopify devuelto por el catálogo.',
            },
            quantity: { type: 'integer', minimum: 1, maximum: 20 },
            free: {
              type: 'boolean',
              description: 'True sólo si esta unidad está cubierta gratis por una oferta vigente.',
            },
          },
          required: ['variant_id', 'quantity'],
        },
      },
      confirmed: {
        type: 'boolean',
        description:
          'Debe ser true para reemplazar variantes: confirma que el cliente aceptó esta lista exacta.',
      },
      order_number: {
        type: 'string',
        description:
          'Número del pedido a editar. En una llamada no hace falta (ya se sabe cuál es); por chat sí, y si la clienta no lo dio, preguntáselo antes de llamar esta tool.',
      },
      reason: {
        type: 'string',
        description: 'Nota corta del upsell (opcional).',
      },
    },
    required: [],
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
  /**
   * Chat web: el id que identifica al visitante en su navegador. Se estampa en
   * el enlace de carrito para que el pedido resultante quede atado a ESTA
   * conversación (ver `attributeWebchatOrder`). Vacío en el resto de canales,
   * donde el cliente ya se identifica por teléfono o correo.
   */
  visitorId?: string | null
  /** Id del pedido Shopify (numérico) para editar en vivo durante una llamada
   *  de confirmación COD (tool `update_order` / upsell). Lo setea el bridge de
   *  voz desde el contexto de la llamada. */
  orderId?: string | null
  /** Modo simulación: el panel de prueba lo activa para que create_order
   *  NO cree un pedido real ni escriba en la base. */
  dryRun?: boolean
}

/**
 * Buscar en el catálogo.
 *
 * El agente ve en su prompt sólo una parte del catálogo. Con esta tool deja de
 * depender de esa lista: puede contestar por un producto que no está ahí, y
 * sobre todo puede recomendar a partir de lo que la clienta describe cuando no
 * sabe cómo se llama lo que busca.
 */
export const BUSCAR_PRODUCTO_TOOL: Anthropic.Tool = {
  name: 'buscar_producto',
  description:
    'Busca productos en el catálogo del negocio. Úsala SIEMPRE que la clienta pregunte por algo que no ves en el catálogo de tu contexto, o cuando describa lo que necesita sin nombrar un producto ("algo para piel sensible", "un regalo para mi mamá", "el más barato"). Puedes buscar por nombre, por lo que hace el producto o por categoría. Devuelve nombre, precio, foto y link. No inventes productos: si la búsqueda no trae nada, di que no lo tienes.',
  input_schema: {
    type: 'object' as const,
    properties: {
      query: {
        type: 'string',
        description:
          'Qué buscar. Puede ser el nombre, una característica o para qué sirve. Escribilo como lo diría la clienta.',
      },
      limit: {
        type: 'integer',
        minimum: 1,
        maximum: 10,
        description: 'Cuántos traer (por defecto 6). Pide pocos: es un chat, no un listado.',
      },
      include_images: {
        type: 'boolean',
        description:
          'Usa true cuando el cliente necesita escoger o comparar colores/modelos visuales. El sistema enviará una sola imagen con las opciones reales disponibles; no las describas únicamente por texto.',
      },
    },
    required: ['query'],
  },
}

/**
 * Cancelar y reembolsar. Las dos PROPONEN: mueven dinero y no se deshacen, así
 * que la ejecuta una persona del negocio desde el aviso de WhatsApp.
 *
 * La descripción se lo dice explícitamente al modelo, porque el error caro acá
 * no es no hacerlo: es decirle a la clienta que ya está resuelto.
 */
export const CANCELAR_PEDIDO_TOOL: Anthropic.Tool = {
  name: 'cancelar_pedido',
  description:
    'Pide la cancelación de un pedido cuando la clienta la solicita. NO cancela al instante: deja la solicitud armada y una persona del negocio la aprueba en minutos. Cuéntale que ya la pasaste y que le confirmas; NUNCA le digas que el pedido ya está cancelado ni que le devolvieron el dinero. Si no sabes de qué pedido habla, pregúntale el número antes de llamar esta tool.',
  input_schema: {
    type: 'object' as const,
    properties: {
      order_number: {
        type: 'string',
        description: 'Número de pedido. Omitilo sólo si la persona tiene un único pedido activo.',
      },
      reason: {
        type: 'string',
        description: 'Por qué lo quiere cancelar, en las palabras de la clienta.',
      },
    },
    required: [],
  },
}

export const REEMBOLSAR_TOOL: Anthropic.Tool = {
  name: 'reembolsar',
  description:
    'Pide la devolución del dinero de un pedido SIN cancelarlo: llegó incompleto, llegó dañado, o se acordó una bonificación. NO reembolsa al instante: una persona del negocio lo aprueba. Cuéntale que ya lo pasaste; NUNCA le digas que el dinero ya fue devuelto ni prometas una fecha. Si la clienta quiere cancelar la compra entera, usa cancelar_pedido en vez de esta.',
  input_schema: {
    type: 'object' as const,
    properties: {
      order_number: { type: 'string', description: 'Número de pedido.' },
      amount: {
        type: 'number',
        description: 'Cuánto devolver. Omitilo para devolver todo lo cobrado.',
      },
      reason: {
        type: 'string',
        description: 'Qué pasó, en las palabras de la clienta.',
      },
    },
    required: [],
  },
}

export const ABRIR_DEVOLUCION_TOOL: Anthropic.Tool = {
  name: 'abrir_devolucion',
  description:
    'Registra una devolución o un cambio cuando la clienta dice que el producto llegó mal, no era lo que esperaba o quiere otro. NO devuelve dinero ni cancela: deja el caso anotado con el pedido, el motivo y las fotos que ella ya mandó, y el equipo lo revisa. Si además pide que le devuelvan la plata, usa reembolsar. Cuéntale que quedó registrada; NUNCA le digas que está aprobada ni le prometas una fecha.',
  input_schema: {
    type: 'object' as const,
    properties: {
      order_number: { type: 'string', description: 'Número de pedido.' },
      kind: {
        type: 'string',
        enum: ['devolucion', 'cambio'],
        description: 'Qué quiere: devolver el producto o cambiarlo por otro.',
      },
      reason: {
        type: 'string',
        description: 'El motivo, resumido en pocas palabras.',
      },
      customer_note: {
        type: 'string',
        description: 'Lo que la clienta escribió, tal cual, sin resumir.',
      },
    },
    required: [],
  },
}

export const VER_CONTACTO_TOOL: Anthropic.Tool = {
  name: 'ver_contacto',
  description:
    'La ficha de la persona con la que estás hablando: qué compró antes, cuánto gastó, de dónde es y con qué etiquetas está. Úsala para personalizar la respuesta. No recites los datos: nadie quiere que le lean su propia ficha.',
  input_schema: { type: 'object' as const, properties: {}, required: [] },
}

export const GESTIONAR_RECOMPRA_TOOL: Anthropic.Tool = {
  name: 'gestionar_recompra',
  description: 'Gestiona únicamente el seguimiento de recompra pausado de esta conversación. Cancela si la persona no quiere más recordatorios. Reprograma el siguiente contacto del recorrido existente solo cuando la persona acuerda explícitamente cuántos días esperar; no cambia la oferta ni crea pedidos. Ante dudas o incidencias, atiende primero y deja el seguimiento pausado. Nunca afirmes haber reprogramado o cancelado si la herramienta falla.',
  input_schema: { type: 'object', properties: { accion: { type: 'string', enum: ['cancelar', 'reprogramar'] }, dias: { type: 'integer', minimum: 1, maximum: 365 }, confirmado: { type: 'boolean' } }, required: ['accion'] },
}

export const ETIQUETAR_CONTACTO_TOOL: Anthropic.Tool = {
  name: 'etiquetar_contacto',
  description:
    'Ponle (o sácale) una etiqueta a la persona con la que estás hablando, para que el equipo la encuentre después: "quiere-talle-M", "espera-reposición", "mayorista". Es una nota interna: no se la menciones en la conversación.',
  input_schema: {
    type: 'object' as const,
    properties: {
      etiqueta: {
        type: 'string',
        description: 'Nombre corto, en minúsculas y con guiones.',
      },
      quitar: {
        type: 'boolean',
        description: 'true para sacarla en vez de ponerla.',
      },
    },
    required: ['etiqueta'],
  },
}

export const CERRAR_CONVERSACION_TOOL: Anthropic.Tool = {
  name: 'cerrar_conversacion',
  description:
    'Cierra el caso cuando la consulta quedó resuelta y no hay nada pendiente. Despídete normalmente; no anuncies que "cerraste la conversación", que para la clienta no significa nada. Si quedó algo esperando a una persona del equipo, NO la cierres.',
  input_schema: {
    type: 'object' as const,
    properties: {
      motivo: { type: 'string', description: 'En qué quedó, en una línea.' },
    },
    required: [],
  },
}

export const NO_SE_TOOL: Anthropic.Tool = {
  name: 'no_se_la_respuesta',
  description:
    'Llámala cuando te preguntan algo que NO puedes contestar con lo que sabes del negocio: un dato que no está en tu conocimiento ni en el catálogo, una política que nadie te cargó. Anota la pregunta para que el equipo la responda y le pasa la conversación a una persona. Úsala ANTES de improvisar: una respuesta aproximada sobre envíos, garantías o plazos es peor que decir que lo consultas.',
  input_schema: {
    type: 'object' as const,
    properties: {
      pregunta: {
        type: 'string',
        description: 'Lo que preguntó la clienta, en sus palabras.',
      },
      falta: {
        type: 'string',
        description: 'Qué dato te faltó para poder contestarla.',
      },
    },
    required: ['pregunta'],
  },
}

export const VER_PRODUCTO_TOOL: Anthropic.Tool = {
  name: 'ver_producto',
  description:
    'La ficha completa de UN producto del catálogo por su nombre: precio real, variantes, foto y enlace. Úsala cuando ya sabes cuál es y necesitas el dato exacto. Para explorar o recomendar, usa buscar_producto.',
  input_schema: {
    type: 'object' as const,
    properties: {
      producto: { type: 'string', description: 'Nombre del producto.' },
    },
    required: ['producto'],
  },
}

/**
 * Que el precio del cobro sea el del catálogo, no el que dijo el modelo.
 *
 * Sin esto, `crear_link_de_pago` emitía una preferencia real contra la cuenta
 * de Mercado Pago del comercio por el número que el modelo escribiera — y ese
 * número sale de una conversación con un desconocido. Es la misma asimetría que
 * el descuento ya no tiene: ahí el tope se aplica en el servidor.
 *
 * Se busca cada producto por su nombre en el catálogo. Si no aparece, o si el
 * precio propuesto está por debajo del real, no se cobra: se le dice al modelo
 * que cotice con el catálogo.
 */
async function verificarPrecios(
  db: SupabaseClient,
  workspaceId: string,
  items: Array<{ title?: string; quantity?: number; unit_price?: number }>
): Promise<
  { items: Array<{ title: string; quantity: number; unit_price: number }> } | { error: true; message: string }
> {
  if (!items.length) {
    return { error: true, message: 'Di qué le estás cobrando.' }
  }
  const salida: Array<{ title: string; quantity: number; unit_price: number }> = []
  for (const i of items) {
    const title = String(i.title ?? '').trim()
    const propuesto = Number(i.unit_price)
    const quantity = Math.max(1, Math.floor(Number(i.quantity ?? 1)) || 1)
    if (!title || !Number.isFinite(propuesto) || propuesto <= 0) {
      return {
        error: true,
        message: 'Faltan el nombre o el precio del producto.',
      }
    }
    const [hit] = await searchProducts(db, {
      workspaceId,
      query: title,
      limit: 1,
    })
    const real = hit?.price_min ?? null
    if (real == null) {
      return {
        error: true,
        message: `No encontré "${title}" en el catálogo. Busca el producto con buscar_producto y cobra el precio que figura ahí.`,
      }
    }
    // Se acepta cobrar de MÁS (un envío sumado, un armado especial) pero nunca
    // de menos: cobrar por debajo del catálogo es la venta que alguien
    // consiguió convenciendo al modelo.
    if (propuesto < real) {
      return {
        error: true,
        message: `El precio de "${hit.title}" es ${real}, no ${propuesto}. Cotiza el del catálogo.`,
      }
    }
    salida.push({ title: hit.title || title, quantity, unit_price: propuesto })
  }
  return { items: salida }
}

/**
 * Cobrar, para el comercio que no tiene Shopify.
 *
 * El checkout de Shopify resuelve el pago solo, pero Tiendanube, WooCommerce y
 * Mercado Libre no tienen equivalente en Riverz: esas conversaciones terminaban
 * en "pasame el alias". Con esto el agente manda un link de Mercado Pago y la
 * clienta paga con tarjeta ahí mismo.
 */
export const CREAR_LINK_DE_PAGO_TOOL: Anthropic.Tool = {
  name: 'crear_link_de_pago',
  description:
    'Genera un link de pago de Mercado Pago cuando la clienta ya quiere pagar y la tienda no tiene un checkout propio. Pasa qué le estás cobrando, con precio unitario y cantidad. El dinero va a la cuenta del negocio. Cotiza SÓLO precios reales del catálogo: no inventes montos ni descuentos. Si ya generaste un link en esta conversación y no cambió nada, reutiliza ese en vez de crear otro.',
  input_schema: {
    type: 'object' as const,
    properties: {
      items: {
        type: 'array',
        description: 'Qué se le cobra.',
        items: {
          type: 'object',
          properties: {
            title: { type: 'string', description: 'Nombre del producto.' },
            quantity: { type: 'integer', minimum: 1, default: 1 },
            unit_price: {
              type: 'number',
              description: 'Precio POR UNIDAD, no el total.',
            },
          },
          required: ['title', 'unit_price'],
        },
      },
      customer_email: {
        type: 'string',
        description: 'Correo de la clienta, si lo dio. Le prellena el pago.',
      },
    },
    required: ['items'],
  },
}

/**
 * Ofrecer un descuento.
 *
 * El tope lo pone el comercio y se aplica en el servidor: el modelo propone un
 * porcentaje y sale el que esté permitido, nunca al revés. Con el tope en 0
 * —el default— esta tool no se le ofrece al agente.
 */
export function buildDescuentoTool(tope: number, fijo?: number | null): Anthropic.Tool {
  const exacto = Number.isFinite(fijo) && Number(fijo) > 0 ? Number(fijo) : null
  return {
    name: 'ofrecer_descuento',
    description: exacto
      ? `Genera el cupón personal de ${exacto}% ya autorizado por esta recuperación. Es de un solo uso y sólo para esta clienta; no cambies el porcentaje.`
      : `Genera un cupón de descuento personal para la clienta cuando dude por el precio o pida una rebaja. Puedes ofrecer hasta ${tope}%. Es de un solo uso y sólo para ella. Úsalo con criterio: es para destrabar una venta que si no se pierde, no para regalarlo apenas alguien pregunta. Si ya le diste uno en esta conversación, repítele ESE código en vez de pedir otro.`,
    input_schema: {
      type: 'object' as const,
      properties: {
        percent: {
          type: 'integer',
          minimum: 1,
          maximum: tope,
          ...(exacto ? { enum: [exacto] } : {}),
          description: exacto
            ? `Debe ser exactamente ${exacto}%.`
            : `Cuánto descontar. El máximo autorizado es ${tope}%.`,
        },
        reason: {
          type: 'string',
          description: 'Por qué se lo das (una frase corta). Queda registrado.',
        },
      },
      required: ['percent'],
    },
  }
}

/** Definición JSON-Schema de la tool `lookup_order` (formato Anthropic). */
export const LOOKUP_ORDER_TOOL: Anthropic.Tool = {
  name: 'lookup_order',
  description:
    'Busca un pedido del cliente en la tienda conectada. Úsalo cuando pregunte por el estado, entrega, tracking o qué compró. Distingue el dato que escribió: un teléfono va en customer_phone, un correo en customer_email y un número real de pedido en order_number. Devuelve un resumen del pedido con estado de pago, envío, productos y tracking si existe.',
  input_schema: {
    type: 'object' as const,
    properties: {
      include_screenshot: { type: 'boolean', description: 'Si duda de referencias, colores o cantidades, usa true con un order_number concreto para adjuntar una captura de sus productos. Para comparar dos pedidos consulta cada número por separado. Solo disponible en WhatsApp automático; no confirma ni despacha pedidos.' },
      order_number: {
        type: 'string',
        description: 'Número de pedido (ej. "1042" o "#1042"). No pongas aquí un teléfono ni un correo.',
      },
      customer_phone: {
        type: 'string',
        description:
          'Teléfono que el cliente acaba de confirmar en esta conversación. Ej. "3003364305". No lo confundas con el número de pedido.',
      },
      customer_email: {
        type: 'string',
        description: 'Correo que el cliente acaba de confirmar en esta conversación.',
      },
      reason: {
        type: 'string',
        description: 'Por qué llamas esta tool (tracking, estado, devolución, etc.). Una frase corta.',
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
  /**
   * ¿Este comercio permite descuentos? Con el tope en 0 el campo del cupón ni
   * se ofrece: si no, la clienta escribía "tengo el código BLACKFRIDAY50", el
   * modelo lo pasaba, y si ese código existía de una campaña vieja se aplicaba
   * igual — la garantía de "tope 0 = no se regala nada" no se sostenía.
   */
  permiteDescuentos = false
): Anthropic.Tool {
  const offers = config?.offers ?? null
  const bundleMode = !!(config?.enabled && offers && offers.length > 0)
  const currency = config?.currency || 'ARS'

  const transferAmount = typeof config?.transfer_discount_amount === 'number' ? config.transfer_discount_amount : null
  const transferLabel = config?.transfer_discount_label || 'transferencia'
  const hasTransferDiscount = transferAmount != null && transferAmount > 0

  const payment_hint = {
    type: 'string' as const,
    enum: ['card_or_mp', 'transfer'],
    description: hasTransferDiscount
      ? `Si la clienta dijo que va a pagar por ${transferLabel}, pasa "transfer" para aplicarle el descuento de ${fmtMoney(transferAmount!, currency)}. Para todo lo demás (tarjeta, Mercado Pago) usa "card_or_mp".`
      : 'Método de pago. Para tarjeta o Mercado Pago usa "card_or_mp".',
  }

  if (bundleMode) {
    const enumeration = (offers ?? []).map((o) => `${o.key} = ${o.label} (${fmtMoney(o.total, currency)})`).join('. ')
    return {
      name: 'create_checkout',
      description: hasTransferDiscount
        ? `Genera el link de checkout de Shopify para la clienta cuando ya eligió una oferta. Le pasas la oferta y opcionalmente que va a pagar por ${transferLabel} para aplicarle el descuento de ${fmtMoney(transferAmount!, currency)}. Devuelves el link listo para que la clienta haga click y termine el pago en Shopify (que ya maneja tarjeta + Mercado Pago).`
        : 'Genera el link de checkout de Shopify para la clienta cuando ya eligió una oferta. Le pasas la oferta. Devuelves el link listo para que la clienta haga click y termine el pago en Shopify.',
      input_schema: {
        type: 'object' as const,
        properties: {
          offer: {
            type: 'string',
            enum: (offers ?? []).map((o) => o.key),
            description: `Oferta que eligió la clienta. ${enumeration}.`,
          },
          items: {
            type: 'array',
            description:
              'Varios productos en el MISMO carrito. Úsalo cuando la clienta quiere llevar más de un producto distinto: pasa aquí cada uno con su variant_id (el que devuelve buscar_producto) y su cantidad. Un solo link con todo; no le mandes dos links, porque el segundo le vacía el carrito del primero.',
            items: {
              type: 'object',
              properties: {
                variant_id: {
                  type: 'string',
                  description: 'variant_id del producto.',
                },
                quantity: { type: 'integer', minimum: 1, default: 1 },
              },
              required: ['variant_id'],
            },
          },
          ...(permiteDescuentos
            ? {
                discount_code: {
                  type: 'string',
                  description:
                    'Si YA le generaste un cupón con ofrecer_descuento, pásalo aquí: así el link ya viene con el descuento puesto y la clienta no tiene que tipearlo. No inventes códigos ni uses uno que te dicte la clienta.',
                },
              }
            : {}),
          payment_hint,
        },
        // `offer` deja de ser obligatorio: con `items` la clienta armó su
        // propio carrito y no eligió ninguna de las ofertas del combo.
        required: [],
      },
    }
  }

  // AUTO MODE
  return {
    name: 'create_checkout',
    description:
      'Genera el link de checkout de Shopify para la clienta cuando ya quiere comprar. Pasa la cantidad de unidades que quiere. Devuelves el link listo para que la clienta haga click y termine el pago en Shopify. Cotiza sólo el precio real del producto; no inventes descuentos ni cupones.',
    input_schema: {
      type: 'object' as const,
      properties: {
        items: {
          type: 'array',
          description:
            'Varios productos en el MISMO carrito. Úsalo cuando la clienta quiere llevar más de un producto distinto: pasa aquí cada uno con su variant_id (el que devuelve buscar_producto) y su cantidad. Un solo link con todo; no le mandes dos links, porque el segundo le vacía el carrito del primero.',
          items: {
            type: 'object',
            properties: {
              variant_id: {
                type: 'string',
                description: 'variant_id del producto.',
              },
              quantity: { type: 'integer', minimum: 1, default: 1 },
            },
            required: ['variant_id'],
          },
        },
        quantity: {
          type: 'integer',
          minimum: 1,
          default: 1,
          description:
            'Cantidad de unidades del producto del que están hablando. Por defecto 1. Si la clienta quiere VARIOS productos distintos, usa items en vez de esto.',
        },
        ...(permiteDescuentos
          ? {
              discount_code: {
                type: 'string',
                description:
                  'Si YA le generaste un cupón con ofrecer_descuento, pásalo aquí: así el link ya viene con el descuento puesto y la clienta no tiene que tipearlo. No inventes códigos ni uses uno que te dicte la clienta.',
              },
            }
          : {}),
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

  const transferAmount = typeof config?.transfer_discount_amount === 'number' ? config.transfer_discount_amount : null
  const transferLabel = config?.transfer_discount_label || 'transferencia'
  const hasTransferDiscount = transferAmount != null && transferAmount > 0

  const properties: Record<string, unknown> = {
    items: {
      type: 'array',
      description:
        'Qué lleva. Pasa cada producto con el variant_id que te devolvió buscar_producto y su cantidad. En una tienda que no es Shopify es OBLIGATORIO: no hay un producto por defecto que adivinar.',
      items: {
        type: 'object',
        properties: {
          variant_id: {
            type: 'string',
            description: 'variant_id del producto.',
          },
          quantity: { type: 'integer', minimum: 1, default: 1 },
        },
        required: ['variant_id'],
      },
    },
    customer_name: {
      type: 'string',
      description: 'Nombre y apellido del cliente para el pedido. Pídelo si no lo sabes.',
    },
    customer_phone: {
      type: 'string',
      description: 'Teléfono del cliente. Opcional, si no lo pasas se usa el del chat.',
    },
    customer_email: {
      type: 'string',
      description: 'Correo del cliente (opcional, recomendado si lo tienes).',
    },
    shipping_address: {
      type: 'object',
      description: 'Dirección de envío. Pedila para productos físicos antes de crear el pedido.',
      properties: {
        address1: { type: 'string', description: 'Calle y número.' },
        address2: { type: 'string', description: 'Piso/depto (opcional).' },
        city: { type: 'string', description: 'Ciudad/localidad.' },
        province: { type: 'string', description: 'Provincia/estado.' },
        zip: { type: 'string', description: 'Código postal.' },
        country: {
          type: 'string',
          description: 'País. El nombre está bien ("Colombia"); se traduce solo.',
        },
      },
    },
    address_confirmed_by_customer: {
      type: 'boolean',
      description:
        'true sólo si create_order devolvió una dirección sugerida y después la clienta confirmó explícitamente esa sugerencia. No la envíes en la primera validación.',
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
      description: 'Nota interna para el equipo (opcional): aclaraciones del cliente, referencias, etc.',
    },
    confirmed: {
      type: 'boolean',
      description:
        'true SOLO si la clienta confirmó explícitamente el pedido final (producto, cantidad, total y dirección si aplica). Si todavía no confirmó, NO llames esta tool.',
    },
  }

  const required: string[] = ['customer_name', 'confirmed']

  if (bundleMode) {
    const enumeration = (offers ?? []).map((o) => `${o.key} = ${o.label} (${fmtMoney(o.total, currency)})`).join('. ')
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
      'Crea el PEDIDO REAL en la tienda del negocio cuando la clienta YA confirmó qué quiere comprar. Antes de llamarla: reúne el producto/cantidad, el nombre, los datos de envío si es producto físico y el método de pago; muéstrale el resumen y el total, y espera su confirmación explícita. Llámala una sola vez, con confirmed=true. Devuelve el número de pedido para que se lo pases a la clienta. Si todavía falta info o no confirmó, NO la llames: sigue preguntando.',
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
/**
 * Pedidos que Riverz ya tiene espejados, para los canales donde NO se puede
 * consultar en vivo. Mercado Libre es el caso: entrega al comprador
 * anonimizado —sin nombre, sin email y con el teléfono enmascarado— así que no
 * hay ningún dato con el que interrogar su API después. Lo único que ata el
 * pedido a la persona es el vínculo que guardó el sincronizador.
 */
/**
 * Las herramientas que dejan algo hecho afuera: un pedido en la tienda, un
 * cobro, un cupón, una solicitud esperando al comercio.
 *
 * Consultar el catálogo o un pedido se puede repetir sin consecuencias; esto
 * no. La lista existe para que un reintento sepa que ya no puede volver a
 * empezar de cero.
 */
const DEJA_HUELLA = new Set([
  'dealer_save_buyer',
  'dealer_request_appointment',
  'clasificar_motivo',
  'gestionar_recompra',
  'create_order',
  'update_order',
  'registrar_pago',
  'cancelar_pedido',
  'reembolsar',
  'crear_link_de_pago',
  'ofrecer_descuento',
])

/**
 * Con qué se puede probar que un pedido es de quien pregunta.
 *
 * En WhatsApp, Instagram o Messenger el canal ya autenticó a la persona: el
 * número o el id de la cuenta son suyos, y el agente no los eligió. En el chat
 * web no. Ahí el correo lo escribe el visitante, y la ruta que lo guarda ya lo
 * dice con todas las letras: «acá el dato es una AFIRMACIÓN de alguien
 * anónimo». Aceptarlo como prueba dejaba la fuga por número de pedido viva en
 * dos pasos — escribir el correo de otra clienta y después pedir su pedido.
 *
 * En el chat web el pedido propio se contesta con la fila espejo, que está
 * atada a la conversación y no a lo que alguien escriba.
 */
function pruebaDeIdentidad(
  canal: string | null | undefined,
  email: string | null | undefined,
  telefono: string | null | undefined
): { email?: string; phone?: string } {
  if ((canal ?? '') === 'webchat') return {}
  return { email: email ?? undefined, phone: telefono ?? undefined }
}

function telefonoDeclarado(value: unknown): string | undefined {
  const raw = typeof value === 'string' ? value.trim() : ''
  const digits = raw.replace(/\D/g, '')
  return digits.length >= 8 && digits.length <= 15 ? raw : undefined
}

function correoDeclarado(value: unknown): string | undefined {
  const raw = typeof value === 'string' ? value.trim() : ''
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw) ? raw : undefined
}

/**
 * Respaldo para el error exacto de Juan Carlos: el modelo envió un celular
 * colombiano de diez dígitos como `order_number`. Una almohadilla mantiene la
 * intención de pedido; sin ella, 3XXXXXXXXX (o 57 + ese número) es teléfono.
 */
function telefonoColombianoEnCampoPedido(value: unknown): string | undefined {
  const raw = typeof value === 'string' ? value.trim() : ''
  if (!raw || raw.startsWith('#')) return undefined
  const digits = raw.replace(/\D/g, '')
  return /^3\d{9}$/.test(digits) || /^573\d{9}$/.test(digits) ? raw : undefined
}

function instruccionNoEncontrado(usado: { numero?: string; phone?: string; email?: string }): string {
  if (!usado.phone && !usado.email) {
    return 'Falta verificar la identidad del comprador. NO inventes información del pedido ni afirmes que no existe o que no se encontró: un número o un nombre por sí solos no prueban pertenencia. Pide el correo o teléfono de compra por un canal que permita verificarlo; si ya aportó esos datos o el canal no los verifica, deriva al equipo conservando los datos recibidos, sin repetir preguntas.'
  }
  const por = usado.phone
    ? 'ese teléfono'
    : usado.email
      ? 'ese correo'
      : usado.numero
        ? 'ese número de pedido'
        : 'esos datos'
  const pedir = usado.phone
    ? 'el correo de la compra o el número de pedido'
    : usado.email
      ? 'el teléfono de la compra o el número de pedido'
      : 'el teléfono o correo usado al comprar'
  return `No se encontró ningún pedido con ${por}. NO inventes información del pedido (estado, tracking, fecha de envío). Dile al cliente exactamente qué dato buscaste y pídele ${pedir}; no vuelvas a pedirle el mismo dato.`
}

export interface LocalOrdersContext {
  /** Actual conversation contact and latest inbound are fixed by the server. */
  caseReason?: CaseReasonRuntime | null
  /** Explicit HTTP grant catalog and actual inbound ID derived by the server, never model arguments. */
  httpActions?: HttpAssistantToolRuntime | null
  httpSimulationLocale?: 'es' | 'en'
  queueOrderScreenshot?: (orderNumber: string) => Promise<void>
  queueProductOptions?: (product: ProductHit) => Promise<void>
  db: SupabaseClient
  workspaceId: string
  contactId: string
  /** Para poder pasarle la conversación a una persona cuando algo queda a medias. */
  conversationId?: string | null
  agentId?: string | null
  /** A recovery handoff can authorize exactly one server-fixed percentage. */
  fixedDiscountPercent?: number | null
  /** Por dónde llegó, para poder decir después dónde falló el agente. */
  channel?: string | null
  /**
   * De qué productos puede hablar. `null`/ausente = de todos.
   *
   * `buscar_producto` no lo miraba: un agente con "Productos asignados" buscaba
   * en el catálogo entero, así que el comercio le decía de qué puede hablar y
   * la herramienta que más usa se lo saltaba. Viene expandido al grupo.
   */
  permitidos?: Set<string> | null
  /**
   * Herramientas que el comercio puso "con aprobación": el agente las prepara
   * y una persona confirma. No se ejecutan acá.
   */
  requiereAprobacion?: readonly string[]
  /**
   * Simulación: el panel «Probar» del editor.
   *
   * Lo que consulta —el catálogo, un pedido, la ficha— se deja correr: sin eso
   * el comercio prueba un agente ciego. Lo que DEJA HUELLA afuera —crear un
   * pedido, cobrar, emitir un cupón, pedirle permiso al dueño por WhatsApp— se
   * corta acá y se contesta como si hubiera salido bien.
   *
   * El corte va en un solo lugar y no en cada herramienta: una herramienta
   * nueva que se olvide del modo prueba es un cupón real emitido desde un
   * panel que dice "Probar".
   */
  simulacion?: boolean
}

type AddressGateResult =
  | { ok: true; address: ShippingAddressInput }
  | { ok: false; toolResult: string }

/**
 * El botón CONFIRMAR confirma el resumen, pero no convierte una dirección
 * dudosa en entregable. Este gate corre después del botón y antes de escribir
 * el pedido. Si Google la acepta, normaliza en silencio; si no, devuelve una
 * sola pregunta concreta para que el modelo continúe la conversación.
 */
async function validateAddressBeforeOrder(
  ctx: LocalOrdersContext,
  address: ShippingAddressInput | undefined,
  customerConfirmedSuggestion: boolean,
): Promise<AddressGateResult> {
  const original = address ?? {}
  const decision = await validateWorkspaceShippingAddress(
    ctx.workspaceId,
    original,
    ctx.db,
  )
  if (decision.status === 'disabled') return { ok: true, address: original }
  if (decision.status === 'accept') return { ok: true, address: decision.address }
  if (decision.status === 'confirm' && customerConfirmedSuggestion) {
    return { ok: true, address: decision.address }
  }
  if (decision.status === 'confirm') {
    return {
      ok: false,
      toolResult: JSON.stringify({
        error: 'address_confirmation_required',
        suggested_address: decision.address,
        suggested_text: decision.formattedAddress,
        reasons: decision.reasons,
        message:
          `Todavía no crees el pedido. Pregunta únicamente si la dirección “${decision.formattedAddress}” es correcta. Si la clienta confirma, vuelve a llamar create_order con suggested_address, confirmed=true y address_confirmed_by_customer=true.`,
      }),
    }
  }
  if (decision.status === 'fix') {
    return {
      ok: false,
      toolResult: JSON.stringify({
        error: 'address_fix_required',
        missing: decision.missing,
        reasons: decision.reasons,
        suggested_address: decision.suggestedAddress,
        message:
          `Todavía no crees el pedido. La dirección necesita corregirse: ${decision.reasons.join(', ')}. Pregunta únicamente por esos datos, conserva lo demás y vuelve a validar después de que la clienta responda.`,
      }),
    }
  }
  return {
    ok: false,
    toolResult: JSON.stringify({
      error: 'address_validation_unavailable',
      detail: decision.reason,
      message:
        'No pude comprobar la dirección en este momento. No digas que está incorrecta ni crees el pedido; indica que la validación está temporalmente pendiente.',
    }),
  }
}

/**
 * El freno.
 *
 * Cuando una herramienta está en modo aprobación, `runTool` no la ejecuta:
 * deja la solicitud anotada, le avisa al comercio por WhatsApp y le dice al
 * modelo exactamente qué contarle a la clienta. Con el sí, `resolve.ts` la
 * corre con el mismo argumento que el modelo había propuesto.
 *
 * Va antes que todo lo demás a propósito. Poner el freno adentro de cada
 * herramienta sería catorce lugares donde olvidarse de uno, y el que se olvide
 * es el que va a mover dinero sin que nadie lo haya querido.
 */
async function pedirPermiso(ctx: LocalOrdersContext, toolName: string, toolInput: unknown): Promise<string> {
  const { askForApproval } = await import('@/lib/approvals/ask')
  const { resumirHerramienta } = await import('./tool-labels')
  const { titulo, cuerpo, comoContarlo } = resumirHerramienta(toolName, toolInput)

  const res = await askForApproval({
    db: ctx.db,
    workspaceId: ctx.workspaceId,
    kind: 'herramienta',
    title: titulo,
    body: cuerpo,
    payload: {
      tool: toolName,
      input: (toolInput ?? {}) as Record<string, unknown>,
      contact_id: ctx.contactId,
      conversation_id: ctx.conversationId ?? null,
      agent_id: ctx.agentId ?? null,
    },
  })

  if (!res.ok) {
    return JSON.stringify({
      ok: false,
      message: 'No pude dejarlo pedido. Dile que lo pasas al equipo y que le confirman en breve.',
    })
  }
  return JSON.stringify({
    ok: true,
    estado: 'pendiente_de_aprobacion',
    message: comoContarlo,
  })
}

/**
 * `registrar_pago` — el cliente dice que ya transfirió.
 *
 * Existe porque el comprobante llega por WhatsApp y hasta hoy moría ahí:
 * Shopify sólo se enteraba si el comercio lo marcaba a mano, así que el
 * pedido seguía pendiente y los recordatorios le seguían llegando a alguien
 * que ya había pagado.
 *
 * Anota evidencia y pausa recordatorios. La lectura del modelo nunca prueba
 * que el dinero ingresó: el comercio debe verificar el pago.
 */
export const REGISTRAR_PAGO_TOOL: Anthropic.Tool = {
  name: 'registrar_pago',
  description:
    'Registra que el cliente informó haber pagado su pedido pendiente (transferencia, depósito). Úsala cuando mande un comprobante o diga que ya transfirió. Anota la evidencia y pausa los recordatorios; el comercio debe verificar el ingreso del pago antes de marcarlo pagado. Una imagen o un PDF no prueban que el dinero ingresó.',
  input_schema: {
    type: 'object' as const,
    properties: {
      amount: {
        type: 'number',
        description:
          'Monto que figura en el comprobante, sólo si lo puedes leer con certeza. Sin separadores de miles. Si no se ve claro, no lo inventes: omítelo.',
      },
      // Conserva el origen de la evidencia para revisión, no una autorización.
      desde_comprobante: {
        type: 'boolean',
        description:
          'true SÓLO si leíste el monto de una imagen o PDF adjunto; false si lo tomaste del texto. Es información sobre el origen de la evidencia, nunca autorización para marcar pagado.',
      },
      referencia: {
        type: 'string',
        description:
          'Número de operación / comprobante / transacción que figura en el comprobante, tal cual, sin espacios. Es lo que identifica esa transferencia y evita que la misma captura pague dos pedidos. Si no se ve, omítelo.',
      },
      fecha: {
        type: 'string',
        description: 'Fecha y hora de la transferencia como figura en el comprobante.',
      },
      destino: {
        type: 'string',
        description: 'A qué cuenta fue: alias, CBU, banco o titular que aparece como destinatario.',
      },
      titular: {
        type: 'string',
        description: 'Quién transfirió, si el comprobante lo muestra.',
      },
      note: {
        type: 'string',
        description:
          'Qué viste: "comprobante de transferencia por 52.365 del 15/08" o "dice que ya transfirió, sin comprobante".',
      },
    },
    required: ['note'],
  },
}

/**
 * Tienda conectada que NO es Shopify (Tiendanube, WooCommerce), con los
 * datos del cliente de esta conversación para poder buscar su pedido.
 */
export type OtherStoreContext = NonNullable<Awaited<ReturnType<typeof resolveStoreForLookup>>> & {
  customerEmail?: string | null
  customerPhone?: string | null
}

export async function runTool(
  toolName: string,
  toolInput: unknown,
  shopify: ShopifyToolContext | null,
  voice: VoiceEscalationContext | null = null,
  localOrders: LocalOrdersContext | null = null,
  otherStore: OtherStoreContext | null = null
): Promise<string> {
  // Custom inputs/results can contain selected customer data. Keep them out of tool telemetry.
  if (isDealerTool(toolName) || isHttpAssistantTool(toolName) || toolName === 'clasificar_motivo') return runToolInner(toolName, toolInput, shopify, voice, localOrders, otherStore);
  return traceTool(toolName, () => runToolInner(toolName, toolInput, shopify, voice, localOrders, otherStore), toolInput);
}

async function runToolInner(
  toolName: string,
  toolInput: unknown,
  shopify: ShopifyToolContext | null,
  voice: VoiceEscalationContext | null = null,
  localOrders: LocalOrdersContext | null = null,
  otherStore: OtherStoreContext | null = null
): Promise<string> {
  if (isDealerTool(toolName)) {
    if (!localOrders) return JSON.stringify({ ok: false, error: 'dealer_context_missing' });
    return runDealerTool(toolName, toolInput, localOrders);
  }
  if (toolName === 'clasificar_motivo') return classifyCaseReason(localOrders?.caseReason,toolInput,localOrders?.simulacion === true);
  // Reserved dynamic namespace: block every external request and approval in simulations, including GET.
  if (isHttpAssistantTool(toolName)) {
    if (!localOrders) return JSON.stringify({ ok: false, error: 'http_action_unavailable' });
    return runHttpAssistantTool(localOrders.db, localOrders.httpActions, toolName, toolInput, localOrders.simulacion === true, localOrders.httpSimulationLocale);
  }
  const requiresApproval = localOrders?.requiereAprobacion?.some(
    key => key === toolName || key === toolPermissionKey(toolName),
  )

  // El corte del modo prueba. Va antes que cualquier despacho para que una
  // herramienta nueva quede cubierta sin que nadie se acuerde de cubrirla.
  if (localOrders?.simulacion && (DEJA_HUELLA.has(toolName) || requiresApproval)) {
    return JSON.stringify({
      simulado: true,
      ok: true,
      message: 'Simulación: la acción no se ejecutó de verdad. Sigue la conversación como si hubiera salido bien.',
    })
  }

  // Creating an approval also writes and may notify the merchant; never do
  // that from a simulation. Real actions still stop here before dispatch.
  if (requiresApproval && localOrders) {
    return pedirPermiso(localOrders, toolName, toolInput)
  }

  if (
    toolName === 'ver_contacto' ||
    toolName === 'gestionar_recompra' ||
    toolName === 'etiquetar_contacto' ||
    toolName === 'cerrar_conversacion' ||
    toolName === 'ver_producto'
  ) {
    if (!localOrders) {
      return JSON.stringify({
        error: 'sin_contexto',
        message: 'No tengo la ficha de esta conversación.',
      })
    }
    const ctx = {
      db: localOrders.db,
      workspaceId: localOrders.workspaceId,
      contactId: localOrders.contactId,
      conversationId: localOrders.conversationId ?? null,
      permitidos: localOrders.permitidos ?? null,
    }
    const input = (toolInput ?? {}) as Record<string, unknown>
    if (toolName === 'ver_contacto') return verContacto(ctx)
    if (toolName === 'gestionar_recompra') return gestionarRecompra(ctx, input)
    if (toolName === 'ver_producto') return verProducto(ctx, input as { producto?: string })
    if (toolName === 'cerrar_conversacion') {
      return cerrarConversacion(ctx)
    }
    return etiquetarContacto(ctx, input as { etiqueta?: string; quitar?: boolean })
  }

  if (toolName === 'no_se_la_respuesta') {
    if (!localOrders) {
      return JSON.stringify({
        ok: false,
        message: 'No lo pude anotar. Dile con honestidad que eso no lo sabes.',
      })
    }
    return registrarHueco(
      {
        db: localOrders.db,
        workspaceId: localOrders.workspaceId,
        contactId: localOrders.contactId,
        conversationId: localOrders.conversationId ?? null,
        agentId: localOrders.agentId ?? null,
        channel: localOrders.channel ?? null,
      },
      (toolInput ?? {}) as { pregunta?: string; falta?: string }
    )
  }

  if (toolName === 'abrir_devolucion') {
    if (!localOrders) {
      return JSON.stringify({
        error: 'sin_contexto',
        message: 'No puedo registrar devoluciones en esta conversación.',
      })
    }
    return abrirDevolucion(
      {
        db: localOrders.db,
        workspaceId: localOrders.workspaceId,
        contactId: localOrders.contactId,
        conversationId: localOrders.conversationId ?? null,
        agentId: localOrders.agentId ?? null,
      },
      (toolInput ?? {}) as AbrirDevolucionInput
    )
  }

  if (toolName === 'buscar_producto') {
    // Se apoya en `localOrders` porque es el único contexto que trae `db` y
    // `workspaceId`, que es todo lo que hace falta para leer el catálogo.
    if (!localOrders) {
      return JSON.stringify({
        error: 'sin_contexto',
        message: 'No puedo buscar en el catálogo en esta conversación.',
      })
    }
    const input = (toolInput ?? {}) as {
      query?: string
      limit?: number
      include_images?: boolean
    }
    const hits = await searchProducts(localOrders.db, {
      workspaceId: localOrders.workspaceId,
      query: String(input.query ?? ''),
      limit: input.limit,
      permitidos: localOrders.permitidos ?? null,
      agrupar: true,
    })
    if (hits.length === 0) {
      return JSON.stringify({
        found: false,
        products: [],
        // Sin esto el modelo tiende a rellenar el silencio inventando un
        // producto parecido, que es la peor respuesta posible en una tienda.
        instruction:
          'No hay productos que coincidan. Dile con honestidad que no lo tienes y ofrece buscar otra cosa. NO inventes un producto ni un precio.',
      })
    }
    let images: 'queued_with_reply' | 'unavailable' | undefined
    if (input.include_images) {
      const visual = hits.find((hit) => hit.visual_options.length >= 2)
      if (!visual || !localOrders.queueProductOptions || localOrders.simulacion) {
        images = 'unavailable'
      } else {
        try {
          await localOrders.queueProductOptions(visual)
          images = 'queued_with_reply'
        } catch {
          images = 'unavailable'
        }
      }
    }
    return JSON.stringify({
      found: true,
      products: hits,
      images,
      instruction:
        images === 'unavailable'
          ? 'No se pudo preparar la imagen. Enumera las opciones reales por texto y no afirmes que enviaste una foto.'
          : images === 'queued_with_reply'
            ? 'La imagen comparativa se enviará con tu respuesta. Haz una sola pregunta para que el cliente elija; no repitas una lista larga de colores.'
            : undefined,
    })
  }

  if (toolName === 'ofrecer_descuento') {
    if (!localOrders) {
      return JSON.stringify({
        error: 'sin_contexto',
        message: 'No puedo generar descuentos en esta conversación.',
      })
    }
    const input = (toolInput ?? {}) as { percent?: number; reason?: string }
    const res = await emitirCupon(localOrders.db, {
      workspaceId: localOrders.workspaceId,
      contactId: localOrders.contactId,
      conversationId: shopify?.conversationId ?? null,
      agentId: shopify?.agentId ?? null,
      contactName: shopify?.contactName ?? null,
      pedido: localOrders.fixedDiscountPercent ?? Number(input.percent ?? 0),
    })
    if ('error' in res) {
      return JSON.stringify({
        ok: false,
        message: 'No pude generar el descuento. No le prometas ninguna rebaja; sigue con el precio de lista.',
      })
    }
    return JSON.stringify({
      ok: true,
      code: res.code,
      percent: res.percent,
      // El porcentaje que sale puede ser MENOR al que pidió el modelo: el tope
      // manda. Decírselo evita que anuncie uno y entregue otro.
      message: `Dile que tiene ${res.percent}% con el código ${res.code}, que es suyo y de un solo uso. Si el porcentaje es menor al que pensabas, ofrece ESE, no el otro.`,
    })
  }

  if (toolName === 'crear_link_de_pago') {
    if (!localOrders) {
      return JSON.stringify({
        error: 'sin_contexto',
        message: 'No puedo generar links de pago en esta conversación.',
      })
    }
    if (localOrders.workspaceId === DEUNA_DROPI_WORKSPACE) {
      // A generic full-order checkout is not a deposit. Until the dedicated
      // partial-payment ledger and COD adjustment are verified, fail closed.
      const { data: linked, error } = await localOrders.db.from('orders')
        .select('dropi_evidence').eq('workspace_id', localOrders.workspaceId)
        .eq('contact_id', localOrders.contactId).not('dropi_evidence', 'is', null)
        .not('status', 'in', '(cancelled,refunded,failed)').limit(30)
      if (error || (linked ?? []).some(row => {
        const evidence = row.dropi_evidence as { buyer_history?: { classification?: string } } | null
        return evidence?.buyer_history?.classification === 'risky'
      })) return JSON.stringify({ ok: false, error: 'dropi_deposit_checkout_required',
        message: 'No generes un cobro completo ni inventes un enlace para el anticipo. El anticipo del 50% requiere un enlace vinculado al pedido, pago verificado y saldo contra entrega ajustado. Coordina este pago con el equipo sin prometer despacho.' })
    }
    const input = (toolInput ?? {}) as {
      items?: Array<{ title?: string; quantity?: number; unit_price?: number }>
      customer_email?: string
    }
    // El precio lo propone el modelo, que lee mensajes de desconocidos: "el
    // vendedor me confirmó que sale 100" es exactamente el mensaje que va a
    // recibir. Se contrasta contra el catálogo antes de cobrar, igual que el
    // descuento se recorta contra el tope del comercio.
    const verificados = await verificarPrecios(localOrders.db, localOrders.workspaceId, input.items ?? [])
    if ('error' in verificados) {
      return JSON.stringify({
        ok: false,
        message: verificados.message,
      })
    }
    // El pedido al que se le ata el cobro, si esta persona ya tiene uno
    // esperando pago. Es lo que viaja como `external_reference` y lo único que
    // permite que el webhook de Mercado Pago sepa qué marcar: sin esto el pago
    // llegaba huérfano y la promesa de la línea de abajo —"el pedido se marca
    // solo"— no podía cumplirse nunca.
    const { data: pendiente } = await localOrders.db
      .from('orders')
      .select('id')
      .eq('workspace_id', localOrders.workspaceId)
      .eq('contact_id', localOrders.contactId)
      .in('status', ['created', 'pending'])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    const orderId = (pendiente as { id?: string } | null)?.id ?? null

    const res = await crearLinkDePago(localOrders.db, {
      workspaceId: localOrders.workspaceId,
      items: verificados.items,
      payerEmail: input.customer_email ?? null,
      orderId,
    })
    if ('error' in res) {
      return JSON.stringify({
        ok: false,
        // El motivo importa: sin Mercado Pago conectado no hay nada que
        // reintentar, y el modelo tiene que ofrecer otra cosa en vez de
        // insistir con una herramienta que no va a funcionar.
        error: res.error,
        message:
          res.error === 'sin_conexion'
            ? 'No hay forma de cobrar por link en esta cuenta. Ofrécele coordinar el pago con el equipo.'
            : 'No pude generar el link. Ofrécele coordinar el pago con el equipo.',
      })
    }
    return JSON.stringify({
      ok: true,
      payment_url: res.url,
      message: orderId
        ? 'Pásale el link para que pague con tarjeta. Cuando pague, el pedido se marca solo. NO le digas que ya está pagado.'
        : // Sin pedido al que atarlo, el pago entra a la cuenta pero nadie lo
          // concilia solo. Prometerlo igual dejaba a la clienta esperando una
          // confirmación que no iba a llegar.
          'Pásale el link para que pague con tarjeta. NO le digas que ya está pagado ni que se confirma solo: avísale que se lo confirmas tú cuando entre.',
    })
  }

  if (toolName === 'cancelar_pedido' || toolName === 'reembolsar') {
    if (!localOrders) {
      return JSON.stringify({
        error: 'sin_contexto',
        message: 'No puedo gestionar pedidos en esta conversación.',
      })
    }
    const ctx = {
      db: localOrders.db,
      workspaceId: localOrders.workspaceId,
      contactId: localOrders.contactId,
      conversationId: localOrders.conversationId ?? null,
    }
    const input = (toolInput ?? {}) as {
      order_number?: string
      amount?: number
      reason?: string
    }
    return toolName === 'cancelar_pedido' ? proponerCancelacion(ctx, input) : proponerReembolso(ctx, input)
  }

  if (toolName === 'registrar_pago') {
    if (!localOrders) {
      return JSON.stringify({
        error: 'sin_contexto',
        message: 'No puedo registrar pagos en esta conversación.',
      })
    }
    const input = (toolInput ?? {}) as {
      amount?: number
      note?: string
      desde_comprobante?: boolean
      referencia?: string
      fecha?: string
      destino?: string
      titular?: string
    }
    const { resultado: res } = await informarPago({
      db: localOrders.db,
      workspaceId: localOrders.workspaceId,
      contactId: localOrders.contactId,
      requiereVerificacionHumana: true,
      amount: typeof input.amount === 'number' ? input.amount : null,
      note: input.note ?? null,
      desdeComprobante: input.desde_comprobante === true,
      referencia: input.referencia ?? null,
      leido: {
        fecha: input.fecha ?? null,
        destino: input.destino ?? null,
        titular: input.titular ?? null,
      },
    })

    if (res.kind === 'ya_pagado') {
      // La mejor noticia posible, y la teníamos a mano. NO se escala: no hay
      // nada que revisar. Antes caía en `sin_pedido` y salía "lo estamos
      // verificando", que le hacía dudar de algo que estaba resuelto.
      return JSON.stringify({
        ok: true,
        estado: 'ya_pagado',
        pedido: res.orderNumber,
        total: res.total,
        moneda: res.currency,
        message:
          'Su pedido YA figura pagado. Díselo con el número de pedido y continúa con lo que viene (preparación y despacho). No le digas que lo están verificando: ya está.',
      })
    }
    if (res.kind === 'sin_pedido') {
      // Mandó el comprobante y no encontramos su pedido. Casi nunca es que no
      // exista: los pedidos de Shopify no están espejados acá, y quien paga por
      // transferencia a veces ni tiene número. Decirle "no me figura un pedido a
      // tu nombre" o pedirle el número suena a "perdimos tu pago" — se lo
      // dijimos a dos clientas el 2026-08-28 y las dos tenían razón.
      //
      // Así que no se le pregunta nada: lo mira una persona, que es quien
      // puede abrir Shopify y cruzarlo.
      await pasarAUnaPersona(localOrders, {
        clase: 'cobro',
        urgencia: 'ahora',
        porQue: 'Mandó el comprobante y no encontramos su pedido',
      })
      return JSON.stringify({
        ok: true,
        estado: 'en_verificacion',
        message:
          'Confírmale que recibiste el comprobante y que lo están verificando, y que le avisan por aquí apenas esté. NO le pidas el número de pedido y NO le digas que no figura un pedido a su nombre: ya avisamos a una persona del equipo, que es quien puede cruzarlo.',
      })
    }
    if (res.kind === 'error') {
      return JSON.stringify({
        ok: false,
        message: `No se pudo registrar: ${res.error}`,
      })
    }
    if (res.kind === 'cobrado') {
      return JSON.stringify({
        ok: true,
        estado: 'pagado',
        message: `El pedido quedó marcado como pagado por ${res.amount}. Confírmaselo y dile que ya se prepara el envío.`,
      })
    }

    // No alcanzó para cobrar solo. `informarPago` ya le preguntó a una persona
    // del negocio; acá sólo queda contarle al modelo qué decirle al cliente.
    return JSON.stringify({
      ok: true,
      estado: 'en_verificacion',
      message:
        'Quedó registrado y dejamos de mandarle recordatorios. Dile que lo estamos verificando y que le confirmamos en breve. NO le digas que ya está pagado.',
    })
  }

  if (toolName === 'escalate_to_call') {
    if (!voice) {
      return JSON.stringify({
        error: 'voice_not_available',
        message: 'No puedes programar llamadas en este agente. Sigue ayudando por texto.',
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
        message: 'Ya hay una llamada programada hace poco. Sigue ayudando por texto.',
      })
    }
    const res = await enqueueCall({
      workspaceId: voice.workspaceId,
      agentId: voice.agentId,
      contactId: voice.contactId,
      callType: 'followup',
      context: { reason: input.reason ?? '', escalated_by_ai: true },
      origin: 'assistant',
      sourceAssistantId: voice.assistantId,
      sourceConversationId: voice.conversationId,
      language: voice.language,
      recordSkip: true,
    })
    if (!res.enqueued) {
      return JSON.stringify({
        scheduled: false,
        reason: res.reason,
        message: 'No se pudo programar la llamada ahora (horario, opt-out o límite). Sigue ayudando por texto.',
      })
    }
    return JSON.stringify({
      scheduled: true,
      message: 'Llamada programada. Avísale al cliente con naturalidad que lo vas a llamar en breve.',
    })
  }
  if (toolName === 'update_order') {
    if (!shopify) {
      return JSON.stringify({
        error: 'no_shopify_connection',
        message: 'El workspace no tiene Shopify conectado.',
      })
    }
    const input = (toolInput ?? {}) as {
      add_units?: number
      reason?: string
      order_number?: string
      confirmed?: boolean
      items?: Array<{ variant_id?: string; quantity?: number; free?: boolean }>
    }
    // En una llamada el pedido viene fijado por el bridge de voz, y ahí llega
    // el id interno de Shopify. Por chat el modelo sólo puede decir el número
    // VISIBLE ("pedido 1042"), que no es ese id: interpolado en el `gid://`
    // daba una edición que Shopify nunca encontraba, así que la rama de chat
    // fallaba siempre. Se traduce contra los pedidos de ESTA persona, que de
    // paso es el único recorte de pertenencia que hay — sin él, un número
    // acertado editaba el pedido de cualquiera, sin aprobación de nadie.
    let pedido = shopify.orderId ?? ''
    if (!pedido) {
      const numero = (input.order_number ?? '').trim()
      if (!numero || !localOrders) {
        return JSON.stringify({
          error: 'no_order',
          message:
            'Falta saber a qué pedido sumarle las unidades. Pregúntale el número de pedido a la clienta y vuelve a intentar.',
        })
      }
      // Con o sin almohadilla: Shopify guarda `#1001` y Tiendanube `111`.
      // Sacarla antes de comparar hacía que en Shopify no coincidiera nunca, y
      // el agente contestaba "no encontré el pedido" sobre uno que había creado
      // él dos minutos antes.
      // Un número que se queda en nada (una almohadilla suelta) no puede
      // ablandarse a "cualquier pedido de esta persona": sin el recorte por
      // número, la edición caería sobre el pedido que saliera primero.
      const filtroNumero = filtroDeNumero(numero)
      if (!filtroNumero) {
        return JSON.stringify({
          error: 'no_order',
          message:
            'Falta saber a qué pedido sumarle las unidades. Pregúntale el número de pedido a la clienta y vuelve a intentar.',
        })
      }
      const { data: fila } = await localOrders.db
        .from('orders')
        .select('shopify_order_id')
        .eq('workspace_id', localOrders.workspaceId)
        .eq('contact_id', localOrders.contactId)
        .or(filtroNumero)
        .limit(1)
        .maybeSingle()
      pedido = (fila as { shopify_order_id?: string } | null)?.shopify_order_id ?? ''
      if (!pedido) {
        return JSON.stringify({
          error: 'no_order',
          message: `No encontré el pedido ${numero} a nombre de esta persona. Pídele que verifique el número.`,
        })
      }
    }
    if (Array.isArray(input.items) && input.items.length > 0) {
      if (input.confirmed !== true) {
        return JSON.stringify({
          error: 'confirmation_required',
          message:
            'Todavía no edites el pedido. Confirma con el cliente la lista exacta de variantes y tallas; después vuelve a llamar esta herramienta con confirmed=true.',
        })
      }
      if (!localOrders) {
        return JSON.stringify({
          error: 'no_catalog_context',
          message: 'No puedo validar las variantes de este pedido en esta conversación.',
        })
      }
      const items = input.items.map((item) => ({
        variantId: String(item.variant_id ?? '').replace(/\D/g, ''),
        quantity: Math.floor(Number(item.quantity)),
        free: item.free === true,
      }))
      if (
        items.some(
          (item) =>
            !item.variantId ||
            !Number.isFinite(item.quantity) ||
            item.quantity <= 0 ||
            item.quantity > 20,
        )
      ) {
        return JSON.stringify({
          error: 'invalid_items',
          message: 'La lista final contiene una variante o cantidad inválida.',
        })
      }
      const { data: catalog, error: catalogError } = await localOrders.db
        .from('shopify_products')
        .select('id,title,raw,allowed_offers')
        .eq('workspace_id', localOrders.workspaceId)
        .eq('platform', 'shopify')
      if (catalogError) {
        return JSON.stringify({ error: 'catalog_unavailable', message: 'No pude validar el catálogo.' })
      }
      const knownVariants = new Set<string>()
      const offers: Array<{ label: string; conditions: string; units: number }> = []
      for (const product of catalog ?? []) {
        const row = product as Record<string, unknown>
        const raw = row.raw as { variants?: Array<{ id?: string | number }> } | null
        for (const variant of Array.isArray(raw?.variants) ? raw.variants : []) {
          if (variant?.id != null) knownVariants.add(String(variant.id).replace(/\D/g, ''))
        }
        for (const offer of Array.isArray(row.allowed_offers)
          ? (row.allowed_offers as Record<string, unknown>[])
          : []) {
          const units = Number(offer?.units)
          if (Number.isFinite(units) && units > 0) {
            offers.push({
              label: String(offer?.label ?? ''),
              conditions: String(offer?.conditions ?? ''),
              units,
            })
          }
        }
      }
      const unknown = items.map((item) => item.variantId).filter((id) => !knownVariants.has(id))
      if (unknown.length) {
        return JSON.stringify({
          error: 'unknown_variants',
          variant_ids: unknown,
          message:
            'Una o más variantes no pertenecen al catálogo actual. Vuelve a consultar el producto; no inventes IDs.',
        })
      }
      const totalUnits = items.reduce((sum, item) => sum + item.quantity, 0)
      const hasFreeItems = items.some((item) => item.free)
      const freeOffer = offers.some(
        (offer) =>
          offer.units === totalUnits &&
          /gratis|free|2\s*[x×]\s*1|ll[eé]vate\s*2|segund[oa]/i.test(
            `${offer.label} ${offer.conditions}`,
          ),
      )
      if (hasFreeItems && !freeOffer) {
        return JSON.stringify({
          error: 'offer_not_allowed',
          message:
            'El catálogo no tiene una oferta vigente que autorice unidades gratis para esa cantidad. No edites ni prometas el regalo.',
        })
      }
      const result = await replaceUnfulfilledOrderItems(
        {
          shopDomain: shopify.shopDomain,
          accessToken: shopify.accessToken,
          apiVersion: shopify.apiVersion,
        },
        pedido,
        items,
        String(input.reason || 'Variantes y oferta confirmadas por el cliente').slice(0, 255),
      )
      if (!result.ok && result.error === 'missing_scope') {
        return JSON.stringify({
          error: 'missing_scope',
          scope: result.scope,
          message:
            'La tienda no dio permiso para editar pedidos. No afirmes que quedó corregido; avisa que una persona debe revisarlo.',
        })
      }
      if (!result.ok) {
        const committedButUnverified = result.uncertain === true || result.error?.startsWith('updated_but_') === true
        return JSON.stringify({
          error: committedButUnverified ? 'update_unverified' : 'update_failed',
          detail: result.error,
          verified_items: result.verifiedItems,
          message:
            committedButUnverified
              ? 'Shopify recibió una edición, pero la lectura posterior no confirmó exactamente las variantes. No afirmes que quedó listo ni lo envíes a logística; deja el caso para revisión operativa.'
              : 'No pude corregir el pedido. No afirmes que quedó listo ni lo envíes a logística.',
        })
      }
      const alreadyInDropi = (result.tags ?? []).some((tag) =>
        /order\s+sent\s+to\s+dropi/i.test(tag),
      )
      if (alreadyInDropi && localOrders.conversationId) {
        await aplicarDesenlace(
          localOrders.db,
          localOrders.conversationId,
          'problema_detectado',
          `Shopify quedó corregido, pero el pedido ${String(input.order_number || pedido)} ya había sido enviado a Dropi. Sincroniza allí las mismas variantes antes de despachar. No agregues notas al proveedor.`,
        )
      }
      return JSON.stringify({
        ok: true,
        items: result.items,
        verified_items: result.verifiedItems,
        verified_total: result.total,
        logistics_sync: alreadyInDropi ? 'manual_required' : 'not_required_yet',
        message:
          alreadyInDropi
            ? 'Pedido corregido y verificado en Shopify. Ya estaba enviado a logística, así que dejé una alerta para sincronizar allí las mismas variantes antes del despacho. No afirmes que la sincronización logística terminó.'
            : 'Pedido corregido y verificado en Shopify con las variantes activas confirmadas. Ya puedes resumir exactamente las referencias, tallas y total verificados.',
      })
    }
    const addUnits = Math.floor(Number(input.add_units))
    if (!Number.isFinite(addUnits) || addUnits <= 0) {
      return JSON.stringify({
        error: 'invalid_units',
        message: 'Pasa cuántas unidades extra sumar (número entero ≥ 1).',
      })
    }
    const result = await addUnitsToFirstLineItem(
      {
        shopDomain: shopify.shopDomain,
        accessToken: shopify.accessToken,
        apiVersion: shopify.apiVersion,
      },
      pedido,
      addUnits
    )
    // Un permiso que la tienda no otorgó no se arregla reintentando ni lo
    // resuelve el equipo mirando el pedido: hay que reconectar la tienda. Si el
    // agente no lo distingue, promete un arreglo que nunca llega.
    if (!result.ok && result.error === 'missing_scope') {
      return JSON.stringify({
        error: 'missing_scope',
        scope: result.scope,
        message:
          'La tienda no dio permiso para editar pedidos. No le prometas las unidades extra: dile que el equipo lo resuelve y avisa que hay que reconectar Shopify desde Ajustes.',
      })
    }
    if (!result.ok) {
      return JSON.stringify({
        error: 'update_failed',
        message:
          'No pude actualizar el pedido. No le prometas al cliente las unidades extra; ofrece que lo revise el equipo.',
      })
    }
    return JSON.stringify({
      ok: true,
      added_units: result.added_units,
      message: `Se agregaron ${result.added_units} unidad(es) al pedido.`,
    })
  }
  if (toolName === 'lookup_order') {
    const input = (toolInput ?? {}) as {
      include_screenshot?: boolean
      order_number?: string
      customer_phone?: string
      customer_email?: string
      reason?: string
    }
    // Los teléfonos colombianos suelen llegar como diez dígitos. Si el modelo
    // los puso por error en `order_number`, se corrige aquí para que no termine
    // diciendo que "no existe ese pedido" cuando el cliente sí dio su teléfono.
    const telefonoEnNumero = telefonoColombianoEnCampoPedido(input.order_number)
    const numero = telefonoEnNumero ? undefined : input.order_number?.trim()
    const telefono = telefonoDeclarado(input.customer_phone) ?? telefonoEnNumero
    const correo = correoDeclarado(input.customer_email)

    // Sin Shopify pero con Tiendanube o WooCommerce, se consulta la API de
    // ESA plataforma. El comercio conectó una tienda: que su bot conteste
    // "no tengo Shopify" ante "¿dónde está mi pedido?" es una respuesta
    // cierta e inservible.
    if (!shopify && otherStore) {
      const quien = pruebaDeIdentidad(
        localOrders?.channel,
        correo ?? otherStore.customerEmail,
        telefono ?? otherStore.customerPhone
      )
      const r = numero
        ? await lookupOrderNonShopify(
            otherStore,
            'order_by_number',
            numero,
            // En Tiendanube y Woo el número es correlativo y no prueba de quién
            // es el pedido. Ver esDeQuienPregunta() y pruebaDeIdentidad().
            quien
          )
        : quien.email
          ? await lookupOrderNonShopify(otherStore, 'order_by_email', quien.email)
          : quien.phone
            ? await lookupOrderNonShopify(otherStore, 'order_by_phone', quien.phone)
            : { found: false as const }
      if (!r.found) {
        // Igual que en Shopify: quien compró por el chat web todavía no tiene
        // correo ni teléfono con qué probar que el pedido es suyo, pero la fila
        // espejo sí sabe de quién es.
        if (localOrders) {
          const local = await lookupLocalOrders(localOrders, numero, quien)
          if ((JSON.parse(local) as { found?: boolean }).found) return local
        }
        return JSON.stringify({
          found: false,
          orders: [],
          searched_by: quien.phone ? 'phone' : quien.email ? 'email' : numero ? 'order_number' : 'none',
          instruction: instruccionNoEncontrado({
            numero,
            phone: quien.phone,
            email: quien.email,
          }),
        })
      }
      return JSON.stringify({ found: true, orders: [r.vars] })
    }
    // Sin Shopify, pero con pedidos espejados (Mercado Libre), se contesta con
    // lo guardado. Antes esto devolvía "el workspace no tiene Shopify
    // conectado" a una compradora de Mercado Libre preguntando por SU pedido,
    // que es una respuesta a la vez cierta e inútil.
    if (!shopify && localOrders) {
      return await lookupLocalOrders(
        localOrders,
        numero,
        pruebaDeIdentidad(localOrders.channel, correo, telefono)
      )
    }
    if (!shopify) {
      return JSON.stringify({
        error: 'no_shopify_connection',
        message: 'El workspace no tiene ninguna tienda conectada.',
      })
    }
    // La identidad que se le pasa a Shopify es la que el canal PROBÓ. En el
    // chat web el correo lo escribió el visitante, así que no sirve de prueba;
    // su pedido sale de la fila espejo, más abajo.
    const quien = pruebaDeIdentidad(
      shopify.channel ?? localOrders?.channel,
      correo ?? shopify.customerEmail,
      telefono ?? shopify.customerPhone
    )
    // Primero la copia local: tiene TODOS los pedidos de la tienda con su
    // guía, la mantienen al día los webhooks, y compara el teléfono en
    // cualquier formato. La búsqueda de clientes de Shopify compara el
    // teléfono literal ("5492954543767" no encuentra "2954543767") y sólo ve
    // los últimos 60 días: con ella sola, casi nadie encontraba su pedido.
    const local = localOrders
      ? (JSON.parse(await lookupLocalOrders(localOrders, numero, quien)) as { found?: boolean; orders?: unknown[] })
      : null
    const result = local?.found
      ? { found: true, orders: local.orders ?? [] }
      : await lookupCustomerOrders({
          shopDomain: shopify.shopDomain,
          accessToken: shopify.accessToken,
          apiVersion: shopify.apiVersion,
          customerPhone: quien.phone,
          customerEmail: quien.email,
          orderNumber: numero,
        })
    // Shopify sólo devuelve los pedidos que se le pueden ATRIBUIR a esta
    // persona por teléfono o correo, y quien escribe por el chat web no tiene
    // ninguno de los dos hasta que se identifica. Resultado: el pedido que el
    // agente acababa de crear en esa misma conversación le contestaba
    // "no se encontró ningún pedido". La fila espejo sí sabe de quién es —
    // está atada al contacto — así que se contesta con ella.
    if (!result.found) {
      // Travel the explicit "don't invent" instruction with the empty
      // result so the model never paraphrases "found:false" into
      // "tu pedido está en proceso". Local to the failure case so it
      // doesn't grow the system prompt on every turn.
      return JSON.stringify({
        found: false,
        orders: [],
        searched_by: quien.phone ? 'phone' : quien.email ? 'email' : numero ? 'order_number' : 'none',
        instruction: instruccionNoEncontrado({
          numero,
          phone: quien.phone,
          email: quien.email,
        }),
      })
    }
    let screenshot: string | undefined
    if (input.include_screenshot) {
      if (!numero || !localOrders?.queueOrderScreenshot || localOrders.simulacion) screenshot = 'unavailable'
      else {
        try { await localOrders.queueOrderScreenshot(numero); screenshot = 'queued_with_reply' }
        catch { screenshot = 'unavailable' }
      }
    }
    return JSON.stringify({ ...result, screenshot, instruction: screenshot === 'unavailable' ? 'La captura no está disponible. Explica las referencias por texto; no digas que enviaste una imagen.' : undefined })
  }
  if (toolName === 'create_checkout') {
    // Sin Shopify, el link se arma para la tienda que SÍ tenga el comercio.
    // Antes esto contestaba "no tenés Shopify conectado" a un comercio de
    // Tiendanube que nunca tuvo Shopify: su agente conversaba, recomendaba y
    // no podía cerrar una sola venta.
    if (!shopify && otherStore && localOrders) {
      const input = (toolInput ?? {}) as {
        quantity?: number
        items?: Array<{ variant_id: string; quantity?: number }>
      }
      const primero = input.items?.[0]
      const id = String(primero?.variant_id ?? '').trim()
      if (!id) {
        return JSON.stringify({
          error: 'sin_producto',
          message: 'Falta cuál producto. Usa buscar_producto para encontrarlo y vuelve a intentar con su id.',
        })
      }
      const cantidad = Number(primero?.quantity ?? input.quantity ?? 1)
      // Cada tienda quiere un id distinto, y el modelo tiene UNO solo.
      //
      // `buscar_producto` le da el de la primera VARIANTE, que es lo que
      // necesitan `create_order` y el carrito de WooCommerce. Pero el carrito
      // de Tiendanube quiere el id del PRODUCTO: pasarle el de la variante da
      // "Product could not be found" y el link no agrega nada. Así que acá se
      // resuelve contra el catálogo en vez de confiar en cuál mandó.
      const { data: fila } = await localOrders.db
        .from('shopify_products')
        .select('url, title, external_id, raw')
        .eq('workspace_id', localOrders.workspaceId)
        .or(/^\d+$/.test(id) ? `external_id.eq.${id},raw.cs.{"variants":[{"id":${id}}]}` : `id.eq.${id}`)
        .limit(1)
        .maybeSingle()
      const p = fila as {
        url?: string | null
        external_id?: number | string | null
        raw?: { variants?: Array<{ id?: number | string }> } | null
      } | null
      const esTiendanube = (otherStore.platform || '').toLowerCase() === 'tiendanube'
      const idParaLaTienda = esTiendanube
        ? String(p?.external_id ?? id)
        : // Woo quiere la VARIACIÓN. Si llegó el id del producto, se usa su
          // primera variante, que es la misma que ofrece `buscar_producto`.
          String(/^\d+$/.test(id) && String(p?.external_id ?? '') !== id ? id : (p?.raw?.variants?.[0]?.id ?? id))
      const link = armarLinkDeCompra({
        tienda: otherStore,
        id: idParaLaTienda,
        cantidad,
        productUrl: p?.url ?? null,
      })
      if (!link) {
        return JSON.stringify({
          error: 'sin_link',
          message:
            'No pude armar el link de compra. Dile que lo busque en la tienda y ofrécele pasarle el enlace del producto.',
        })
      }
      return JSON.stringify({
        checkout_url: link.url,
        // Lo que el chat web necesita para cargar el carrito sin sacar a nadie
        // de la conversación.
        cart: link.carrito,
        offer_label: `${cantidad} unidad(es)`,
        message: link.cargaSola
          ? 'Pásale el link: lo lleva a pagar con el producto ya cargado.'
          : 'Pásale el link del producto. NO le digas que ya se lo dejaste en el carrito: desde ahí tiene que agregarlo.',
      })
    }
    if (!shopify) {
      return JSON.stringify({
        error: 'no_shopify_connection',
        message: 'El workspace no tiene ninguna tienda conectada.',
      })
    }
    const input = (toolInput ?? {}) as {
      offer?: string
      quantity?: number
      items?: Array<{ variant_id: string; quantity?: number }>
      discount_code?: string
      payment_hint?: PaymentHint
    }
    const config = shopify.config ?? null
    const bundleMode = !!(config?.enabled && config.offers && config.offers.length > 0)
    // Con `items` la clienta armó su propio carrito: no eligió ninguna de las
    // ofertas del combo, así que exigirle una acá sería rechazar la compra.
    const armaSuCarrito = Array.isArray(input.items) && input.items.length > 0
    if (bundleMode && !armaSuCarrito && !input.offer) {
      const valid = (config?.offers ?? []).map((o) => o.key).join(' | ')
      return JSON.stringify({
        error: 'missing_offer',
        message: `Pasa la oferta (${valid}).`,
      })
    }
    const result = await createCheckoutLink(
      {
        offer: input.offer,
        quantity: input.quantity,
        items: input.items,
        discount_code: input.discount_code,
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
        // Sin esto el enlace salía sin `attributes[riverz_wvid]` y la
        // atribución del chat web no llegaba a ocurrir NUNCA: el pedido volvía
        // por el webhook sin el id, `attributeWebchatOrder` cortaba en la
        // primera línea y el comercio veía 0 pedidos y 0 ingresos por el canal.
        // El runner lo venía cargando y esta línea faltaba.
        visitorId: shopify.visitorId ?? null,
      }
    )
    // Registrar "pago pendiente" en la conversación: hace al asistente
    // consciente de que mandó el link y habilita el follow-up de
    // recuperación si el cliente no paga. Fail-soft. No en dry-run.
    if (!shopify.dryRun && shopify.conversationId && !('error' in result) && result.checkout_url) {
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
    // Sin Shopify, el pedido se crea en la tienda que SÍ tenga el comercio.
    // Tiendanube y WooCommerce podían conversar y no podían vender: llegaban
    // hasta "te paso el link" y ahí se terminaba, con las credenciales de
    // escritura ya otorgadas.
    if (!shopify && otherStore && localOrders) {
      const input = (toolInput ?? {}) as {
        quantity?: number
        items?: Array<{ variant_id: string; quantity?: number }>
        customer_name?: string
        customer_email?: string
        customer_phone?: string
        shipping_address?: ShippingAddressInput
        address_confirmed_by_customer?: boolean
        note?: string
        confirmed?: boolean
      }
      // La confirmación explícita es el mismo freno que en Shopify: un pedido
      // creado por las dudas es una venta que nadie pidió.
      if (input.confirmed !== true) {
        return JSON.stringify({
          error: 'not_confirmed',
          message: 'Confirma con la clienta antes de crear el pedido.',
        })
      }
      const lineas = (input.items ?? []).map((i) => ({
        variant_id: String(i.variant_id ?? ''),
        quantity: Number(i.quantity ?? 1),
      }))
      const checkedAddress = await validateAddressBeforeOrder(
        localOrders,
        input.shipping_address,
        input.address_confirmed_by_customer === true,
      )
      if (!checkedAddress.ok) return checkedAddress.toolResult
      input.shipping_address = checkedAddress.address
      const res = await crearPedidoLocalConEspejo(
        localOrders.db,
        {
          workspaceId: localOrders.workspaceId,
          lineas,
          cliente: {
            name: input.customer_name ?? null,
            email: input.customer_email ?? null,
            phone: input.customer_phone ?? null,
            address: input.shipping_address
              ? {
                  address1: input.shipping_address.address1 ?? null,
                  address2: input.shipping_address.address2 ?? null,
                  city: input.shipping_address.city ?? null,
                  province: input.shipping_address.province ?? null,
                  zip: input.shipping_address.zip ?? null,
                  country: input.shipping_address.country ?? null,
                }
              : null,
          },
          nota: input.note ?? null,
        },
        {
          contactId: localOrders.contactId,
          agentId: localOrders.agentId ?? null,
          conversationId: localOrders.conversationId ?? null,
          channel: localOrders.channel ?? null,
          createdBy: 'ai',
        }
      )
      if ('error' in res) {
        // Al modelo se le dice poco a propósito: el detalle de por qué la
        // tienda rechazó el pedido no es algo que la clienta tenga que leer.
        // Pero en algún lado tiene que quedar. Sin esto, un comercio cuya
        // tienda rechaza todos los pedidos ve "no pude crear el pedido" y no
        // hay forma de averiguar el motivo: ni consola, ni fila, ni nada.
        console.error(`[create_order] ${localOrders.workspaceId}: ${res.error}, ${res.message}`)
        return JSON.stringify({
          ok: false,
          message:
            res.error === 'sin_lineas'
              ? 'Falta decir qué producto lleva. Usa buscar_producto para obtener su variant_id.'
              : 'No pude crear el pedido. No le digas a la clienta que quedó hecho; ofrece que lo confirme el equipo.',
        })
      }
      return JSON.stringify({
        ok: true,
        order_number: res.order_number,
        total: res.total,
        currency: res.currency,
        payment_url: res.pay_url,
        message: res.pay_url
          ? 'El pedido quedó creado y pendiente de pago. Pásale el link para que lo abone.'
          : 'El pedido quedó creado y pendiente de pago. Cuéntale cómo seguir con el pago.',
      })
    }
    if (!shopify) {
      return JSON.stringify({
        error: 'no_shopify_connection',
        message: 'El workspace no tiene una tienda conectada donde crear el pedido.',
      })
    }
    if (!shopify.canCreateOrders) {
      return JSON.stringify({
        error: 'orders_disabled',
        message:
          'Este asistente no tiene habilitado crear pedidos. No prometas el pedido; ofrece pasar la conversación a una persona del equipo.',
      })
    }
    const input = (toolInput ?? {}) as {
      items?: Array<{ variant_id?: string; quantity?: number }>
      offer?: string
      quantity?: number
      payment_hint?: PaymentHint
      customer_name?: string
      customer_phone?: string
      customer_email?: string
      shipping_address?: ShippingAddressInput
      address_confirmed_by_customer?: boolean
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
          'No crees el pedido hasta que la clienta confirme explícitamente. Muéstrale el resumen (producto, cantidad, total y dirección si aplica) y pídele que confirme; recién ahí llama create_order con confirmed=true.',
      })
    }
    const config = shopify.config ?? null
    const orderInput: CreateOrderInput = {
      // Lo que el modelo eligió, que hasta acá se perdía en el camino de
      // Shopify aunque la ficha de la herramienta se lo pidiera.
      items: input.items,
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
        message: '(Simulación) En producción crearía el pedido real en Shopify con estos datos. No se creó nada.',
        echo: orderInput,
      })
    }

    if (localOrders) {
      const checkedAddress = await validateAddressBeforeOrder(
        localOrders,
        input.shipping_address,
        input.address_confirmed_by_customer === true,
      )
      if (!checkedAddress.ok) return checkedAddress.toolResult
      orderInput.shipping_address = checkedAddress.address
    }

    // El pedido en Shopify + su espejo en Riverz (tabla orders y, si vino de
    // Instagram, el libro de atribución) van juntos en `crearPedidoConEspejo`.
    const result = await crearPedidoConEspejo(
      orderInput,
      {
        shopDomain: shopify.shopDomain,
        accessToken: shopify.accessToken,
        apiVersion: shopify.apiVersion,
        pinnedVariantId: shopify.pinnedVariantId ?? null,
        customerPhone: shopify.customerPhone ?? null,
        customerEmail: shopify.customerEmail ?? null,
        config,
        currency: shopify.currency ?? null,
      },
      {
        workspaceId: shopify.workspaceId,
        contactId: shopify.contactId,
        agentId: shopify.agentId,
        conversationId: shopify.conversationId,
        channel: shopify.channel,
        createdBy: 'ai',
      }
    )

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
/**
 * Pedidos espejados del contacto, en el mismo formato que la búsqueda viva.
 *
 * La copia local de la tienda está completa (cada pedido, su guía y su
 * transportista), pero casi ningún pedido queda atado a un contacto: el
 * contacto de WhatsApp nace después de la compra. Buscar sólo por
 * `contact_id` dejaba sin respuesta a quien preguntaba "¿dónde está mi
 * pedido?" teniendo el pedido ahí. Ahora también vale la identidad que el
 * canal PROBÓ —su teléfono, su correo—, con la misma regla que la búsqueda
 * viva: un pedido se muestra sólo si es de quien pregunta.
 */
async function lookupLocalOrders(
  ctx: LocalOrdersContext,
  numero?: string,
  identidad?: { phone?: string; email?: string }
): Promise<string> {
  const email = identidad?.email?.trim().toLowerCase() || null
  const clave = claveDeTelefono(identidad?.phone)
  let data: unknown[] | null = null
  try {
    let q = ctx.db
      .from('orders')
      .select(
        'order_number, currency, total_price, line_items, financial_status, fulfillment_status, status, tracking_number, tracking_company, tracking_url, shipping_status, order_status_url, shipping_address, payment_method, created_at, contact_id, customer_email, customer_phone, dropi_evidence, dropi_observed_at'
      )
      .eq('workspace_id', ctx.workspaceId)
      .order('created_at', { ascending: false })
      .limit(numero ? 10 : 30)
    const filtro = numero ? filtroDeNumero(numero) : null
    if (filtro) {
      q = q.or(filtro)
    } else {
      const quien = ctx.contactId ? [`contact_id.eq.${ctx.contactId}`] : []
      if (email && /^[^\s,()"*]+@[^\s,()"*]+$/.test(email)) quien.push(`customer_email.ilike.${email}`)
      // Grueso en la base, fino abajo: los teléfonos se guardan en cualquier
      // formato, así que se traen los que terminan igual y se comparan enteros.
      if (clave) {
        quien.push(`customer_phone.ilike.*${clave.slice(-4)}`)
        quien.push(`shipping_address->>phone.ilike.*${clave.slice(-4)}`)
      }
      if (!quien.length) return JSON.stringify({ found: false, orders: [], instruction: instruccionNoEncontrado({ numero }) })
      q = q.or(quien.join(','))
    }
    data = (await q).data
  } catch (err) {
    // Sin la copia local todavía queda la tienda en vivo: no se corta el turno.
    console.warn('[lookup_order] pedidos locales:', err)
  }

  // El número de pedido se adivina: sin esta comprobación, cualquiera que
  // escriba "#1042" vería la guía y la dirección de otra compradora.
  const esSuyo = (o: Record<string, unknown>) =>
    o.contact_id === ctx.contactId ||
    (email !== null && String(o.customer_email ?? '').trim().toLowerCase() === email) ||
    (clave !== null &&
      [o.customer_phone, (o.shipping_address as { phone?: unknown } | null)?.phone].some(
        (t) => claveDeTelefono(typeof t === 'string' ? t : null) === clave
      ))
  const orders = ((data ?? []) as Array<Record<string, unknown>>)
    .filter(esSuyo)
    .slice(0, 5)
    .map(pedidoLocalParaElModelo)
  if (orders.length === 0) {
    return JSON.stringify({
      found: false,
      orders: [],
      instruction: instruccionNoEncontrado({ numero, phone: identidad?.phone, email: identidad?.email }),
    })
  }
  return JSON.stringify({ found: true, orders })
}

/** Lo que el modelo necesita del pedido, sin los datos con que se comprobó de quién es. */
function pedidoLocalParaElModelo(o: Record<string, unknown>): Record<string, unknown> {
  const envio = (o.shipping_address ?? null) as Record<string, unknown> | null
  const guia = typeof o.tracking_number === 'string' ? o.tracking_number : null
  const transportista = typeof o.tracking_company === 'string' ? o.tracking_company : null
  return {
    order_number: o.order_number,
    dropi: dropiContextForModel(o.dropi_evidence, o.dropi_observed_at),
    created_at: o.created_at,
    status: o.status,
    financial_status: o.financial_status,
    fulfillment_status: o.fulfillment_status,
    payment_method: o.payment_method,
    total_price: o.total_price,
    currency: o.currency,
    line_items: o.line_items,
    tracking_number: guia,
    tracking_company: transportista,
    tracking_url:
      (typeof o.tracking_url === 'string' && o.tracking_url) ||
      resolveCarrierTrackingUrl(transportista, guia) ||
      null,
    shipping_status: o.shipping_status,
    order_status_url: o.order_status_url,
    shipping_address: envio
      ? {
          address1: envio.address1 ?? null,
          city: envio.city ?? null,
          province: envio.province ?? null,
          zip: envio.zip ?? null,
        }
      : null,
  }
}

/**
 * El prompt del asistente partido según con quién se comparte.
 *
 * El proveedor cachea por prefijo exacto: lo primero que no cambia se escribe
 * una vez y las peticiones siguientes lo leen a una décima parte. Por eso va
 * de lo más compartido a lo menos, y cada capa con la caché que le sirve:
 *
 * - `estable`: lo del agente, igual en todos sus chats. Una hora: con una
 *   consulta cada pocos minutos se escribe una vez por hora y no una por chat.
 * - `producto`: la ficha del producto del que se habla, igual en todos los
 *   chats sobre ese producto. Una hora.
 * - `cliente`: lo de esta persona. Cinco minutos: lo relee el bucle de
 *   herramientas y la respuesta que sigue.
 * - `turno`: lo que cambia con cada mensaje. Sin caché.
 */
export interface SystemPorCapas {
  estable: string
  producto?: string
  cliente: string
  turno?: string
}

/** Por debajo del mínimo que exige el proveedor la marca se ignora. */
const CACHE_MIN_CHARS = 8000

/**
 * `system` listo para mandar, con sus marcas de caché.
 *
 * La política de seguridad cierra el último bloque: `guardedAnthropicFetch`
 * la busca ahí y, si no está, agrega un bloque aparte.
 */
export function systemConCache(
  system: string | SystemPorCapas
): Anthropic.TextBlockParam[] | string {
  if (typeof system === 'string') {
    const protegido = secureSystemPrompt(system)
    return protegido.length >= CACHE_MIN_CHARS
      ? [{ type: 'text', text: protegido, cache_control: { type: 'ephemeral' } }]
      : protegido
  }
  const capas = [
    { texto: system.estable, hora: true, cachear: true },
    { texto: system.producto ?? '', hora: true, cachear: true },
    { texto: system.cliente, hora: false, cachear: true },
    { texto: system.turno ?? '', hora: false, cachear: false },
  ].filter((c) => c.texto.trim())
  if (capas.length === 0) return secureSystemPrompt('')
  const largo = capas.reduce((n, c) => n + c.texto.length, 0)
  return capas.map((c, i): Anthropic.TextBlockParam => {
    const text =
      i === capas.length - 1 ? secureSystemPrompt(c.texto) : redactModelSecrets(c.texto)
    if (!c.cachear || largo < CACHE_MIN_CHARS) return { type: 'text', text }
    return {
      type: 'text',
      text,
      cache_control: c.hora ? { type: 'ephemeral', ttl: '1h' } : { type: 'ephemeral' },
    }
  })
}

/**
 * Los mensajes con la marca de cinco minutos en el último del cliente.
 *
 * Cada vuelta del bucle de herramientas vuelve a mandar la conversación
 * entera; con la marca, la vuelta siguiente la lee de caché. Va en una copia y
 * sólo en el último: las marcas viejas contarían contra el tope de cuatro.
 */
export function mensajesConCache(
  messages: Anthropic.MessageParam[]
): Anthropic.MessageParam[] {
  const i = messages.length - 1
  const ultimo = messages[i]
  if (!ultimo || ultimo.role !== 'user') return messages
  const bloques: Anthropic.ContentBlockParam[] =
    typeof ultimo.content === 'string'
      ? [{ type: 'text', text: ultimo.content }]
      : [...ultimo.content]
  const j = bloques.length - 1
  const bloque = bloques[j]
  const marcable =
    bloque &&
    (bloque.type === 'text'
      ? bloque.text.trim().length > 0
      : bloque.type === 'image' || bloque.type === 'document' || bloque.type === 'tool_result')
  if (!marcable) return messages
  bloques[j] = { ...bloque, cache_control: { type: 'ephemeral' } } as Anthropic.ContentBlockParam
  return [...messages.slice(0, i), { ...ultimo, content: bloques }]
}

export async function runWithTools(
  client: Anthropic,
  args: {
    model: string
    reasoningEffort?: 'low' | 'high'
    max_tokens: number
    /** Un texto, o las capas de `SystemPorCapas` para cachear lo compartido. */
    system: string | SystemPorCapas
    messages: Anthropic.MessageParam[]
    /** Incluye las de SERVIDOR (la busqueda web), que no ejecutamos aca. */
    tools: Anthropic.ToolUnion[]
    shopify: ShopifyToolContext | null
    /** Present → the escalate_to_call tool can place a phone call. */
    voice?: VoiceEscalationContext | null
    /** Present → lookup_order puede responder con los pedidos ya espejados
     *  cuando el canal no permite consultarlos en vivo. */
    localOrders?: LocalOrdersContext | null
    /** Present → la tienda del comercio no es Shopify: lookup_order consulta
     *  la API de Tiendanube o WooCommerce. */
    otherStore?: OtherStoreContext | null
    /** Cuántas herramientas con efecto real corrieron. Lo mira quien reintenta:
     *  volver a empezar después de crear un pedido crea el segundo. */
    efectos?: { ejecutados: number }
  }
): Promise<{
  text: string
  promptTokens: number
  completionTokens: number
  /**
   * Tokens que se leyeron de la caché y tokens que costó escribirla.
   *
   * Van aparte porque Anthropic los cobra distinto —la lectura sale una décima
   * parte, la escritura un 25% más— y porque **`input_tokens` NO los incluye**.
   * Sumarlos al costo era la mitad que faltaba: sin esto, todo el gasto de IA
   * que muestra la plataforma es un piso, no una medición.
   */
  cacheReadTokens: number
  cacheWriteTokens: number
  /** La parte de `cacheWriteTokens` que se escribió con la caché de una hora,
   *  que cuesta el doble de la entrada y no 1,25x. */
  cacheWrite1hTokens: number
  iterations: number
  /**
   * Qué herramientas llamó, en orden y con repeticiones.
   *
   * Se devolvía sólo el número de vueltas, así que después no había forma de
   * contestar "¿por qué dijo eso?": la respuesta suele estar en que consultó
   * un pedido, o en que no consultó nada.
   */
  herramientas: string[]
  /** True if we exhausted AGENTIC_LOOP_MAX_ITERS still asking for tools
   *  and had to force a final no-tools call. The caller may want to
   *  swap in a fallback message if the model returned empty text. */
  truncated: boolean
}> {
  // This independent fork exposes vehicle sales tools, never commerce/order tools.
  if (isDealerDeployment()) args = {
    ...args,
    tools: dealerToolset(args.tools, Boolean(args.localOrders)),
    system: typeof args.system === 'string'
      ? `${args.system}\n\n${DEALER_SYSTEM}`
      : { ...args.system, turno: `${args.system.turno ?? ''}\n\n${DEALER_SYSTEM}` },
  };
  let messages: Anthropic.MessageParam[] = [...args.messages]
  let promptTokens = 0
  let cacheReadTokens = 0
  let cacheWriteTokens = 0
  let cacheWrite1hTokens = 0
  let completionTokens = 0
  const herramientas: string[] = []
  let iter = 0

  // El system prompt se manda cacheable.
  //
  // Es el mismo texto en cada vuelta del bucle de herramientas —hasta seis
  // llamadas por turno— y en cada turno siguiente de la misma conversación.
  // Sin esto se pagaba entero todas las veces.
  //
  // Un texto suelto va entero con la caché de CINCO minutos, no de una hora:
  // lleva los datos de cada cliente, así que nunca se comparte entre chats, y
  // el 55% de los chats recibe una sola respuesta. Con la de una hora
  // (2026-09-17 al 29) la escritura, que cuesta el doble de la entrada, era el
  // 89% del costo: 4,95 ¢ por respuesta, más que no cachear nada (4,49 ¢).
  //
  // Las capas de `SystemPorCapas` sí se comparten: lo del agente y la ficha
  // del producto van con la de una hora, que es la única que dura entre un
  // chat y el siguiente, y lo de la persona con la de cinco minutos.
  const system = systemConCache(args.system)
  const marcar = typeof args.system === 'string' ? (m: Anthropic.MessageParam[]) => m : mensajesConCache

  // Las pausas NO gastan vuelta.
  //
  // `pause_turn` no es el modelo pidiendo otra herramienta: es Anthropic
  // diciendo "me detuve a mitad de la búsqueda, seguí". Contarla contra el
  // presupuesto significaba que con la búsqueda en internet prendida —hasta
  // tres por respuesta— tres pausas se comían la mitad de las seis vueltas, y
  // el turno terminaba en la llamada forzada sin herramientas: al cliente le
  // salía el "no pude completar la consulta" genérico habiendo tenido la
  // respuesta a mano.
  //
  // Igual tienen tope propio, porque un bucle de pausas sin freno sería una
  // llamada infinita.
  let pausas = 0
  while (iter < AGENTIC_LOOP_MAX_ITERS && pausas <= MAX_PAUSAS) {
    // La vuelta se cuenta al entrar. Se había perdido el 2026-08-30 junto con
    // el cambio de las pausas, y sin ella el bucle de herramientas no tenía
    // tope: cada vuelta de más es una petición que paga el comercio.
    iter += 1
    let response: Anthropic.Message
    try {
      response = await client.messages.create({
        model: args.model,
        max_tokens: args.max_tokens,
        system,
        messages: marcar(messages),
        ...(args.tools.length > 0 ? { tools: args.tools } : {}),
        // Cuánto piensa antes de contestar. `esfuerzo` devuelve {} en Haiku,
        // que rechaza estos dos parámetros con un 400 — así que la misma
        // llamada sirve para los dos modelos.
        //
        // Esfuerzo BAJO a propósito: contestar un DM no es un problema
        // difícil, y lo que se piensa se cobra y se descuenta de max_tokens.
        // Lo que se busca del modelo grande acá no es que razone más, es que
        // no se saltee las reglas.
        ...esfuerzo(args.model, { effort: args.reasoningEffort ?? 'low', pensar: 'adaptive' }),
      })
    } catch (err) {
      // On the FIRST iteration only, retry once after rewriting any
      // document blocks in the last user message to text. Anthropic
      // rejects PDFs exceeding the document block's page/size caps
      // with a 400; without this rescue, the customer sees nothing.
      const isFirstIter = iter === 1
      const isApiError = err instanceof Anthropic.APIError && err.status === 400
      const msg = err instanceof Error ? err.message : String(err)
      const looksLikePdfReject = /document|page|too large|exceeds|invalid.*pdf/i.test(msg)
      if (isFirstIter && isApiError && looksLikePdfReject) {
        messages = rewriteLastUserDocumentToText(messages)
        response = await client.messages.create({
          model: args.model,
          max_tokens: args.max_tokens,
          system,
          messages: marcar(messages),
          ...(args.tools.length > 0 ? { tools: args.tools } : {}),
        })
      } else {
        throw err
      }
    }

    promptTokens += response.usage?.input_tokens ?? 0
    completionTokens += response.usage?.output_tokens ?? 0
    cacheReadTokens += response.usage?.cache_read_input_tokens ?? 0
    cacheWriteTokens += response.usage?.cache_creation_input_tokens ?? 0
    cacheWrite1hTokens += response.usage?.cache_creation?.ephemeral_1h_input_tokens ?? 0

    // El modelo se detuvo a mitad de una herramienta de SERVIDOR (la busqueda
    // web). No hay nada que ejecutar de nuestro lado: se le devuelve lo que
    // lleva escrito y sigue donde iba. Sin esto la respuesta se cortaba en
    // seco y el cliente recibia media frase — o nada.
    if (response.stop_reason === 'pause_turn') {
      anotarDeServidor(response.content, herramientas)
      messages = [...messages, { role: 'assistant', content: response.content }]
      pausas += 1
      // Devuelve la vuelta: la pausa no era del modelo pidiendo trabajo.
      iter -= 1
      continue
    }

    anotarDeServidor(response.content, herramientas)

    if (response.stop_reason !== 'tool_use') {
      const text = response.content
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('')
        .trim()
      return {
        text,
        promptTokens,
        completionTokens,
        cacheReadTokens,
        cacheWriteTokens,
        cacheWrite1hTokens,
        iterations: iter,
        herramientas,
        truncated: false,
      }
    }

    // El modelo pidió ejecutar una o más tools. Le devolvemos el
    // historial completo (assistant con los content blocks tal cual)
    // + un user-turn con los tool_result respectivos, y volvemos al
    // top del loop.
    messages = [...messages, { role: 'assistant', content: response.content }]
    const toolResults: Anthropic.ToolResultBlockParam[] = []
    for (const block of response.content) {
      if (block.type !== 'tool_use') continue
      if (!toolCallAllowed(args.tools, block.name, block.input)) {
        observeTool(block.name,'local','blocked')
        toolResults.push({ type: 'tool_result', tool_use_id: block.id,
          is_error: true, content: JSON.stringify({ error: 'tool_not_allowed' }) })
        continue
      }
      // Se anota ANTES de correrla: si la herramienta explota a mitad, el
      // efecto puede haber ocurrido igual.
      if (args.efectos && (DEJA_HUELLA.has(block.name)
        || args.localOrders?.httpActions?.tools.some(tool => tool.tool.name === block.name && tool.method === 'POST'))) args.efectos.ejecutados += 1
      herramientas.push(block.name)
      const observation=observeTool(block.name,'local','started')
      let result:string
      try {
        result = await runTool(
          block.name,
          block.input,
          args.shopify,
          args.voice ?? null,
          args.localOrders ?? null,
          args.otherStore ?? null
        )
        if (observation) observation.status=publicToolStatus(result)
      } catch(error) { if (observation) observation.status='threw';throw error }
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
      system,
      messages: marcar(messages),
    })
  } catch {
    // Si la llamada final falla (timeout/overloaded/etc.), no lanzamos:
    // devolvemos texto vacío + truncated para que el runner dispare su
    // fallback existente en vez de explotar.
    return {
      text: '',
      promptTokens,
      completionTokens,
      cacheReadTokens,
      cacheWriteTokens,
      cacheWrite1hTokens,
      iterations: iter + 1,
      herramientas,
      truncated: true,
    }
  }
  promptTokens += final.usage?.input_tokens ?? 0
  completionTokens += final.usage?.output_tokens ?? 0
  cacheReadTokens += final.usage?.cache_read_input_tokens ?? 0
  cacheWriteTokens += final.usage?.cache_creation_input_tokens ?? 0
  cacheWrite1hTokens += final.usage?.cache_creation?.ephemeral_1h_input_tokens ?? 0
  const text = final.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim()
  return {
    text,
    promptTokens,
    completionTokens,
    cacheReadTokens,
    cacheWriteTokens,
    cacheWrite1hTokens,
    iterations: iter + 1,
    herramientas,
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
function rewriteLastUserDocumentToText(messages: Anthropic.MessageParam[]): Anthropic.MessageParam[] {
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
          text: '[el cliente envió un PDF que no pude procesar, pídele amablemente que mande solo las páginas relevantes o un resumen]',
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

/**
 * Deja constancia de las herramientas de SERVIDOR que uso el modelo.
 *
 * Las corre Anthropic, no `runTool`, asi que no pasan por el bucle de abajo:
 * sin esto una respuesta escrita mirando internet quedaba registrada como si
 * no hubiera usado ninguna herramienta. Y cada busqueda se cobra, asi que el
 * comercio tiene derecho a ver que se hizo en su nombre.
 */
function anotarDeServidor(content: Anthropic.ContentBlock[], destino: string[]): void {
  for (const block of content) {
    if (block.type === 'server_tool_use') { destino.push(block.name);observeTool(block.name,'hosted','started') }
  }
}

/**
 * Deja el caso en manos de una persona y avisa por WhatsApp.
 *
 * Vive acá y no en el runner porque hay situaciones que una herramienta
 * descubre y el runner no puede ver: un comprobante que no cruza con ningún
 * pedido se sabe recién cuando la búsqueda vuelve vacía.
 *
 * Best-effort: si algo falla, el cliente igual recibe una respuesta que no lo
 * deja peor de lo que estaba.
 */
async function pasarAUnaPersona(
  ctx: LocalOrdersContext,
  escalada: { clase: 'cobro'; urgencia: 'ahora'; porQue: string }
): Promise<void> {
  try {
    if (!ctx.conversationId) return
    // EL ERROR SE MIRA. El cliente de Supabase no lo tira: lo devuelve en el
    // resultado, así que un `await` suelto lo descarta. Así estuvo cortado este
    // camino —la CHECK de la base no aceptaba `comprobante_sin_pedido`— desde
    // que existe y sin una sola línea de log: la IA le decía al cliente "lo
    // estamos verificando y te aviso" y no había nadie del otro lado.
    const { error } = await ctx.db
      .from('conversations')
      .update({
        needs_human_reason: 'comprobante_sin_pedido',
        needs_human_at: new Date().toISOString(),
        needs_human_summary: escalada.porQue,
        status: 'pending',
      })
      .eq('id', ctx.conversationId)
      .is('needs_human_at', null)
    if (error) {
      console.error('[tools] la escalada del comprobante no se pudo escribir:', error.message)
    }

    const { data: c } = await ctx.db
      .from('conversations')
      .select('id, contacts(name, phone)')
      .eq('id', ctx.conversationId)
      .maybeSingle()
    const fila = c as {
      contacts?: { name?: string; phone?: string } | Array<{ name?: string; phone?: string }>
    } | null
    const contacto = Array.isArray(fila?.contacts) ? fila?.contacts[0] : fila?.contacts

    const { avisarEscalada } = await import('./aviso-escalada')
    await avisarEscalada(ctx.db, {
      workspaceId: ctx.workspaceId,
      conversationId: ctx.conversationId,
      cliente: contacto?.name ?? null,
      contacto: contacto?.phone ?? null,
      canal: ctx.channel ?? 'whatsapp',
      escalada,
      ultimoMensaje: null,
    })
  } catch (err) {
    console.error('[tools] no se pudo pasar el caso a una persona:', err)
  }
}
