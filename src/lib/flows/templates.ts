/**
 * Plantillas de flujo para clonar con un click.
 *
 * Tres recetas pensadas para el ciclo completo de una tienda online en
 * WhatsApp: vender, atender y acompañar después de la compra. Cada una
 * encadena varios tipos de nodo (botones, listas, condición por Shopify,
 * captura de datos, CTA, handoff) y queda 100% editable tras clonar.
 *
 * Reglas de autoría (límites de Meta + validator):
 *   - send_buttons: máximo 3 botones, títulos ≤ 20 caracteres.
 *   - send_list: máximo 10 filas en total, títulos de fila ≤ 24.
 *   - Cada next_node_key / found_next_key / not_found_next_key / destino
 *     de botón o fila apunta a un node_key real, y entry_node_id existe.
 *   - Variables de Shopify (output_prefix 'order') que el engine rellena:
 *     order_name, order_fulfillment_status, order_total, order_status_url,
 *     order_tracking_url (ver lib/flows/shopify-lookup.ts).
 *   - Marca, URLs y enlaces son placeholders que el merchant edita.
 *   - Español neutro, mensajes breves.
 *
 * Bilingüe: el CONTENIDO de cada nodo (lo que se envía al cliente final)
 * se construye en el idioma del merchant vía `tr(locale, es, en)`. Las
 * traducciones al inglés respetan los mismos límites de Meta (títulos de
 * botón ≤ 20, títulos de fila ≤ 24).
 */

import type {
  AiIntentNodeConfig,
  CollectInputNodeConfig,
  HandoffNodeConfig,
  KeywordTriggerConfig,
  SendButtonsNodeConfig,
  SendCtaUrlNodeConfig,
  SendListNodeConfig,
  SendMessageNodeConfig,
  ShopifyLookupNodeConfig,
} from './types';
import type { Locale } from '../i18n/config';

/** Picks the Spanish or English literal for the active locale. */
const tr = (locale: Locale, es: string, en: string): string => (locale === 'en' ? en : es);

export type FlowTemplateNodeType =
  | 'start'
  | 'send_message'
  | 'send_buttons'
  | 'send_list'
  | 'send_image'
  | 'send_video'
  | 'send_document'
  | 'send_cta_url'
  | 'collect_input'
  | 'condition'
  | 'set_tag'
  | 'handoff'
  | 'wait'
  | 'ai_intent'
  | 'shopify_lookup'
  | 'end';

export interface FlowTemplateNode {
  node_key: string;
  node_type: FlowTemplateNodeType;
  /**
   * Per-node config — shape depends on node_type. We type it loosely
   * here (typed structurally as `object`) because each entry is a
   * distinct interface that doesn't share an index signature; the
   * concrete shape is constrained by the engine's
   * discriminated union when the node runs.
   */
  config: object;
}

export interface FlowTemplate {
  slug: string;
  name: string;
  /** Two-line pitch shown on the card AND in full on the preview: di
   *  POR QUÉ elegir esta plantilla, no solo qué hace. */
  description: string;
  icon: 'MessageSquare' | 'HelpCircle' | 'UserPlus' | 'Package' | 'ShoppingBag';
  trigger_type: 'keyword' | 'first_inbound_message' | 'manual';
  trigger_config: KeywordTriggerConfig | Record<string, unknown>;
  entry_node_id: string;
  nodes: FlowTemplateNode[];
}

// ============================================================
// 1) Ventas — asesor de compra
// ============================================================
// Estructura:
//   [menu_root] ─┬─ "Ver productos"  → cat_list → (CTA por categoría) → seguir
//                ├─ "Tengo una duda" → dudas_list → respuesta → seguir
//                └─ "Hablar con asesor" → handoff
//   [seguir] ─┬─ "Comprar ahora" → cierre_cta (checkout) → fin
//             ├─ "Tengo una duda" → dudas_list
//             └─ "Hablar con asesor" → handoff
// "No sé, asesórame" abre un ai_intent que enruta según lo que escriba.

