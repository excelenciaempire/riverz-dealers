/**
 * Pre-canned flow templates oriented around the Shopify customer-service
 * journey. Each one is a complete flow — clone it once, hook it up to
 * an approved template / set of tags, activate, done.
 *
 * The clone path (`/api/flows` POST with `template_slug`) creates a
 * NEW flow_row + flow_nodes rows for the user; node_keys stay stable
 * (they're not UUIDs), so cloning never needs to rewrite edges.
 *
 * Why hand-authored objects vs a DB gallery: the set changes with
 * releases, not data, and shipping in source means no migration to
 * add the next one.
 */

import type {
  AiIntentNodeConfig,
  CollectInputNodeConfig,
  ConditionNodeConfig,
  HandoffNodeConfig,
  KeywordTriggerConfig,
  SendButtonsNodeConfig,
  SendCtaUrlNodeConfig,
  SendDocumentNodeConfig,
  SendImageNodeConfig,
  SendListNodeConfig,
  SendMessageNodeConfig,
  SendVideoNodeConfig,
  SetTagNodeConfig,
  ShopifyLookupNodeConfig,
  StartNodeConfig,
  WaitNodeConfig,
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
  config:
    | StartNodeConfig
    | SendMessageNodeConfig
    | SendButtonsNodeConfig
    | SendListNodeConfig
    | SendImageNodeConfig
    | SendVideoNodeConfig
    | SendDocumentNodeConfig
    | SendCtaUrlNodeConfig
    | CollectInputNodeConfig
    | ConditionNodeConfig
    | SetTagNodeConfig
    | HandoffNodeConfig
    | WaitNodeConfig
    | AiIntentNodeConfig
    | ShopifyLookupNodeConfig
    | Record<string, unknown>;
}

export interface FlowTemplate {
  slug: string;
  name: string;
  description: string;
  icon:
    | 'MessageSquare'
    | 'HelpCircle'
    | 'UserPlus'
    | 'Package'
    | 'ShoppingBag'
    | 'Truck';
  trigger_type: 'keyword' | 'first_inbound_message' | 'manual';
  trigger_config: KeywordTriggerConfig | Record<string, unknown>;
  entry_node_id: string;
  nodes: FlowTemplateNode[];
}

// ============================================================
// 1. Atención principal — main router menu
// ============================================================
// First inbound message → 3 button menu → routes to specialized
// branches. The first piece every Shopify store wants.
const MAIN_MENU: FlowTemplate = {
  slug: 'main_menu',
  name: 'Atención principal',
  description:
    'Cuando alguien escribe por primera vez, le mostrás un menú con 3 botones: estado del pedido, soporte y hablar con un humano.',
  icon: 'MessageSquare',
  trigger_type: 'first_inbound_message',
  trigger_config: {},
  entry_node_id: 'start',
  nodes: [
    {
      node_key: 'start',
      node_type: 'start',
      config: { next_node_key: 'menu' } as StartNodeConfig,
    },
    {
      node_key: 'menu',
      node_type: 'send_buttons',
      config: {
        header_text: '¡Hola!',
        text: '¿En qué te podemos ayudar hoy?',
        footer_text: 'Tocá una opción.',
        buttons: [
          { reply_id: 'status', title: 'Mi pedido', next_node_key: 'ask_order_number' },
          { reply_id: 'support', title: 'Tengo una duda', next_node_key: 'faq_router' },
          { reply_id: 'human', title: 'Hablar con asesor', next_node_key: 'handoff_node' },
        ],
      } as SendButtonsNodeConfig,
    },
    {
      node_key: 'ask_order_number',
      node_type: 'collect_input',
      config: {
        prompt_text: 'Pasame el número de tu pedido (por ejemplo: 1042).',
        var_key: 'order_number',
        next_node_key: 'lookup',
      } as CollectInputNodeConfig,
    },
    {
      node_key: 'lookup',
      node_type: 'shopify_lookup',
      config: {
        kind: 'order_by_number',
        input_var: 'order_number',
        output_prefix: 'order',
        found_next_key: 'order_found',
        not_found_next_key: 'order_not_found',
      } as ShopifyLookupNodeConfig,
    },
    {
      node_key: 'order_found',
      node_type: 'send_message',
      config: {
        text:
          'Tu pedido {{vars.order_name}} está en estado *{{vars.order_fulfillment_status}}*.\n' +
          'Total: {{vars.order_total}}.\n' +
          '{{vars.order_tracking_url}}',
        next_node_key: 'end_ok',
      } as SendMessageNodeConfig,
    },
    {
      node_key: 'order_not_found',
      node_type: 'send_message',
      config: {
        text:
          'No encontré un pedido con ese número. Te paso con un asesor para que te ayude.',
        next_node_key: 'handoff_node',
      } as SendMessageNodeConfig,
    },
    {
      node_key: 'faq_router',
      node_type: 'send_list',
      config: {
        text: '¿Sobre qué tema tenés la duda?',
        button_label: 'Ver opciones',
        sections: [
          {
            title: 'Más consultadas',
            rows: [
              { reply_id: 'shipping', title: 'Envíos', description: 'Tiempos y costos', next_node_key: 'faq_shipping' },
              { reply_id: 'returns', title: 'Cambios y devoluciones', description: 'Política y plazos', next_node_key: 'faq_returns' },
              { reply_id: 'payment', title: 'Pagos', description: 'Medios aceptados', next_node_key: 'faq_payment' },
            ],
          },
        ],
      } as SendListNodeConfig,
    },
    {
      node_key: 'faq_shipping',
      node_type: 'send_message',
      config: {
        text:
          'Enviamos a todo el país en 2 a 5 días hábiles. El costo se calcula en el checkout según tu ciudad.',
        next_node_key: 'end_ok',
      } as SendMessageNodeConfig,
    },
    {
      node_key: 'faq_returns',
      node_type: 'send_message',
      config: {
        text:
          'Aceptamos cambios y devoluciones dentro de los 15 días posteriores a recibir el pedido. El producto debe estar sin uso y con su empaque original.',
        next_node_key: 'end_ok',
      } as SendMessageNodeConfig,
    },
    {
      node_key: 'faq_payment',
      node_type: 'send_message',
      config: {
        text:
          'Aceptamos tarjeta de crédito, débito, PSE, Nequi y transferencia bancaria.',
        next_node_key: 'end_ok',
      } as SendMessageNodeConfig,
    },
    {
      node_key: 'handoff_node',
      node_type: 'handoff',
      config: {
        note: 'Cliente pidió hablar con un humano desde el menú principal.',
      } as HandoffNodeConfig,
    },
    {
      node_key: 'end_ok',
      node_type: 'end',
      config: {},
    },
  ],
};

