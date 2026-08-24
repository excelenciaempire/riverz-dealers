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
import Anthropic from '@anthropic-ai/sdk'
import type { SupabaseClient } from '@supabase/supabase-js'
import { lookupCustomerOrders } from '@/lib/shopify/order-lookup'
import {
  resolveStoreForLookup,
  lookupOrderNonShopify,
} from '@/lib/commerce/order-lookup'
import { informarPago } from '@/lib/payments/reported-payment'
import {
  createCheckoutLink,
  fmtMoney,
  type CheckoutConfig,
  type PaymentHint,
} from '@/lib/shopify/create-checkout'
import {
  type CreateOrderInput,
  type ShippingAddressInput,
} from '@/lib/shopify/create-order'
import { crearPedidoConEspejo } from '@/lib/orders/crear'
import { supabaseAdmin } from '@/lib/channels/admin-client'
import { enqueueCall } from '@/lib/voice/queue'
import { addUnitsToFirstLineItem } from '@/lib/shopify/order-edit'
import { searchProducts } from '@/lib/products/search'
import { proponerCancelacion, proponerReembolso } from './postventa'
import { crearLinkDePago } from '@/lib/mercadopago/preference'
import { emitirCupon } from '@/lib/shopify/discounts'
import { crearPedidoLocalConEspejo } from '@/lib/orders/crear'
import { abrirDevolucion, type AbrirDevolucionInput } from '@/lib/returns/open'
import { registrarHueco } from './answer-gaps'
import {
  cerrarConversacion,
  etiquetarContacto,
  verContacto,
  verProducto,
} from './bandeja'

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
    'Programa una LLAMADA telefónica de ti (la IA) al cliente cuando convenga más que seguir por texto: el cliente pide que lo llamen, está frustrado, el tema es urgente o de alto valor, o la conversación se estancó. Úsala con criterio — la mayoría se resuelve por texto. La llamada respeta el horario permitido y no se hace si el cliente pidió no ser llamado. Pasa un motivo corto.',
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

/**
 * Tool `update_order` — upsell EN VIVO durante una llamada de confirmación:
 * agrega unidades al pedido existente en Shopify. Sólo se expone en llamadas
 * de confirmación con upsell activo y cuando hay un order_id en contexto.
 */
