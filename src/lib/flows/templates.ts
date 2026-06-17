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

const VENTAS_ASESOR: FlowTemplate = {
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
        header_text: '¡Hola! 👋',
        text: 'Soy tu asesor de la tienda. ¿Qué quieres hacer hoy?',
        footer_text: 'Toca una opción.',
        buttons: [
          { reply_id: 'productos', title: 'Ver productos', next_node_key: 'cat_list' },
          { reply_id: 'duda', title: 'Tengo una duda', next_node_key: 'dudas_list' },
          { reply_id: 'asesor', title: 'Hablar con asesor', next_node_key: 'handoff_directo' },
        ],
      } as SendButtonsNodeConfig,
    },
    {
      node_key: 'cat_list',
      node_type: 'send_list',
      config: {
        text: '¿Qué te interesa ver?',
        button_label: 'Ver categorías',
        sections: [
          {
            title: 'Catálogo',
            rows: [
              { reply_id: 'top', title: 'Lo más vendido', description: 'Los favoritos', next_node_key: 'reco_top' },
              { reply_id: 'nuevo', title: 'Novedades', description: 'Lo último que llegó', next_node_key: 'reco_nuevo' },
              { reply_id: 'ofertas', title: 'Ofertas', description: 'Precios especiales', next_node_key: 'reco_ofertas' },
              { reply_id: 'ayuda', title: 'No sé, asesórame', description: 'Te ayudo a elegir', next_node_key: 'asesor_ai' },
            ],
          },
        ],
      } as SendListNodeConfig,
    },
    {
      node_key: 'reco_top',
      node_type: 'send_cta_url',
      config: {
        header_text: 'Lo más vendido',
        text: 'Estos son los favoritos de nuestros clientes. Míralos y elige el tuyo.',
        footer_text: 'Envío rápido a todo el país.',
        button_title: 'Ver productos',
        url: 'https://tu-tienda.com/collections/mas-vendidos',
        next_node_key: 'seguir',
      } as SendCtaUrlNodeConfig,
    },
    {
      node_key: 'reco_nuevo',
      node_type: 'send_cta_url',
      config: {
        header_text: 'Novedades',
        text: 'Lo último que sumamos a la tienda. Echa un vistazo antes de que se agote.',
        footer_text: 'Stock limitado.',
        button_title: 'Ver productos',
        url: 'https://tu-tienda.com/collections/novedades',
        next_node_key: 'seguir',
      } as SendCtaUrlNodeConfig,
    },
    {
      node_key: 'reco_ofertas',
      node_type: 'send_cta_url',
      config: {
        header_text: 'Ofertas',
        text: 'Aprovecha los productos con precio especial por tiempo limitado.',
        footer_text: 'Hasta agotar stock.',
        button_title: 'Ver ofertas',
        url: 'https://tu-tienda.com/collections/ofertas',
        next_node_key: 'seguir',
      } as SendCtaUrlNodeConfig,
    },
    {
      node_key: 'asesor_ai',
      node_type: 'ai_intent',
      config: {
        prompt_text: 'Cuéntame qué buscas o para qué lo necesitas y te recomiendo.',
        intents: [
          { intent_key: 'producto', description: 'Describe un producto o una necesidad concreta.', next_node_key: 'reco_top' },
          { intent_key: 'envios', description: 'Pregunta por envíos, tiempos o costos.', next_node_key: 'resp_envios' },
          { intent_key: 'precio', description: 'Pregunta por precio, pagos o descuentos.', next_node_key: 'resp_pagos' },
          { intent_key: 'humano', description: 'Pide hablar con una persona.', next_node_key: 'handoff_directo' },
        ],
        fallback_next_key: 'handoff_directo',
      } as AiIntentNodeConfig,
    },
    {
      node_key: 'seguir',
      node_type: 'send_buttons',
      config: {
        text: '¿Cómo seguimos?',
        footer_text: 'Toca una opción.',
        buttons: [
          { reply_id: 'comprar', title: 'Comprar ahora', next_node_key: 'cierre_cta' },
          { reply_id: 'duda2', title: 'Tengo una duda', next_node_key: 'dudas_list' },
          { reply_id: 'asesor2', title: 'Hablar con asesor', next_node_key: 'handoff_directo' },
        ],
      } as SendButtonsNodeConfig,
    },
    {
      node_key: 'dudas_list',
      node_type: 'send_list',
      config: {
        text: '¿Sobre qué quieres saber?',
        button_label: 'Ver temas',
        sections: [
          {
            title: 'Tus dudas',
            rows: [
              { reply_id: 'envios', title: 'Envíos', description: 'Tiempos y costos', next_node_key: 'resp_envios' },
              { reply_id: 'pagos', title: 'Medios de pago', description: 'Qué aceptamos', next_node_key: 'resp_pagos' },
              { reply_id: 'garantia', title: 'Garantía', description: 'Cobertura y plazos', next_node_key: 'resp_garantia' },
              { reply_id: 'cambios', title: 'Cambios', description: 'Política de cambios', next_node_key: 'resp_cambios' },
            ],
          },
        ],
      } as SendListNodeConfig,
    },
    {
      node_key: 'resp_envios',
      node_type: 'send_message',
      config: {
        text: 'Enviamos a todo el país en 2 a 5 días hábiles. El costo se calcula al pagar según tu ciudad, y el envío es gratis desde cierto monto. 🚚',
        next_node_key: 'seguir',
      } as SendMessageNodeConfig,
    },
    {
      node_key: 'resp_pagos',
      node_type: 'send_message',
      config: {
        text: 'Aceptamos tarjeta de crédito y débito, transferencia y pago contra entrega en zonas seleccionadas. 💳',
        next_node_key: 'seguir',
      } as SendMessageNodeConfig,
    },
    {
      node_key: 'resp_garantia',
      node_type: 'send_message',
      config: {
        text: 'Todos los productos tienen garantía. Si llega con algún defecto, lo cambiamos sin costo. ✅',
        next_node_key: 'seguir',
      } as SendMessageNodeConfig,
    },
    {
      node_key: 'resp_cambios',
      node_type: 'send_message',
      config: {
        text: 'Tienes 15 días para cambiar tu producto si no quedaste conforme. Debe estar sin uso y con su empaque. 🔁',
        next_node_key: 'seguir',
      } as SendMessageNodeConfig,
    },
    {
      node_key: 'cierre_cta',
      node_type: 'send_cta_url',
      config: {
        header_text: 'Termina tu compra',
        text: '¡Genial! Finaliza tu compra de forma segura. Si necesitas ayuda, escríbeme por aquí.',
        footer_text: 'Pago 100% seguro.',
        button_title: 'Ir a pagar',
        url: 'https://tu-tienda.com/checkout',
        next_node_key: 'fin_ok',
      } as SendCtaUrlNodeConfig,
    },
    {
      node_key: 'handoff_directo',
      node_type: 'handoff',
      config: {
        note: 'El cliente quiere comprar o tiene una duda que el flujo no resolvió. Continúa la venta.',
      } as HandoffNodeConfig,
    },
    {
      node_key: 'fin_ok',
      node_type: 'end',
      config: {},
    },
  ],
};