function ventasAsesor(locale: Locale): FlowTemplate {
  return {
    slug: 'ventas_asesor',
    name: 'Ventas · asesor de compra',
    description:
      'Convierte conversaciones en ventas: entiende qué busca el cliente, le recomienda productos, resuelve dudas de envío, pago y garantía, y lo lleva al checkout. Ideal para tráfico de anuncios y para no perder a quien pregunta y no compra.',
    icon: 'ShoppingBag',
    trigger_type: 'first_inbound_message',
    trigger_config: {},
    entry_node_id: 'menu_root',
    nodes: [
      {
        node_key: 'menu_root',
        node_type: 'send_buttons',
        config: {
          header_text: tr(locale, '¡Hola! 👋', 'Hi there! 👋'),
          text: tr(
            locale,
            'Soy tu asesor de la tienda. ¿Qué quieres hacer hoy?',
            "I'm your shopping advisor. What would you like to do today?",
          ),
          footer_text: tr(locale, 'Toca una opción.', 'Tap an option.'),
          buttons: [
            { reply_id: 'productos', title: tr(locale, 'Ver productos', 'See products'), next_node_key: 'cat_list' },
            { reply_id: 'duda', title: tr(locale, 'Tengo una duda', 'I have a question'), next_node_key: 'dudas_list' },
            { reply_id: 'asesor', title: tr(locale, 'Hablar con asesor', 'Talk to an advisor'), next_node_key: 'handoff_directo' },
          ],
        } as SendButtonsNodeConfig,
      },
      {
        node_key: 'cat_list',
        node_type: 'send_list',
        config: {
          text: tr(locale, '¿Qué te interesa ver?', 'What would you like to see?'),
          button_label: tr(locale, 'Ver categorías', 'See categories'),
          sections: [
            {
              title: tr(locale, 'Catálogo', 'Catalog'),
              rows: [
                { reply_id: 'top', title: tr(locale, 'Lo más vendido', 'Best sellers'), description: tr(locale, 'Los favoritos', 'Customer favorites'), next_node_key: 'reco_top' },
                { reply_id: 'nuevo', title: tr(locale, 'Novedades', 'New arrivals'), description: tr(locale, 'Lo último que llegó', 'Just landed'), next_node_key: 'reco_nuevo' },
                { reply_id: 'ofertas', title: tr(locale, 'Ofertas', 'Deals'), description: tr(locale, 'Precios especiales', 'Special prices'), next_node_key: 'reco_ofertas' },
                { reply_id: 'ayuda', title: tr(locale, 'No sé, asesórame', 'Help me choose'), description: tr(locale, 'Te ayudo a elegir', "I'll help you pick"), next_node_key: 'asesor_ai' },
              ],
            },
          ],
        } as SendListNodeConfig,
      },
      {
        node_key: 'reco_top',
        node_type: 'send_cta_url',
        config: {
          header_text: tr(locale, 'Lo más vendido', 'Best sellers'),
          text: tr(
            locale,
            'Estos son los favoritos de nuestros clientes. Míralos y elige el tuyo.',
            'These are our customer favorites. Take a look and pick yours.',
          ),
          footer_text: tr(locale, 'Envío rápido a todo el país.', 'Fast shipping nationwide.'),
          button_title: tr(locale, 'Ver productos', 'See products'),
          url: 'https://tu-tienda.com/collections/mas-vendidos',
          next_node_key: 'seguir',
        } as SendCtaUrlNodeConfig,
      },
      {
        node_key: 'reco_nuevo',
        node_type: 'send_cta_url',
        config: {
          header_text: tr(locale, 'Novedades', 'New arrivals'),
          text: tr(
            locale,
            'Lo último que sumamos a la tienda. Echa un vistazo antes de que se agote.',
            'The latest additions to our store. Check them out before they sell out.',
          ),
          footer_text: tr(locale, 'Stock limitado.', 'Limited stock.'),
          button_title: tr(locale, 'Ver productos', 'See products'),
          url: 'https://tu-tienda.com/collections/novedades',
          next_node_key: 'seguir',
        } as SendCtaUrlNodeConfig,
      },
      {
        node_key: 'reco_ofertas',
        node_type: 'send_cta_url',
        config: {
          header_text: tr(locale, 'Ofertas', 'Deals'),
          text: tr(
            locale,
            'Aprovecha los productos con precio especial por tiempo limitado.',
            'Grab products at special prices for a limited time.',
          ),
          footer_text: tr(locale, 'Hasta agotar stock.', 'While stocks last.'),
          button_title: tr(locale, 'Ver ofertas', 'See deals'),
          url: 'https://tu-tienda.com/collections/ofertas',
          next_node_key: 'seguir',
        } as SendCtaUrlNodeConfig,
      },
      {
        node_key: 'asesor_ai',
        node_type: 'ai_intent',
        config: {
          prompt_text: tr(
            locale,
            'Cuéntame qué buscas o para qué lo necesitas y te recomiendo.',
            "Tell me what you're looking for or what you need it for and I'll recommend something.",
          ),
          intents: [
            { intent_key: 'producto', description: tr(locale, 'Describe un producto o una necesidad concreta.', 'Describes a specific product or need.'), next_node_key: 'reco_top' },
            { intent_key: 'envios', description: tr(locale, 'Pregunta por envíos, tiempos o costos.', 'Asks about shipping, times, or costs.'), next_node_key: 'resp_envios' },
            { intent_key: 'precio', description: tr(locale, 'Pregunta por precio, pagos o descuentos.', 'Asks about price, payments, or discounts.'), next_node_key: 'resp_pagos' },
            { intent_key: 'humano', description: tr(locale, 'Pide hablar con una persona.', 'Asks to talk to a person.'), next_node_key: 'handoff_directo' },
          ],
          fallback_next_key: 'handoff_directo',
        } as AiIntentNodeConfig,
      },
      {
        node_key: 'seguir',
        node_type: 'send_buttons',
        config: {
          text: tr(locale, '¿Cómo seguimos?', 'How shall we continue?'),
          footer_text: tr(locale, 'Toca una opción.', 'Tap an option.'),
          buttons: [
            { reply_id: 'comprar', title: tr(locale, 'Comprar ahora', 'Buy now'), next_node_key: 'cierre_cta' },
            { reply_id: 'duda2', title: tr(locale, 'Tengo una duda', 'I have a question'), next_node_key: 'dudas_list' },
            { reply_id: 'asesor2', title: tr(locale, 'Hablar con asesor', 'Talk to an advisor'), next_node_key: 'handoff_directo' },
          ],
        } as SendButtonsNodeConfig,
      },
      {
        node_key: 'dudas_list',
        node_type: 'send_list',
        config: {
          text: tr(locale, '¿Sobre qué quieres saber?', 'What would you like to know about?'),
          button_label: tr(locale, 'Ver temas', 'See topics'),
          sections: [
            {
              title: tr(locale, 'Tus dudas', 'Your questions'),
              rows: [
                { reply_id: 'envios', title: tr(locale, 'Envíos', 'Shipping'), description: tr(locale, 'Tiempos y costos', 'Times and costs'), next_node_key: 'resp_envios' },
                { reply_id: 'pagos', title: tr(locale, 'Medios de pago', 'Payment methods'), description: tr(locale, 'Qué aceptamos', 'What we accept'), next_node_key: 'resp_pagos' },
                { reply_id: 'garantia', title: tr(locale, 'Garantía', 'Warranty'), description: tr(locale, 'Cobertura y plazos', 'Coverage and terms'), next_node_key: 'resp_garantia' },
                { reply_id: 'cambios', title: tr(locale, 'Cambios', 'Returns'), description: tr(locale, 'Política de cambios', 'Return policy'), next_node_key: 'resp_cambios' },
              ],
            },
          ],
        } as SendListNodeConfig,
      },
      {
        node_key: 'resp_envios',
        node_type: 'send_message',
        config: {
          text: tr(
            locale,
            'Enviamos a todo el país en 2 a 5 días hábiles. El costo se calcula al pagar según tu ciudad, y el envío es gratis desde cierto monto. 🚚',
            'We ship nationwide in 2 to 5 business days. The cost is calculated at checkout based on your city, and shipping is free above a certain amount. 🚚',
          ),
          next_node_key: 'seguir',
        } as SendMessageNodeConfig,
      },
      {
        node_key: 'resp_pagos',
        node_type: 'send_message',
        config: {
          text: tr(
            locale,
            'Aceptamos tarjeta de crédito y débito, transferencia y pago contra entrega en zonas seleccionadas. 💳',
            'We accept credit and debit cards, bank transfer, and cash on delivery in select areas. 💳',
          ),
          next_node_key: 'seguir',
        } as SendMessageNodeConfig,
      },
      {
        node_key: 'resp_garantia',
        node_type: 'send_message',
        config: {
          text: tr(
            locale,
            'Todos los productos tienen garantía. Si llega con algún defecto, lo cambiamos sin costo. ✅',
            'All products come with a warranty. If yours arrives with a defect, we replace it at no cost. ✅',
          ),
          next_node_key: 'seguir',
        } as SendMessageNodeConfig,
      },
      {
        node_key: 'resp_cambios',
        node_type: 'send_message',
        config: {
          text: tr(
            locale,
            'Tienes 15 días para cambiar tu producto si no quedaste conforme. Debe estar sin uso y con su empaque. 🔁',
            "You have 15 days to exchange your product if you're not satisfied. It must be unused and in its original packaging. 🔁",
          ),
          next_node_key: 'seguir',
        } as SendMessageNodeConfig,
      },
      {
        node_key: 'cierre_cta',
        node_type: 'send_cta_url',
        config: {
          header_text: tr(locale, 'Termina tu compra', 'Complete your purchase'),
          text: tr(
            locale,
            '¡Genial! Finaliza tu compra de forma segura. Si necesitas ayuda, escríbeme por aquí.',
            'Great! Complete your purchase securely. If you need help, just message me here.',
          ),
          footer_text: tr(locale, 'Pago 100% seguro.', '100% secure payment.'),
          button_title: tr(locale, 'Ir a pagar', 'Go to checkout'),
          url: 'https://tu-tienda.com/checkout',
          next_node_key: 'fin_ok',
        } as SendCtaUrlNodeConfig,
      },
      {
        node_key: 'handoff_directo',
        node_type: 'handoff',
        config: {
          note: tr(
            locale,
            'El cliente quiere comprar o tiene una duda que el flujo no resolvió. Continúa la venta.',
            "The customer wants to buy or has a question the flow didn't resolve. Continue the sale.",
          ),
        } as HandoffNodeConfig,
      },
      {
        node_key: 'fin_ok',
        node_type: 'end',
        config: {},
      },
    ],
  };
}

