/**
 * Plantillas de flujo para clonar con un click.
 *
 * Por ahora una sola, pensada como demo educativa: la conversación
 * típica de atención al cliente de una tienda Shopify Latam. Cubre los
 * tres caminos más pedidos (estado de pedido / preguntas frecuentes /
 * hablar con humano) y muestra cómo se encadenan distintos tipos de
 * nodo — quick-reply buttons, list messages, condiciones de Shopify,
 * handoff. Todo editable después de clonar.
 */

import type {
  CollectInputNodeConfig,
  HandoffNodeConfig,
  KeywordTriggerConfig,
  SendButtonsNodeConfig,
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
  description: string;
  icon: 'MessageSquare' | 'HelpCircle' | 'UserPlus' | 'Package' | 'ShoppingBag';
  trigger_type: 'keyword' | 'first_inbound_message' | 'manual';
  trigger_config: KeywordTriggerConfig | Record<string, unknown>;
  entry_node_id: string;
  nodes: FlowTemplateNode[];
}

// ============================================================
// Atención al cliente — demo de tienda Shopify
// ============================================================
// Estructura:
//
//   [Trigger: primer mensaje]
//       ↓
//   [menu_root] ─┬─ "Mi pedido"     → pide número → busca en Shopify
//                │                    ├── encontrado → muestra estado → fin
//                │                    └── no encontrado → handoff
//                ├─ "Preguntas"      → lista con 5 temas → respuesta por tema → fin
//                └─ "Hablar conmigo" → handoff a humano

const ATENCION_CLIENTE: FlowTemplate = {
  slug: 'atencion_cliente',
  name: 'Atención al cliente',
  description:
    'El cliente escribe y le aparece un menú con 3 botones: ver su pedido, preguntas frecuentes o hablar con un humano. Cada botón abre una sub-ruta.',
  icon: 'MessageSquare',
  trigger_type: 'first_inbound_message',
  trigger_config: {},
  entry_node_id: 'menu_root',
  nodes: [
    // ────────── menú principal ──────────
    {
      node_key: 'menu_root',
      node_type: 'send_buttons',
      config: {
        header_text: '¡Hola! 👋',
        text: 'Soy el asistente de la tienda. ¿En qué te ayudo?',
        footer_text: 'Tocá una opción.',
        buttons: [
          { reply_id: 'pedido', title: 'Mi pedido', next_node_key: 'pedido_pedir_numero' },
          { reply_id: 'preguntas', title: 'Preguntas', next_node_key: 'preguntas_list' },
          { reply_id: 'asesor', title: 'Hablar conmigo', next_node_key: 'handoff_directo' },
        ],
      } as SendButtonsNodeConfig,
    },

    // ────────── rama "Mi pedido" ──────────
    {
      node_key: 'pedido_pedir_numero',
      node_type: 'collect_input',
      config: {
        prompt_text: 'Pasame el número de tu pedido (por ejemplo: 1042).',
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
        found_next_key: 'pedido_responder_encontrado',
        not_found_next_key: 'pedido_no_encontrado',
      } as ShopifyLookupNodeConfig,
    },
    {
      node_key: 'pedido_responder_encontrado',
      node_type: 'send_message',
      config: {
        text:
          '📦 Pedido {{vars.order_name}}\n' +
          'Estado: *{{vars.order_fulfillment_status}}*\n' +
          'Total: {{vars.order_total}}\n\n' +
          'Acá podés ver el detalle: {{vars.order_status_url}}',
        next_node_key: 'fin_ok',
      } as SendMessageNodeConfig,
    },
    {
      node_key: 'pedido_no_encontrado',
      node_type: 'send_message',
      config: {
        text:
          'No encontré un pedido con ese número 😕. Te conecto con un asesor para que lo revise.',
        next_node_key: 'handoff_directo',
      } as SendMessageNodeConfig,
    },

    // ────────── rama "Preguntas frecuentes" ──────────
    {
      node_key: 'preguntas_list',
      node_type: 'send_list',
      config: {
        text: '¿Sobre qué tema querés saber?',
        button_label: 'Ver temas',
        sections: [
          {
            title: 'Las más consultadas',
            rows: [
              { reply_id: 'envios', title: 'Envíos', description: 'Tiempos y costos', next_node_key: 'faq_envios' },
              { reply_id: 'devoluciones', title: 'Cambios y devoluciones', description: 'Política y plazos', next_node_key: 'faq_devoluciones' },
              { reply_id: 'pagos', title: 'Medios de pago', description: 'Qué aceptamos', next_node_key: 'faq_pagos' },
              { reply_id: 'tallas', title: 'Tallas y medidas', description: 'Guía de talles', next_node_key: 'faq_tallas' },
              { reply_id: 'tienda', title: 'Tienda física', description: 'Dirección y horarios', next_node_key: 'faq_tienda' },
            ],
          },
        ],
      } as SendListNodeConfig,
    },
    {
      node_key: 'faq_envios',
      node_type: 'send_message',
      config: {
        text:
          'Enviamos a todo el país en 2 a 5 días hábiles. El costo se calcula al pagar según tu ciudad. 🚚\n\nSi tu compra supera $150.000 el envío es gratis.',
        next_node_key: 'fin_ok',
      } as SendMessageNodeConfig,
    },
    {
      node_key: 'faq_devoluciones',
      node_type: 'send_message',
      config: {
        text:
          'Aceptamos cambios y devoluciones dentro de los 15 días de recibir el pedido. El producto debe estar sin uso y con su empaque original. 🔁',
        next_node_key: 'fin_ok',
      } as SendMessageNodeConfig,
    },
    {
      node_key: 'faq_pagos',
      node_type: 'send_message',
      config: {
        text:
          'Aceptamos tarjeta de crédito, débito, PSE, Nequi y transferencia bancaria. 💳',
        next_node_key: 'fin_ok',
      } as SendMessageNodeConfig,
    },
    {
      node_key: 'faq_tallas',
      node_type: 'send_message',
      config: {
        text:
          'Cada producto tiene su propia guía de tallas en la ficha. Si tenés dudas con una prenda específica, escribime el nombre y te ayudo. 📏',
        next_node_key: 'handoff_directo',
      } as SendMessageNodeConfig,
    },
    {
      node_key: 'faq_tienda',
      node_type: 'send_message',
      config: {
        text:
          '📍 Calle Falsa 123, Bogotá.\nLunes a sábado de 10:00 a 19:00.\nDomingos cerrado.',
        next_node_key: 'fin_ok',
      } as SendMessageNodeConfig,
    },

    // ────────── handoff y fin ──────────
    {
      node_key: 'handoff_directo',
      node_type: 'handoff',
      config: {
        note: 'El cliente pidió hablar con un humano desde el menú.',
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
  atencion_cliente: ATENCION_CLIENTE,
};

export function getFlowTemplate(slug: string): FlowTemplate | null {
  return TEMPLATES[slug] ?? null;
}

export function listFlowTemplates(): FlowTemplate[] {
  return Object.values(TEMPLATES);
}