// ============================================================
// 2) Atención al cliente 24/7
// ============================================================
// Estructura:
//   [menu_root] ─┬─ "Mi pedido"  → pide número → Shopify → estado / no encontrado
//                ├─ "Preguntas"  → lista de 6 temas → respuesta → otra_pregunta
//                └─ "Hablar con humano" → handoff
// El tema "Cambios y devolución" ofrece iniciar la devolución (captura el
// número y deriva a una persona).

const ATENCION_24_7: FlowTemplate = {
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
        header_text: '¡Hola! 👋',
        text: 'Soy el asistente de la tienda. ¿En qué te ayudo?',
        footer_text: 'Toca una opción.',
        buttons: [
          { reply_id: 'pedido', title: 'Mi pedido', next_node_key: 'pedido_num' },
          { reply_id: 'preguntas', title: 'Preguntas', next_node_key: 'faq_list' },
          { reply_id: 'humano', title: 'Hablar con humano', next_node_key: 'handoff_directo' },
        ],
      } as SendButtonsNodeConfig,
    },
    {
      node_key: 'pedido_num',
      node_type: 'collect_input',
      config: {
        prompt_text: 'Escribe el número de tu pedido (por ejemplo: 1042). Lo encuentras en tu correo de confirmación.',
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
        text:
          '📦 Pedido {{vars.order_name}}\n' +
          'Estado: *{{vars.order_fulfillment_status}}*\n' +
          'Total: {{vars.order_total}}\n' +
          'Seguimiento: {{vars.order_tracking_url}}',
        next_node_key: 'algo_mas',
      } as SendMessageNodeConfig,
    },
    {
      node_key: 'pedido_no_encontrado',
      node_type: 'send_message',
      config: {
        text: 'No encontré un pedido con ese número 😕. Te paso con una persona para que lo revise.',
        next_node_key: 'handoff_directo',
      } as SendMessageNodeConfig,
    },
    {
      node_key: 'algo_mas',
      node_type: 'send_buttons',
      config: {
        text: '¿Te ayudo con algo más?',
        buttons: [
          { reply_id: 'menu', title: 'Volver al menú', next_node_key: 'menu_root' },
          { reply_id: 'humano2', title: 'Hablar con humano', next_node_key: 'handoff_directo' },
          { reply_id: 'listo', title: 'Listo, gracias', next_node_key: 'fin_ok' },
        ],
      } as SendButtonsNodeConfig,
    },
    {
      node_key: 'faq_list',
      node_type: 'send_list',
      config: {
        text: '¿Sobre qué tema quieres saber?',
        button_label: 'Ver temas',
        sections: [
          {
            title: 'Las más consultadas',
            rows: [
              { reply_id: 'envios', title: 'Envíos', description: 'Tiempos y costos', next_node_key: 'faq_envios' },
              { reply_id: 'devoluciones', title: 'Cambios y devolución', description: 'Política y plazos', next_node_key: 'faq_devoluciones' },
              { reply_id: 'pagos', title: 'Medios de pago', description: 'Qué aceptamos', next_node_key: 'faq_pagos' },
              { reply_id: 'tallas', title: 'Tallas y medidas', description: 'Guía de talles', next_node_key: 'faq_tallas' },
              { reply_id: 'tienda', title: 'Tienda física', description: 'Dirección y horario', next_node_key: 'faq_tienda' },
              { reply_id: 'garantia', title: 'Garantía', description: 'Cobertura y plazos', next_node_key: 'faq_garantia' },
            ],
          },
        ],
      } as SendListNodeConfig,
    },
    {
      node_key: 'faq_envios',
      node_type: 'send_message',
      config: {
        text: 'Enviamos a todo el país en 2 a 5 días hábiles. El costo se calcula al pagar según tu ciudad, y el envío es gratis desde cierto monto. 🚚',
        next_node_key: 'otra_pregunta',
      } as SendMessageNodeConfig,
    },
    {
      node_key: 'faq_devoluciones',
      node_type: 'send_message',
      config: {
        text: 'Aceptamos cambios y devoluciones dentro de los 15 días de recibir el pedido. El producto debe estar sin uso y con su empaque original. 🔁',
        next_node_key: 'devolucion_buttons',
      } as SendMessageNodeConfig,
    },
    {
      node_key: 'devolucion_buttons',
      node_type: 'send_buttons',
      config: {
        text: '¿Quieres iniciar una devolución?',
        buttons: [
          { reply_id: 'iniciar', title: 'Iniciar devolución', next_node_key: 'dev_collect' },
          { reply_id: 'temas', title: 'Ver otros temas', next_node_key: 'faq_list' },
          { reply_id: 'listo_dev', title: 'Listo, gracias', next_node_key: 'fin_ok' },
        ],
      } as SendButtonsNodeConfig,
    },
    {
      node_key: 'dev_collect',
      node_type: 'collect_input',
      config: {
        prompt_text: 'Escribe el número del pedido que quieres devolver y, si puedes, el motivo.',
        var_key: 'pedido_devolucion',
        next_node_key: 'dev_handoff',
      } as CollectInputNodeConfig,
    },
    {
      node_key: 'dev_handoff',
      node_type: 'handoff',
      config: {
        note: 'El cliente quiere iniciar una devolución. Revisa el número de pedido y el motivo en la conversación.',
      } as HandoffNodeConfig,
    },
    {
      node_key: 'faq_pagos',
      node_type: 'send_message',
      config: {
        text: 'Aceptamos tarjeta de crédito y débito, transferencia y pago contra entrega en zonas seleccionadas. 💳',
        next_node_key: 'otra_pregunta',
      } as SendMessageNodeConfig,
    },
    {
      node_key: 'faq_tallas',
      node_type: 'send_message',
      config: {
        text: 'Cada producto tiene su guía de tallas en la ficha. Si tienes dudas con una prenda, escribe su nombre y te ayudo. 📏',
        next_node_key: 'otra_pregunta',
      } as SendMessageNodeConfig,
    },
    {
      node_key: 'faq_tienda',
      node_type: 'send_message',
      config: {
        text: '📍 Calle Falsa 123, tu ciudad.\nLunes a sábado de 10:00 a 19:00.\nDomingos cerrado.',
        next_node_key: 'otra_pregunta',
      } as SendMessageNodeConfig,
    },
    {
      node_key: 'faq_garantia',
      node_type: 'send_message',
      config: {
        text: 'Todos los productos tienen garantía. Si llega con algún defecto, lo cambiamos sin costo. ✅',
        next_node_key: 'otra_pregunta',
      } as SendMessageNodeConfig,
    },
    {
      node_key: 'otra_pregunta',
      node_type: 'send_buttons',
      config: {
        text: '¿Tienes otra pregunta?',
        buttons: [
          { reply_id: 'temas2', title: 'Ver temas', next_node_key: 'faq_list' },
          { reply_id: 'humano3', title: 'Hablar con humano', next_node_key: 'handoff_directo' },
          { reply_id: 'listo2', title: 'Listo, gracias', next_node_key: 'fin_ok' },
        ],
      } as SendButtonsNodeConfig,
    },
    {
      node_key: 'handoff_directo',
      node_type: 'handoff',
      config: {
        note: 'El cliente pidió hablar con una persona desde el menú de atención.',
      } as HandoffNodeConfig,
    },
    {
      node_key: 'fin_ok',
      node_type: 'end',
      config: {},
    },
  ],
};