// ============================================================
// 2) Atención al cliente 24/7
// ============================================================
// Estructura:
//   [menu_root] ─┬─ "Mi pedido"  → pide número → Shopify → estado / no encontrado
//                ├─ "Preguntas"  → lista de 6 temas → respuesta → otra_pregunta
//                └─ "Hablar con humano" → handoff
// El tema "Cambios y devolución" ofrece iniciar la devolución (captura el
// número y deriva a una persona).

function atencion247(locale: Locale): FlowTemplate {
  return {
    slug: 'atencion_24_7',
    name: 'Atención al cliente 24/7',
    description:
      'Responde al instante las dudas que más llegan: estado del pedido, envíos, cambios, pagos y tallas. Resuelve la mayoría sin tu equipo y pasa a un humano solo cuando hace falta. Baja la carga de soporte y mejora la satisfacción.',
    icon: 'HelpCircle',
    trigger_type: 'first_inbound_message',
    trigger_config: {},
    entry_node_id: 'menu_root',
    nodes: [
      {
        node_key: 'menu_root',
        node_type: 'send_buttons',
        config: {
          header_text: tr(locale, '¡Hola! 👋', 'Hi there! 👋'),
          text: tr(
            locale,
            'Soy el asistente de la tienda. ¿En qué te ayudo?',
            "I'm the store assistant. How can I help?",
          ),
          footer_text: tr(locale, 'Toca una opción.', 'Tap an option.'),
          buttons: [
            { reply_id: 'pedido', title: tr(locale, 'Mi pedido', 'My order'), next_node_key: 'pedido_num' },
            { reply_id: 'preguntas', title: tr(locale, 'Preguntas', 'Questions'), next_node_key: 'faq_list' },
            { reply_id: 'humano', title: tr(locale, 'Hablar con humano', 'Talk to a human'), next_node_key: 'handoff_directo' },
          ],
        } as SendButtonsNodeConfig,
      },
      {
        node_key: 'pedido_num',
        node_type: 'collect_input',
        config: {
          prompt_text: tr(
            locale,
            'Escribe el número de tu pedido (por ejemplo: 1042). Lo encuentras en tu correo de confirmación.',
            'Type your order number (for example: 1042). You can find it in your confirmation email.',
          ),
          var_key: 'numero_pedido',
          next_node_key: 'pedido_buscar',
        } as CollectInputNodeConfig,
      },
      {
        node_key: 'pedido_buscar',
        node_type: 'shopify_lookup',
        config: {
          kind: 'order_by_number',
          input_var: 'numero_pedido',
          output_prefix: 'order',
          found_next_key: 'pedido_estado',
          not_found_next_key: 'pedido_no_encontrado',
        } as ShopifyLookupNodeConfig,
      },
      {
        node_key: 'pedido_estado',
        node_type: 'send_message',
        config: {
          text: tr(
            locale,
            '📦 Pedido {{vars.order_name}}\n' +
              'Estado: *{{vars.order_fulfillment_status}}*\n' +
              'Total: {{vars.order_total}}\n' +
              'Seguimiento: {{vars.order_tracking_url}}',
            '📦 Order {{vars.order_name}}\n' +
              'Status: *{{vars.order_fulfillment_status}}*\n' +
              'Total: {{vars.order_total}}\n' +
              'Tracking: {{vars.order_tracking_url}}',
          ),
          next_node_key: 'algo_mas',
        } as SendMessageNodeConfig,
      },
      {
        node_key: 'pedido_no_encontrado',
        node_type: 'send_message',
        config: {
          text: tr(
            locale,
            'No encontré un pedido con ese número 😕. Te paso con una persona para que lo revise.',
            "I couldn't find an order with that number 😕. Let me connect you with someone to check it.",
          ),
          next_node_key: 'handoff_directo',
        } as SendMessageNodeConfig,
      },
      {
        node_key: 'algo_mas',
        node_type: 'send_buttons',
        config: {
          text: tr(locale, '¿Te ayudo con algo más?', 'Can I help with anything else?'),
          buttons: [
            { reply_id: 'menu', title: tr(locale, 'Volver al menú', 'Back to menu'), next_node_key: 'menu_root' },
            { reply_id: 'humano2', title: tr(locale, 'Hablar con humano', 'Talk to a human'), next_node_key: 'handoff_directo' },
            { reply_id: 'listo', title: tr(locale, 'Listo, gracias', 'All set, thanks'), next_node_key: 'fin_ok' },
          ],
        } as SendButtonsNodeConfig,
      },
      {
        node_key: 'faq_list',
        node_type: 'send_list',
        config: {
          text: tr(locale, '¿Sobre qué tema quieres saber?', 'Which topic would you like to know about?'),
          button_label: tr(locale, 'Ver temas', 'See topics'),
          sections: [
            {
              title: tr(locale, 'Las más consultadas', 'Most asked'),
              rows: [
                { reply_id: 'envios', title: tr(locale, 'Envíos', 'Shipping'), description: tr(locale, 'Tiempos y costos', 'Times and costs'), next_node_key: 'faq_envios' },
                { reply_id: 'devoluciones', title: tr(locale, 'Cambios y devolución', 'Returns & exchanges'), description: tr(locale, 'Política y plazos', 'Policy and terms'), next_node_key: 'faq_devoluciones' },
                { reply_id: 'pagos', title: tr(locale, 'Medios de pago', 'Payment methods'), description: tr(locale, 'Qué aceptamos', 'What we accept'), next_node_key: 'faq_pagos' },
                { reply_id: 'tallas', title: tr(locale, 'Tallas y medidas', 'Sizes & measurements'), description: tr(locale, 'Guía de talles', 'Sizing guide'), next_node_key: 'faq_tallas' },
                { reply_id: 'tienda', title: tr(locale, 'Tienda física', 'Physical store'), description: tr(locale, 'Dirección y horario', 'Address and hours'), next_node_key: 'faq_tienda' },
                { reply_id: 'garantia', title: tr(locale, 'Garantía', 'Warranty'), description: tr(locale, 'Cobertura y plazos', 'Coverage and terms'), next_node_key: 'faq_garantia' },
              ],
            },
          ],
        } as SendListNodeConfig,
      },
      {
        node_key: 'faq_envios',
        node_type: 'send_message',
        config: {
          text: tr(
            locale,
            'Enviamos a todo el país en 2 a 5 días hábiles. El costo se calcula al pagar según tu ciudad, y el envío es gratis desde cierto monto. 🚚',
            'We ship nationwide in 2 to 5 business days. The cost is calculated at checkout based on your city, and shipping is free above a certain amount. 🚚',
          ),
          next_node_key: 'otra_pregunta',
        } as SendMessageNodeConfig,
      },
      {
        node_key: 'faq_devoluciones',
        node_type: 'send_message',
        config: {
          text: tr(
            locale,
            'Aceptamos cambios y devoluciones dentro de los 15 días de recibir el pedido. El producto debe estar sin uso y con su empaque original. 🔁',
            'We accept returns and exchanges within 15 days of receiving your order. The product must be unused and in its original packaging. 🔁',
          ),
          next_node_key: 'devolucion_buttons',
        } as SendMessageNodeConfig,
      },
      {
        node_key: 'devolucion_buttons',
        node_type: 'send_buttons',
        config: {
          text: tr(locale, '¿Quieres iniciar una devolución?', 'Do you want to start a return?'),
          buttons: [
            { reply_id: 'iniciar', title: tr(locale, 'Iniciar devolución', 'Start a return'), next_node_key: 'dev_collect' },
            { reply_id: 'temas', title: tr(locale, 'Ver otros temas', 'See other topics'), next_node_key: 'faq_list' },
            { reply_id: 'listo_dev', title: tr(locale, 'Listo, gracias', 'All set, thanks'), next_node_key: 'fin_ok' },
          ],
        } as SendButtonsNodeConfig,
      },
      {
        node_key: 'dev_collect',
        node_type: 'collect_input',
        config: {
          prompt_text: tr(
            locale,
            'Escribe el número del pedido que quieres devolver y, si puedes, el motivo.',
            "Type the number of the order you'd like to return and, if you can, the reason.",
          ),
          var_key: 'pedido_devolucion',
          next_node_key: 'dev_handoff',
        } as CollectInputNodeConfig,
      },
      {
        node_key: 'dev_handoff',
        node_type: 'handoff',
        config: {
          note: tr(
            locale,
            'El cliente quiere iniciar una devolución. Revisa el número de pedido y el motivo en la conversación.',
            'The customer wants to start a return. Check the order number and reason in the conversation.',
          ),
        } as HandoffNodeConfig,
      },
      {
        node_key: 'faq_pagos',
        node_type: 'send_message',
        config: {
          text: tr(
            locale,
            'Aceptamos tarjeta de crédito y débito, transferencia y pago contra entrega en zonas seleccionadas. 💳',
            'We accept credit and debit cards, bank transfer, and cash on delivery in select areas. 💳',
          ),
          next_node_key: 'otra_pregunta',
        } as SendMessageNodeConfig,
      },
      {
        node_key: 'faq_tallas',
        node_type: 'send_message',
        config: {
          text: tr(
            locale,
            'Cada producto tiene su guía de tallas en la ficha. Si tienes dudas con una prenda, escribe su nombre y te ayudo. 📏',
            "Each product has its sizing guide on its page. If you have questions about an item, type its name and I'll help. 📏",
          ),
          next_node_key: 'otra_pregunta',
        } as SendMessageNodeConfig,
      },
      {
        node_key: 'faq_tienda',
        node_type: 'send_message',
        config: {
          text: tr(
            locale,
            '📍 Calle Falsa 123, tu ciudad.\nLunes a sábado de 10:00 a 19:00.\nDomingos cerrado.',
            '📍 123 Main St, your city.\nMonday to Saturday, 10:00 to 19:00.\nClosed on Sundays.',
          ),
          next_node_key: 'otra_pregunta',
        } as SendMessageNodeConfig,
      },
      {
        node_key: 'faq_garantia',
        node_type: 'send_message',
        config: {
          text: tr(
            locale,
            'Todos los productos tienen garantía. Si llega con algún defecto, lo cambiamos sin costo. ✅',
            'All products come with a warranty. If yours arrives with a defect, we replace it at no cost. ✅',
          ),
          next_node_key: 'otra_pregunta',
        } as SendMessageNodeConfig,
      },
      {
        node_key: 'otra_pregunta',
        node_type: 'send_buttons',
        config: {
          text: tr(locale, '¿Tienes otra pregunta?', 'Do you have another question?'),
          buttons: [
            { reply_id: 'temas2', title: tr(locale, 'Ver temas', 'See topics'), next_node_key: 'faq_list' },
            { reply_id: 'humano3', title: tr(locale, 'Hablar con humano', 'Talk to a human'), next_node_key: 'handoff_directo' },
            { reply_id: 'listo2', title: tr(locale, 'Listo, gracias', 'All set, thanks'), next_node_key: 'fin_ok' },
          ],
        } as SendButtonsNodeConfig,
      },
      {
        node_key: 'handoff_directo',
        node_type: 'handoff',
        config: {
          note: tr(
            locale,
            'El cliente pidió hablar con una persona desde el menú de atención.',
            'The customer asked to talk to a person from the support menu.',
          ),
        } as HandoffNodeConfig,
      },
      {
        node_key: 'fin_ok',
        node_type: 'end',
        config: {},
      },
    ],
  };
}