// ============================================================
// 2. Estado del pedido — standalone
// ============================================================
// Same lookup chain but launched by the keyword "pedido" / "orden",
// for stores that already have a different main menu.
const ORDER_STATUS: FlowTemplate = {
  slug: 'order_status',
  name: 'Estado del pedido',
  description:
    'El cliente escribe "pedido" o "estado", le pedís el número y le devolvés el estado con el link de tracking real de Shopify.',
  icon: 'Truck',
  trigger_type: 'keyword',
  trigger_config: {
    keywords: ['pedido', 'orden', 'estado', 'tracking', 'mi compra'],
    match_type: 'contains',
  },
  entry_node_id: 'start',
  nodes: [
    {
      node_key: 'start',
      node_type: 'start',
      config: { next_node_key: 'ask_order_number' } as StartNodeConfig,
    },
    {
      node_key: 'ask_order_number',
      node_type: 'collect_input',
      config: {
        prompt_text:
          'Con gusto te ayudamos. ¿Cuál es el número de tu pedido? (ej: 1042)',
        var_key: 'order_number',
        next_node_key: 'lookup',
      } as CollectInputNodeConfig,
    },
    {
      node_key: 'lookup',
      node_type: 'shopify_lookup',
      config: {
        kind: 'order_by_number',
        input_var: 'order_number',
        output_prefix: 'order',
        found_next_key: 'reply_found',
        not_found_next_key: 'reply_not_found',
      } as ShopifyLookupNodeConfig,
    },
    {
      node_key: 'reply_found',
      node_type: 'send_message',
      config: {
        text:
          '📦 Pedido {{vars.order_name}}\n' +
          'Estado: *{{vars.order_fulfillment_status}}*\n' +
          'Total: {{vars.order_total}}',
        next_node_key: 'reply_tracking',
      } as SendMessageNodeConfig,
    },
    {
      node_key: 'reply_tracking',
      node_type: 'send_cta_url',
      config: {
        text: 'Acá podés ver el detalle y seguir el envío en tiempo real.',
        button_title: 'Ver mi pedido',
        url: '{{vars.order_status_url}}',
        next_node_key: 'end_ok',
      } as SendCtaUrlNodeConfig,
    },
    {
      node_key: 'reply_not_found',
      node_type: 'send_message',
      config: {
        text:
          'No encontré un pedido con ese número. Revisá que esté bien escrito o te conecto con un asesor.',
        next_node_key: 'handoff_node',
      } as SendMessageNodeConfig,
    },
    {
      node_key: 'handoff_node',
      node_type: 'handoff',
      config: { note: 'Búsqueda de pedido sin resultado.' } as HandoffNodeConfig,
    },
    { node_key: 'end_ok', node_type: 'end', config: {} },
  ],
};