// ============================================================
// 3) Post-venta / seguimiento
// ============================================================
// Estructura:
//   [menu_root: lista] ─┬─ "Seguir mi envío" → número → Shopify → estado → ¿todo bien?
//                       ├─ "Mi factura"      → mensaje → ¿algo más?
//                       ├─ "Tengo un problema" → captura → handoff
//                       ├─ "Dejar reseña"    → CTA reseña → fin
//                       └─ "Hablar con humano" → handoff

const POST_VENTA: FlowTemplate = {
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
        header_text: '¡Hola de nuevo! 👋',
        text: 'Gracias por tu compra. ¿En qué te ayudo?',
        button_label: 'Ver opciones',
        sections: [
          {
            title: 'Después de tu compra',
            rows: [
              { reply_id: 'envio', title: 'Seguir mi envío', description: 'Estado y tracking', next_node_key: 'track_num' },
              { reply_id: 'factura', title: 'Mi factura', description: 'Comprobante de compra', next_node_key: 'factura_msg' },
              { reply_id: 'problema', title: 'Tengo un problema', description: 'Algo salió mal', next_node_key: 'prob_collect' },
              { reply_id: 'resena', title: 'Dejar reseña', description: 'Cuéntanos tu experiencia', next_node_key: 'resena_cta' },
              { reply_id: 'humano', title: 'Hablar con humano', description: 'Te atiende una persona', next_node_key: 'handoff_directo' },
            ],
          },
        ],
      } as SendListNodeConfig,
    },
    {
      node_key: 'track_num',
      node_type: 'collect_input',
      config: {
        prompt_text: 'Escribe tu número de pedido (por ejemplo: 1042) y reviso el estado del envío.',
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
        text:
          '📦 Pedido {{vars.order_name}}\n' +
          'Estado: *{{vars.order_fulfillment_status}}*\n' +
          'Seguimiento: {{vars.order_tracking_url}}',
        next_node_key: 'todo_bien',
      } as SendMessageNodeConfig,
    },
    {
      node_key: 'track_no',
      node_type: 'send_message',
      config: {
        text: 'No encontré un pedido con ese número 😕. Te paso con una persona para que lo revise.',
        next_node_key: 'handoff_directo',
      } as SendMessageNodeConfig,
    },
    {
      node_key: 'todo_bien',
      node_type: 'send_buttons',
      config: {
        text: '¿Llegó todo bien?',
        buttons: [
          { reply_id: 'bien', title: 'Sí, todo bien', next_node_key: 'resena_cta' },
          { reply_id: 'demora', title: 'Aún no llega', next_node_key: 'no_llega' },
          { reply_id: 'problema2', title: 'Tuve un problema', next_node_key: 'prob_collect' },
        ],
      } as SendButtonsNodeConfig,
    },
    {
      node_key: 'no_llega',
      node_type: 'send_message',
      config: {
        text: 'Lamento la demora. Si tu pedido tarda más de lo esperado, lo revisamos contigo. Te paso con una persona para darte una solución.',
        next_node_key: 'handoff_directo',
      } as SendMessageNodeConfig,
    },
    {
      node_key: 'factura_msg',
      node_type: 'send_message',
      config: {
        text: 'Enviamos la factura al correo de tu pedido. Si no la ves, revisa spam o pídela aquí y te la reenviamos.',
        next_node_key: 'factura_buttons',
      } as SendMessageNodeConfig,
    },
    {
      node_key: 'factura_buttons',
      node_type: 'send_buttons',
      config: {
        text: '¿Necesitas algo más?',
        buttons: [
          { reply_id: 'reenviar', title: 'Reenviar factura', next_node_key: 'handoff_directo' },
          { reply_id: 'menu', title: 'Volver al menú', next_node_key: 'menu_root' },
          { reply_id: 'listo', title: 'Listo, gracias', next_node_key: 'fin_ok' },
        ],
      } as SendButtonsNodeConfig,
    },
    {
      node_key: 'resena_cta',
      node_type: 'send_cta_url',
      config: {
        header_text: 'Tu opinión nos ayuda',
        text: '¿Nos dejas una reseña? Toma un minuto y nos ayuda muchísimo. 🙏',
        footer_text: '¡Gracias por tu compra!',
        button_title: 'Dejar reseña',
        url: 'https://tu-tienda.com/reseñas',
        next_node_key: 'fin_ok',
      } as SendCtaUrlNodeConfig,
    },
    {
      node_key: 'prob_collect',
      node_type: 'collect_input',
      config: {
        prompt_text: 'Cuéntame qué pasó con tu pedido y lo resolvemos. Si puedes, incluye el número de pedido.',
        var_key: 'problema',
        next_node_key: 'prob_handoff',
      } as CollectInputNodeConfig,
    },
    {
      node_key: 'prob_handoff',
      node_type: 'handoff',
      config: {
        note: 'El cliente reporta un problema con su pedido. Revisa el detalle en la conversación.',
      } as HandoffNodeConfig,
    },
    {
      node_key: 'handoff_directo',
      node_type: 'handoff',
      config: {
        note: 'El cliente necesita ayuda con su pedido después de la compra.',
      } as HandoffNodeConfig,
    },
    {
      node_key: 'fin_ok',
      node_type: 'end',
      config: {},
    },
  ],
};

const TEMPLATES: Record<string, FlowTemplate> = {
  ventas_asesor: VENTAS_ASESOR,
  atencion_24_7: ATENCION_24_7,
  post_venta: POST_VENTA,
};

export function getFlowTemplate(slug: string): FlowTemplate | null {
  return TEMPLATES[slug] ?? null;
}

export function listFlowTemplates(): FlowTemplate[] {
  return Object.values(TEMPLATES);
}