// ============================================================
// 3) Post-venta / seguimiento
// ============================================================
// Estructura:
//   [menu_root: lista] ─┬─ "Seguir mi envío" → número → Shopify → estado → ¿todo bien?
//                       ├─ "Mi factura"      → mensaje → ¿algo más?
//                       ├─ "Tengo un problema" → captura → handoff
//                       ├─ "Dejar reseña"    → CTA reseña → fin
//                       └─ "Hablar con humano" → handoff

function postVenta(locale: Locale): FlowTemplate {
  return {
    slug: 'post_venta',
    name: 'Post-venta / seguimiento',
    description:
      'Acompaña después de la compra: da seguimiento del envío, detecta problemas a tiempo y pide reseña a los clientes contentos. Sube tu reputación, evita malas experiencias y genera recompra.',
    icon: 'Package',
    trigger_type: 'first_inbound_message',
    trigger_config: {},
    entry_node_id: 'menu_root',
    nodes: [
      {
        node_key: 'menu_root',
        node_type: 'send_list',
        config: {
          header_text: tr(locale, '¡Hola de nuevo! 👋', 'Hi again! 👋'),
          text: tr(locale, 'Gracias por tu compra. ¿En qué te ayudo?', 'Thanks for your purchase. How can I help?'),
          button_label: tr(locale, 'Ver opciones', 'See options'),
          sections: [
            {
              title: tr(locale, 'Después de tu compra', 'After your purchase'),
              rows: [
                { reply_id: 'envio', title: tr(locale, 'Seguir mi envío', 'Track my shipment'), description: tr(locale, 'Estado y tracking', 'Status and tracking'), next_node_key: 'track_num' },
                { reply_id: 'factura', title: tr(locale, 'Mi factura', 'My invoice'), description: tr(locale, 'Comprobante de compra', 'Proof of purchase'), next_node_key: 'factura_msg' },
                { reply_id: 'problema', title: tr(locale, 'Tengo un problema', 'I have a problem'), description: tr(locale, 'Algo salió mal', 'Something went wrong'), next_node_key: 'prob_collect' },
                { reply_id: 'resena', title: tr(locale, 'Dejar reseña', 'Leave a review'), description: tr(locale, 'Cuéntanos tu experiencia', 'Tell us your experience'), next_node_key: 'resena_cta' },
                { reply_id: 'humano', title: tr(locale, 'Hablar con humano', 'Talk to a human'), description: tr(locale, 'Te atiende una persona', 'A person will assist you'), next_node_key: 'handoff_directo' },
              ],
            },
          ],
        } as SendListNodeConfig,
      },
      {
        node_key: 'track_num',
        node_type: 'collect_input',
        config: {
          prompt_text: tr(
            locale,
            'Escribe tu número de pedido (por ejemplo: 1042) y reviso el estado del envío.',
            "Type your order number (for example: 1042) and I'll check the shipment status.",
          ),
          var_key: 'numero_pedido',
          next_node_key: 'track_buscar',
        } as CollectInputNodeConfig,
      },
      {
        node_key: 'track_buscar',
        node_type: 'shopify_lookup',
        config: {
          kind: 'order_by_number',
          input_var: 'numero_pedido',
          output_prefix: 'order',
          found_next_key: 'track_estado',
          not_found_next_key: 'track_no',
        } as ShopifyLookupNodeConfig,
      },
      {
        node_key: 'track_estado',
        node_type: 'send_message',
        config: {
          text: tr(
            locale,
            '📦 Pedido {{vars.order_name}}\n' +
              'Estado: *{{vars.order_fulfillment_status}}*\n' +
              'Seguimiento: {{vars.order_tracking_url}}',
            '📦 Order {{vars.order_name}}\n' +
              'Status: *{{vars.order_fulfillment_status}}*\n' +
              'Tracking: {{vars.order_tracking_url}}',
          ),
          next_node_key: 'todo_bien',
        } as SendMessageNodeConfig,
      },
      {
        node_key: 'track_no',
        node_type: 'send_message',
        config: {
          text: tr(
            locale,
            'No encontré un pedido con ese número 😕. Te paso con una persona para que lo revise.',
            "I couldn't find an order with that number 😕. Let me connect you with someone to check it.",
          ),
          next_node_key: 'handoff_directo',
        } as SendMessageNodeConfig,
      },
      {
        node_key: 'todo_bien',
        node_type: 'send_buttons',
        config: {
          text: tr(locale, '¿Llegó todo bien?', 'Did everything arrive OK?'),
          buttons: [
            { reply_id: 'bien', title: tr(locale, 'Sí, todo bien', 'Yes, all good'), next_node_key: 'resena_cta' },
            { reply_id: 'demora', title: tr(locale, 'Aún no llega', "Hasn't arrived yet"), next_node_key: 'no_llega' },
            { reply_id: 'problema2', title: tr(locale, 'Tuve un problema', 'I had a problem'), next_node_key: 'prob_collect' },
          ],
        } as SendButtonsNodeConfig,
      },
      {
        node_key: 'no_llega',
        node_type: 'send_message',
        config: {
          text: tr(
            locale,
            'Lamento la demora. Si tu pedido tarda más de lo esperado, lo revisamos contigo. Te paso con una persona para darte una solución.',
            'Sorry for the delay. If your order is taking longer than expected, we’ll look into it with you. Let me connect you with someone to find a solution.',
          ),
          next_node_key: 'handoff_directo',
        } as SendMessageNodeConfig,
      },
      {
        node_key: 'factura_msg',
        node_type: 'send_message',
        config: {
          text: tr(
            locale,
            'Enviamos la factura al correo de tu pedido. Si no la ves, revisa spam o pídela aquí y te la reenviamos.',
            "We send the invoice to the email on your order. If you don't see it, check spam or ask for it here and we'll resend it.",
          ),
          next_node_key: 'factura_buttons',
        } as SendMessageNodeConfig,
      },
      {
        node_key: 'factura_buttons',
        node_type: 'send_buttons',
        config: {
          text: tr(locale, '¿Necesitas algo más?', 'Do you need anything else?'),
          buttons: [
            { reply_id: 'reenviar', title: tr(locale, 'Reenviar factura', 'Resend invoice'), next_node_key: 'handoff_directo' },
            { reply_id: 'menu', title: tr(locale, 'Volver al menú', 'Back to menu'), next_node_key: 'menu_root' },
            { reply_id: 'listo', title: tr(locale, 'Listo, gracias', 'All set, thanks'), next_node_key: 'fin_ok' },
          ],
        } as SendButtonsNodeConfig,
      },
      {
        node_key: 'resena_cta',
        node_type: 'send_cta_url',
        config: {
          header_text: tr(locale, 'Tu opinión nos ayuda', 'Your opinion helps us'),
          text: tr(
            locale,
            '¿Nos dejas una reseña? Toma un minuto y nos ayuda muchísimo. 🙏',
            'Would you leave us a review? It takes a minute and helps us a lot. 🙏',
          ),
          footer_text: tr(locale, '¡Gracias por tu compra!', 'Thanks for your purchase!'),
          button_title: tr(locale, 'Dejar reseña', 'Leave a review'),
          url: 'https://tu-tienda.com/reseñas',
          next_node_key: 'fin_ok',
        } as SendCtaUrlNodeConfig,
      },
      {
        node_key: 'prob_collect',
        node_type: 'collect_input',
        config: {
          prompt_text: tr(
            locale,
            'Cuéntame qué pasó con tu pedido y lo resolvemos. Si puedes, incluye el número de pedido.',
            "Tell me what happened with your order and we'll fix it. If you can, include the order number.",
          ),
          var_key: 'problema',
          next_node_key: 'prob_handoff',
        } as CollectInputNodeConfig,
      },
      {
        node_key: 'prob_handoff',
        node_type: 'handoff',
        config: {
          note: tr(
            locale,
            'El cliente reporta un problema con su pedido. Revisa el detalle en la conversación.',
            'The customer reports a problem with their order. Check the details in the conversation.',
          ),
        } as HandoffNodeConfig,
      },
      {
        node_key: 'handoff_directo',
        node_type: 'handoff',
        config: {
          note: tr(
            locale,
            'El cliente necesita ayuda con su pedido después de la compra.',
            'The customer needs help with their order after purchase.',
          ),
        } as HandoffNodeConfig,
      },
      {
        node_key: 'fin_ok',
        node_type: 'end',
        config: {},
      },
    ],
  };
}

const BUILDERS: Record<string, (locale: Locale) => FlowTemplate> = {
  ventas_asesor: ventasAsesor,
  atencion_24_7: atencion247,
  post_venta: postVenta,
};

export function getFlowTemplate(slug: string, locale: Locale = 'es'): FlowTemplate | null {
  const build = BUILDERS[slug];
  return build ? build(locale) : null;
}

/**
 * i18n keys for a template's gallery name / pitch, resolved by the UI
 * (`useT`) and the clone route (`translate`) so the gallery follows the
 * active locale. The literal `name`/`description` on the template object
 * are the Spanish source-of-truth fallback. Seed node CONTENT is NOT
 * keyed here — those are customer-facing message bodies the merchant
 * edits after cloning.
 */
export function flowTemplateNameKey(slug: string): string {
  return `flows.tpl_${slug}_name`;
}
export function flowTemplateDescKey(slug: string): string {
  return `flows.tpl_${slug}_desc`;
}

export function listFlowTemplates(locale: Locale = 'es'): FlowTemplate[] {
  return Object.values(BUILDERS).map((build) => build(locale));
}