// ============================================================
// 3. FAQ con IA — IA clasifica preguntas libres y responde
// ============================================================
const FAQ_AI: FlowTemplate = {
  slug: 'faq_ai',
  name: 'Preguntas frecuentes con IA',
  description:
    'El cliente escribe su duda libre, la IA la clasifica y le manda la respuesta correcta. Si no encaja, lo pasa a un humano.',
  icon: 'HelpCircle',
  trigger_type: 'first_inbound_message',
  trigger_config: {},
  entry_node_id: 'start',
  nodes: [
    {
      node_key: 'start',
      node_type: 'start',
      config: { next_node_key: 'classify' } as StartNodeConfig,
    },
    {
      node_key: 'classify',
      node_type: 'ai_intent',
      config: {
        prompt_text: '¡Hola! Contame en qué te puedo ayudar.',
        intents: [
          { intent_key: 'shipping', description: 'Pregunta sobre tiempos o costos de envío', next_node_key: 'reply_shipping' },
          { intent_key: 'returns', description: 'Pregunta sobre cambios, devoluciones o reembolsos', next_node_key: 'reply_returns' },
          { intent_key: 'product', description: 'Consulta sobre un producto específico, su precio o disponibilidad', next_node_key: 'handoff_product' },
          { intent_key: 'order', description: 'Pregunta por el estado de un pedido o tracking', next_node_key: 'jump_status' },
        ],
        fallback_next_key: 'handoff_general',
      } as AiIntentNodeConfig,
    },
    {
      node_key: 'reply_shipping',
      node_type: 'send_message',
      config: {
        text: 'Enviamos a todo el país en 2-5 días hábiles. El costo se calcula al pagar según tu ciudad.',
        next_node_key: 'end_ok',
      } as SendMessageNodeConfig,
    },
    {
      node_key: 'reply_returns',
      node_type: 'send_message',
      config: {
        text: 'Aceptamos cambios y devoluciones dentro de los 15 días posteriores a recibir el pedido. Producto sin uso y con empaque.',
        next_node_key: 'end_ok',
      } as SendMessageNodeConfig,
    },
    {
      node_key: 'jump_status',
      node_type: 'send_message',
      config: {
        text: 'Para ver el estado de tu pedido, escribí "pedido" seguido del número.',
        next_node_key: 'end_ok',
      } as SendMessageNodeConfig,
    },
    {
      node_key: 'handoff_product',
      node_type: 'handoff',
      config: { note: 'Consulta de producto — necesita asesor.' } as HandoffNodeConfig,
    },
    {
      node_key: 'handoff_general',
      node_type: 'handoff',
      config: { note: 'Consulta no clasificada por la IA.' } as HandoffNodeConfig,
    },
    { node_key: 'end_ok', node_type: 'end', config: {} },
  ],
};

// ============================================================
// 4. Catálogo + asesoría
// ============================================================
const CATALOG_INTRO: FlowTemplate = {
  slug: 'catalog_intro',
  name: 'Catálogo + asesoría',
  description:
    'Saludo con imagen de portada, botones para ver el catálogo, hablar con asesor o ver pedidos.',
  icon: 'ShoppingBag',
  trigger_type: 'keyword',
  trigger_config: {
    keywords: ['catalogo', 'catálogo', 'productos', 'precios'],
    match_type: 'contains',
  },
  entry_node_id: 'start',
  nodes: [
    {
      node_key: 'start',
      node_type: 'start',
      config: { next_node_key: 'welcome_banner' } as StartNodeConfig,
    },
    {
      node_key: 'welcome_banner',
      node_type: 'send_image',
      config: {
        url: 'https://placehold.co/800x400.png',
        caption: '¡Bienvenido! 👋 Mirá nuestras novedades.',
        next_node_key: 'menu',
      } as SendImageNodeConfig,
    },
    {
      node_key: 'menu',
      node_type: 'send_buttons',
      config: {
        text: '¿Qué te gustaría hacer?',
        buttons: [
          { reply_id: 'open_store', title: 'Ver catálogo', next_node_key: 'open_store_cta' },
          { reply_id: 'advisor', title: 'Asesoría', next_node_key: 'handoff_node' },
          { reply_id: 'orders', title: 'Mis pedidos', next_node_key: 'jump_orders' },
        ],
      } as SendButtonsNodeConfig,
    },
    {
      node_key: 'open_store_cta',
      node_type: 'send_cta_url',
      config: {
        text: 'Hacé click acá para entrar a la tienda.',
        button_title: 'Abrir tienda',
        url: 'https://tu-tienda.myshopify.com',
        next_node_key: 'end_ok',
      } as SendCtaUrlNodeConfig,
    },
    {
      node_key: 'jump_orders',
      node_type: 'send_message',
      config: {
        text: 'Escribí "pedido" y te ayudamos a ver el estado.',
        next_node_key: 'end_ok',
      } as SendMessageNodeConfig,
    },
    {
      node_key: 'handoff_node',
      node_type: 'handoff',
      config: { note: 'Quiere asesoría desde el menú de catálogo.' } as HandoffNodeConfig,
    },
    { node_key: 'end_ok', node_type: 'end', config: {} },
  ],
};

// ============================================================
// Registry
// ============================================================
const TEMPLATES: Record<string, FlowTemplate> = {
  main_menu: MAIN_MENU,
  order_status: ORDER_STATUS,
  faq_ai: FAQ_AI,
  catalog_intro: CATALOG_INTRO,
};

export function getFlowTemplate(slug: string): FlowTemplate | null {
  return TEMPLATES[slug] ?? null;
}

export function listFlowTemplates(): FlowTemplate[] {
  return Object.values(TEMPLATES);
}