export const UPDATE_ORDER_TOOL: Anthropic.Tool = {
  name: 'update_order',
  description:
    'Agrega unidades al pedido que la clienta ya hizo, durante la llamada de confirmación, cuando acepta llevar más (upsell). Pasa cuántas unidades sumar. Actualiza el pedido real en Shopify. Llámala una sola vez, sólo cuando la clienta confirmó que quiere las unidades extra.',
  input_schema: {
    type: 'object' as const,
    properties: {
      add_units: {
        type: 'integer',
        minimum: 1,
        description: 'Cuántas unidades extra sumar al pedido.',
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
    required: ['add_units'],
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
      reason: { type: 'string', description: 'Qué pasó, en las palabras de la clienta.' },
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
      reason: { type: 'string', description: 'El motivo, resumido en pocas palabras.' },
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

export const ETIQUETAR_CONTACTO_TOOL: Anthropic.Tool = {
  name: 'etiquetar_contacto',
  description:
    'Ponle (o sácale) una etiqueta a la persona con la que estás hablando, para que el equipo la encuentre después: "quiere-talle-M", "espera-reposición", "mayorista". Es una nota interna: no se la menciones en la conversación.',
  input_schema: {
    type: 'object' as const,
    properties: {
      etiqueta: { type: 'string', description: 'Nombre corto, en minúsculas y con guiones.' },
      quitar: { type: 'boolean', description: 'true para sacarla en vez de ponerla.' },
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
  items: Array<{ title?: string; quantity?: number; unit_price?: number }>,
): Promise<
  | { items: Array<{ title: string; quantity: number; unit_price: number }> }
  | { error: true; message: string }
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
      return { error: true, message: 'Faltan el nombre o el precio del producto.' }
    }
    const [hit] = await searchProducts(db, { workspaceId, query: title, limit: 1 })
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
            unit_price: { type: 'number', description: 'Precio POR UNIDAD, no el total.' },
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
export function buildDescuentoTool(tope: number): Anthropic.Tool {
  return {
    name: 'ofrecer_descuento',
    description:
      `Genera un cupón de descuento personal para la clienta cuando dude por el precio o pida una rebaja. Puedes ofrecer hasta ${tope}%. Es de un solo uso y sólo para ella. Úsalo con criterio: es para destrabar una venta que si no se pierde, no para regalarlo apenas alguien pregunta. Si ya le diste uno en esta conversación, repítele ESE código en vez de pedir otro.`,
    input_schema: {
      type: 'object' as const,
      properties: {
        percent: {
          type: 'integer',
          minimum: 1,
          maximum: tope,
          description: `Cuánto descontar. El máximo autorizado es ${tope}%.`,
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
    'Busca un pedido del cliente en la tienda del negocio. Úsalo cuando la clienta pregunte por el estado de su pedido, dónde está, cuándo llega, su tracking, o si quiere ver qué compró. Puedes buscar por número de pedido (si lo da) o por su teléfono. Devuelve un resumen del pedido con estado de pago, envío, productos y tracking si existe.',
  input_schema: {
    type: 'object' as const,
    properties: {
      order_number: {
        type: 'string',
        description:
          'Número de pedido (ej. "1042" o "#1042"). Opcional — si no lo tienes, igual busca por el teléfono del cliente.',
      },
      reason: {
        type: 'string',
        description:
          'Por qué llamas esta tool (tracking, estado, devolución, etc.). Una frase corta.',
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
  permiteDescuentos = false,
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
      ? `Si la clienta dijo que va a pagar por ${transferLabel}, pasa "transfer" para aplicarle el descuento de ${fmtMoney(transferAmount!, currency)}. Para todo lo demás (tarjeta, Mercado Pago) usa "card_or_mp".`
      : 'Método de pago. Para tarjeta o Mercado Pago usa "card_or_mp".',
  }

  if (bundleMode) {
    const enumeration = (offers ?? [])
      .map((o) => `${o.key} = ${o.label} (${fmtMoney(o.total, currency)})`)
      .join('. ')
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
              'Varios productos en el MISMO carrito. Úsalo cuando la clienta quiere llevar más de un producto distinto: pasa acá cada uno con su variant_id (el que devuelve buscar_producto) y su cantidad. Un solo link con todo; no le mandes dos links, porque el segundo le vacía el carrito del primero.',
            items: {
              type: 'object',
              properties: {
                variant_id: { type: 'string', description: 'variant_id del producto.' },
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
                    'Si YA le generaste un cupón con ofrecer_descuento, pasalo acá: así el link ya viene con el descuento puesto y la clienta no tiene que tipearlo. No inventes códigos ni uses uno que te dicte la clienta.',
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
            'Varios productos en el MISMO carrito. Úsalo cuando la clienta quiere llevar más de un producto distinto: pasa acá cada uno con su variant_id (el que devuelve buscar_producto) y su cantidad. Un solo link con todo; no le mandes dos links, porque el segundo le vacía el carrito del primero.',
          items: {
            type: 'object',
            properties: {
              variant_id: { type: 'string', description: 'variant_id del producto.' },
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
                  'Si YA le generaste un cupón con ofrecer_descuento, pasalo acá: así el link ya viene con el descuento puesto y la clienta no tiene que tipearlo. No inventes códigos ni uses uno que te dicte la clienta.',
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

  const transferAmount =
    typeof config?.transfer_discount_amount === 'number'
      ? config.transfer_discount_amount
      : null
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
          variant_id: { type: 'string', description: 'variant_id del producto.' },
          quantity: { type: 'integer', minimum: 1, default: 1 },
        },
        required: ['variant_id'],
      },
    },
    customer_name: {
      type: 'string',
      description:
        'Nombre y apellido del cliente para el pedido. Pídelo si no lo sabes.',
    },
    customer_phone: {
      type: 'string',
      description:
        'Teléfono del cliente. Opcional — si no lo pasas se usa el del chat.',
    },
    customer_email: {
      type: 'string',
      description: 'Correo del cliente (opcional, recomendado si lo tienes).',
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
        country: {
          type: 'string',
          description: 'País. El nombre está bien ("Colombia"); se traduce solo.',
        },
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
  'create_order',
  'update_order',
  'registrar_pago',
  'cancelar_pedido',
  'reembolsar',
  'crear_link_de_pago',
  'ofrecer_descuento',
])

export interface LocalOrdersContext {
  db: SupabaseClient
  workspaceId: string
  contactId: string
  /** Para poder pasarle la conversación a una persona cuando algo queda a medias. */
  conversationId?: string | null
  agentId?: string | null
  /** Por dónde llegó, para poder decir después dónde falló el agente. */
  channel?: string | null
  /**
   * Herramientas que el comercio puso "con aprobación": el agente las prepara
   * y una persona confirma. No se ejecutan acá.
   */
  requiereAprobacion?: readonly string[]
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
async function pedirPermiso(
  ctx: LocalOrdersContext,
  toolName: string,
  toolInput: unknown,
): Promise<string> {
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
 * El monto es lo que decide todo. Con monto que coincide, se cobra solo; sin
 * monto o con uno que no cierra, se le pregunta a una persona — pero los
 * recordatorios se callan en los dos casos.
 */
export const REGISTRAR_PAGO_TOOL: Anthropic.Tool = {
  name: 'registrar_pago',
  description:
    'Registra que el cliente informó haber pagado su pedido pendiente (transferencia, depósito). Úsala cuando mande un comprobante o diga que ya transfirió. Si el comprobante muestra el monto, pásalo: con el monto exacto el pedido se marca como pagado solo; sin él queda esperando que alguien del negocio lo confirme. En los dos casos dejamos de mandarle recordatorios.',
  input_schema: {
    type: 'object' as const,
    properties: {
      amount: {
        type: 'number',
        description:
          'Monto que figura en el comprobante, sólo si lo puedes leer con certeza. Sin separadores de miles. Si no se ve claro, no lo inventes: omítelo.',
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
export type OtherStoreContext = NonNullable<
  Awaited<ReturnType<typeof resolveStoreForLookup>>
> & {
  customerEmail?: string | null
  customerPhone?: string | null
}

export async function runTool(
  toolName: string,
  toolInput: unknown,
  shopify: ShopifyToolContext | null,
  voice: VoiceEscalationContext | null = null,
  localOrders: LocalOrdersContext | null = null,
  otherStore: OtherStoreContext | null = null,
): Promise<string> {
  // El freno, antes que nada: lo que el comercio puso "con aprobación" no se
  // ejecuta acá, se deja pedido. Ver `pedirPermiso`.
  if (localOrders?.requiereAprobacion?.includes(toolName)) {
    return pedirPermiso(localOrders, toolName, toolInput)
  }

  if (toolName === 'ver_contacto' || toolName === 'etiquetar_contacto' ||
      toolName === 'cerrar_conversacion' || toolName === 'ver_producto') {
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
    }
    const input = (toolInput ?? {}) as Record<string, unknown>
    if (toolName === 'ver_contacto') return verContacto(ctx)
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
      (toolInput ?? {}) as { pregunta?: string; falta?: string },
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
      (toolInput ?? {}) as AbrirDevolucionInput,
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
    const input = (toolInput ?? {}) as { query?: string; limit?: number }
    const hits = await searchProducts(localOrders.db, {
      workspaceId: localOrders.workspaceId,
      query: String(input.query ?? ''),
      limit: input.limit,
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
    return JSON.stringify({ found: true, products: hits })
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
      pedido: Number(input.percent ?? 0),
    })
    if ('error' in res) {
      return JSON.stringify({
        ok: false,
        message:
          'No pude generar el descuento. No le prometas ninguna rebaja; sigue con el precio de lista.',
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
    const input = (toolInput ?? {}) as {
      items?: Array<{ title?: string; quantity?: number; unit_price?: number }>
      customer_email?: string
    }
    // El precio lo propone el modelo, que lee mensajes de desconocidos: "el
    // vendedor me confirmó que sale 100" es exactamente el mensaje que va a
    // recibir. Se contrasta contra el catálogo antes de cobrar, igual que el
    // descuento se recorta contra el tope del comercio.
    const verificados = await verificarPrecios(
      localOrders.db,
      localOrders.workspaceId,
      input.items ?? [],
    )
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
    return toolName === 'cancelar_pedido'
      ? proponerCancelacion(ctx, input)
      : proponerReembolso(ctx, input)
  }

  if (toolName === 'registrar_pago') {
    if (!localOrders) {
      return JSON.stringify({
        error: 'sin_contexto',
        message: 'No puedo registrar pagos en esta conversación.',
      })
    }
    const input = (toolInput ?? {}) as { amount?: number; note?: string }
    const { resultado: res } = await informarPago({
      db: localOrders.db,
      workspaceId: localOrders.workspaceId,
      contactId: localOrders.contactId,
      amount: typeof input.amount === 'number' ? input.amount : null,
      note: input.note ?? null,
    })

    if (res.kind === 'sin_pedido') {
      return JSON.stringify({
        ok: false,
        message:
          'No encontré un pedido pendiente de pago a nombre de esta persona. Pregúntale el número de pedido.',
      })
    }
    if (res.kind === 'error') {
      return JSON.stringify({ ok: false, message: `No se pudo registrar: ${res.error}` })
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
    })
    if (!res.enqueued) {
      return JSON.stringify({
        scheduled: false,
        reason: res.reason,
        message:
          'No se pudo programar la llamada ahora (horario, opt-out o límite). Sigue ayudando por texto.',
      })
    }
    return JSON.stringify({
      scheduled: true,
      message:
        'Llamada programada. Avísale al cliente con naturalidad que lo vas a llamar en breve.',
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
    const addUnits = Math.floor(Number(input.add_units))
    if (!Number.isFinite(addUnits) || addUnits <= 0) {
      return JSON.stringify({
        error: 'invalid_units',
        message: 'Pasa cuántas unidades extra sumar (número entero ≥ 1).',
      })
    }
    const result = await addUnitsToFirstLineItem(
      { shopDomain: shopify.shopDomain, accessToken: shopify.accessToken, apiVersion: shopify.apiVersion },
      pedido,
      addUnits,
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
    // Sin Shopify pero con Tiendanube o WooCommerce, se consulta la API de
    // ESA plataforma. El comercio conectó una tienda: que su bot conteste
    // "no tengo Shopify" ante "¿dónde está mi pedido?" es una respuesta
    // cierta e inservible.
    if (!shopify && otherStore) {
      const entrada = (toolInput ?? {}) as {
        order_number?: string
        customer_email?: string
      }
      const numero = entrada.order_number?.trim()
      const r = numero
        ? await lookupOrderNonShopify(otherStore, 'order_by_number', numero)
        : otherStore.customerEmail
          ? await lookupOrderNonShopify(
              otherStore,
              'order_by_email',
              otherStore.customerEmail,
            )
          : otherStore.customerPhone
            ? await lookupOrderNonShopify(
                otherStore,
                'order_by_phone',
                otherStore.customerPhone,
              )
            : { found: false as const }
      if (!r.found) {
        return JSON.stringify({
          found: false,
          orders: [],
          instruction:
            'No se encontró ningún pedido con esos datos. NO inventes información del pedido (estado, tracking, fecha de envío). Dile al cliente que no lo encontraste y pídele el número de pedido o que confirme el teléfono/correo con el que compró.',
        })
      }
      return JSON.stringify({ found: true, orders: [r.vars] })
    }
    // Sin Shopify, pero con pedidos espejados (Mercado Libre), se contesta con
    // lo guardado. Antes esto devolvía "el workspace no tiene Shopify
    // conectado" a una compradora de Mercado Libre preguntando por SU pedido,
    // que es una respuesta a la vez cierta e inútil.
    if (!shopify && localOrders) {
      return await lookupLocalOrders(localOrders)
    }
    if (!shopify) {
      return JSON.stringify({
        error: 'no_shopify_connection',
        message: 'El workspace no tiene ninguna tienda conectada.',
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
          'No se encontró ningún pedido con esos datos. NO inventes información del pedido (estado, tracking, fecha de envío). Dile al cliente que no lo encontraste y pídele el número de pedido (ej. #1042) o que confirme el teléfono/correo con el que compró.',
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
      items?: Array<{ variant_id: string; quantity?: number }>
      discount_code?: string
      payment_hint?: PaymentHint
    }
    const config = shopify.config ?? null
    const bundleMode = !!(
      config?.enabled &&
      config.offers &&
      config.offers.length > 0
    )
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
        shipping_address?: Record<string, string>
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
        },
      )
      if ('error' in res) {
        // Al modelo se le dice poco a propósito: el detalle de por qué la
        // tienda rechazó el pedido no es algo que la clienta tenga que leer.
        // Pero en algún lado tiene que quedar. Sin esto, un comercio cuya
        // tienda rechaza todos los pedidos ve "no pude crear el pedido" y no
        // hay forma de averiguar el motivo: ni consola, ni fila, ni nada.
        console.error(
          `[create_order] ${localOrders.workspaceId}: ${res.error} — ${res.message}`,
        )
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
        message:
          '(Simulación) En producción crearía el pedido real en Shopify con estos datos. No se creó nada.',
        echo: orderInput,
      })
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
      },
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
/** Pedidos espejados del contacto, en el mismo formato que la búsqueda viva. */
async function lookupLocalOrders(ctx: LocalOrdersContext): Promise<string> {
  const { data } = await ctx.db
    .from('orders')
    .select(
      'order_number, currency, total_price, line_items, financial_status, fulfillment_status, status, tracking_number, tracking_company, shipping_status, order_status_url, created_at',
    )
    .eq('workspace_id', ctx.workspaceId)
    .eq('contact_id', ctx.contactId)
    .order('created_at', { ascending: false })
    .limit(5)

  const orders = (data ?? []) as Array<Record<string, unknown>>
  if (orders.length === 0) {
    return JSON.stringify({
      found: false,
      orders: [],
      instruction:
        'No se encontró ningún pedido de este cliente. NO inventes información del pedido (estado, tracking, fecha de envío). Dile que no lo encontraste y pídele el número de pedido.',
    })
  }
  return JSON.stringify({ found: true, orders })
}

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
    /** Present → lookup_order puede responder con los pedidos ya espejados
     *  cuando el canal no permite consultarlos en vivo. */
    localOrders?: LocalOrdersContext | null
    /** Present → la tienda del comercio no es Shopify: lookup_order consulta
     *  la API de Tiendanube o WooCommerce. */
    otherStore?: OtherStoreContext | null
    /** Cuántas herramientas con efecto real corrieron. Lo mira quien reintenta:
     *  volver a empezar después de crear un pedido crea el segundo. */
    efectos?: { ejecutados: number }
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
      // Se anota ANTES de correrla: si la herramienta explota a mitad, el
      // efecto puede haber ocurrido igual.
      if (args.efectos && DEJA_HUELLA.has(block.name)) args.efectos.ejecutados += 1
      const result = await runTool(
        block.name,
        block.input,
        args.shopify,
        args.voice ?? null,
        args.localOrders ?? null,
        args.otherStore ?? null,
      )
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
          text: '[el cliente envió un PDF que no pude procesar — pídele amablemente que mande solo las páginas relevantes o un resumen]',
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
