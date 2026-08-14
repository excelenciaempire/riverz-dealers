import type {
  AutomationStepConfig,
  AutomationStepType,
  AutomationTriggerConfig,
  AutomationTriggerType,
} from '@/types'
import type { Locale } from '@/lib/i18n/config'

export type TemplateSlug =
  | 'carrito-abandonado'
  | 'pago-rechazado'
  | 'nuevo-pedido'
  | 'enviar-tracking'
  | 'post-survey'
  | 'recompras'

export type TemplateCategory =
  | 'shopify'
  | 'ventas'
  | 'soporte'
  | 'retencion'
  | 'recordatorios'

/**
 * Lucide icon name (string). The page maps these to the actual
 * imported icon components — keeping the catalog import-free means
 * server-side code can read this file without dragging react into the
 * bundle.
 */
export type TemplateIconName =
  | 'shopping-cart'
  | 'credit-card'
  | 'package-check'
  | 'truck'
  | 'star'
  | 'repeat-2'

export interface TemplateStepSeed {
  step_type: AutomationStepType
  step_config: AutomationStepConfig
  branch?: 'yes' | 'no' | null
  /** Index (within this seed list) of the Condition parent, if nested. */
  parent_index?: number | null
}

export interface AutomationTemplateDefinition {
  slug: TemplateSlug
  name: string
  description: string
  /** Bucket the card belongs to. Used to colour-code or group. */
  category: TemplateCategory
  icon: TemplateIconName
  /** Short pills shown at the bottom of the gallery card. */
  tags: string[]
  trigger_type: AutomationTriggerType
  trigger_config: AutomationTriggerConfig
  steps: TemplateStepSeed[]
  /**
   * Suggested copy for the Meta-approved template the user must
   * register before activation. Kept here so the editor can show it as
   * pre-filled guidance. NOT stored anywhere — purely descriptive.
   */
  suggested_template_body?: string
}

/**
 * Galería curada de plantillas de automatizaciones. La sentamos en
 * sólo cinco recetas por pedido del equipo: cada una resuelve un
 * problema concreto del ciclo Shopify + WhatsApp.
 *
 * Reglas de seeding:
 *
 *  - `send_template` con `template_name: ''` para forzar al usuario a
 *    elegir una plantilla Meta aprobada (validate.ts no deja activar
 *    con string vacío). El motor solo soporta `send_template` fuera
 *    de la ventana de 24h, y todas estas plantillas pueden disparar
 *    fuera de la ventana (después de wait o tiempo absoluto).
 *  - Cada receta TERMINA con un paso `add_tag` con `tag_id: ''` (sin etiqueta
 *    por defecto): al usar la plantilla, el merchant escribe una etiqueta nueva
 *    o elige una existente (combobox write-or-pick en el editor). validate.ts
 *    exige un tag real antes de activar, así todo contacto que pasa por la
 *    automatización queda etiquetado — pedido del equipo.
 *
 * El editor surfacea el `suggested_template_body` como pista para que
 * el merchant registre el template en Meta con el cuerpo correcto.
 */
export const AUTOMATION_TEMPLATES: Record<TemplateSlug, AutomationTemplateDefinition> = {
  'carrito-abandonado': {
    slug: 'carrito-abandonado',
    name: 'Carrito abandonado',
    description:
      'Recupera ventas: cuando un cliente abandona su carrito, le enviamos el link para retomarlo 2 horas después.',
    category: 'shopify',
    icon: 'shopping-cart',
    tags: ['Shopify', 'Recovery'],
    trigger_type: 'shopify_abandoned_checkout',
    trigger_config: {},
    suggested_template_body:
      'Hola {{customer_name}}, dejaste tu carrito sin terminar. Te lo guardamos por si quieres retomarlo: {{checkout_url}}.',
    steps: [
      {
        // No `wait` step here: the cart-recovery cron only fires this
        // trigger once the checkout is `created_at < now() - 2h`, so the
        // 2-hour delay is already applied upstream. A wait step here would
        // stack on top and push the recovery message to ~4h, contradicting
        // the "2 horas después" the card promises.
        //
        // The cron always fires outside Meta's 24h customer-service
        // window, so only an approved template can be sent — free-text
        // `send_message` would fail at runtime.
        step_type: 'send_template',
        step_config: { template_name: '', language: 'es', variables: {} },
      },
      {
        // Etiquetar al final — sin etiqueta por defecto: el merchant escribe una
        // nueva o elige una existente al usar la plantilla (validate exige un tag
        // real antes de activar).
        step_type: 'add_tag',
        step_config: { tag_id: '' },
      },
    ],
  },

  'pago-rechazado': {
    slug: 'pago-rechazado',
    name: 'Pago rechazado',
    description:
      'Al cliente se le rechazó el pago y a las 3 horas todavía no completó la compra. Le escribimos para retomarla.',
    category: 'shopify',
    icon: 'credit-card',
    tags: ['Mercado Pago', 'Recovery'],
    trigger_type: 'payment_rejected',
    // `hours_after` es la espera y el filtro a la vez: al cumplirse, el cron
    // recién ahí comprueba si la persona compró. Quien pagó en el segundo
    // intento queda fuera solo, sin que el comerciante configure nada.
    trigger_config: { hours_after: 3, max_age_days: 14 },
    suggested_template_body:
      'Hola {{customer_name}}, no pudimos procesar el pago de tu pedido por {{total_price}}. Responde este mensaje y te ayudamos a completar la compra.',
    steps: [
      {
        // Sin paso `wait`: la espera ya la aplica el cron con `hours_after`,
        // y sumar una acá la duplicaría igual que en carrito abandonado.
        //
        // Va plantilla y no mensaje suelto porque el envío cae siempre
        // fuera de la ventana de 24h de Meta. Categoría Utility: el aviso
        // es transaccional (hay un pago que no prosperó), y las Marketing
        // de este tipo se entregan mucho peor.
        step_type: 'send_template',
        step_config: { template_name: '', language: 'es', variables: {} },
      },
      {
        step_type: 'add_tag',
        step_config: { tag_id: '' },
      },
    ],
  },

  'nuevo-pedido': {
    slug: 'nuevo-pedido',
    name: 'Nuevo pedido',
    description:
      'Confirmamos al cliente apenas hace un pedido en Shopify. Le mandamos un resumen con el número de orden, el total y un agradecimiento.',
    category: 'shopify',
    icon: 'package-check',
    tags: ['Shopify', 'Confirmación'],
    trigger_type: 'shopify_order_created',
    trigger_config: {},
    suggested_template_body:
      'Gracias por tu compra, {{customer_name}}. Confirmamos el pedido {{order_name}} por {{total_price}} {{currency}}. Te avisamos apenas salga.',
    steps: [
      {
        step_type: 'send_template',
        step_config: { template_name: '', language: 'es', variables: {} },
      },
      {
        // Etiquetar al final — sin etiqueta por defecto: el merchant escribe una
        // nueva o elige una existente al usar la plantilla (validate exige un tag
        // real antes de activar).
        step_type: 'add_tag',
        step_config: { tag_id: '' },
      },
    ],
  },

  'enviar-tracking': {
    slug: 'enviar-tracking',
    name: 'Enviar tracking',
    description:
      'Cuando despachamos un pedido, le mandamos al cliente el número de seguimiento y el link del courier.',
    category: 'shopify',
    icon: 'truck',
    tags: ['Shopify', 'Envíos'],
    trigger_type: 'shopify_order_fulfilled',
    trigger_config: {},
    suggested_template_body:
      'Tu pedido salió. Número de seguimiento: {{tracking_number}}. Lo sigues aquí: {{tracking_url}}.',
    steps: [
      {
        step_type: 'send_template',
        step_config: { template_name: '', language: 'es', variables: {} },
      },
      {
        // Etiquetar al final — sin etiqueta por defecto: el merchant escribe una
        // nueva o elige una existente al usar la plantilla (validate exige un tag
        // real antes de activar).
        step_type: 'add_tag',
        step_config: { tag_id: '' },
      },
    ],
  },

  'post-survey': {
    slug: 'post-survey',
    name: 'Post survey',
    description:
      'Tres días después de que llega el pedido, le preguntamos al cliente cómo le fue. La respuesta queda registrada en la conversación para revisar.',
    category: 'retencion',
    icon: 'star',
    tags: ['Encuestas', 'Retención'],
    // Dedicated cron in /api/cron/shopify-feedback discovers
    // automations by this trigger_type + reads `days_after` from
    // trigger_config to know when to fire.
    trigger_type: 'post_delivery_feedback',
    trigger_config: { days_after: 3 },
    suggested_template_body:
      '{{customer_name}}, ¿cómo te fue con tu pedido? Cualquier feedback nos sirve un montón.',
    steps: [
      {
        // The cron dispatch always fires outside the 24h window —
        // send_template is the only safe choice.
        step_type: 'send_template',
        step_config: { template_name: '', language: 'es', variables: {} },
      },
      {
        // Etiquetar al final — sin etiqueta por defecto: el merchant escribe una
        // nueva o elige una existente al usar la plantilla (validate exige un tag
        // real antes de activar).
        step_type: 'add_tag',
        step_config: { tag_id: '' },
      },
    ],
  },

  recompras: {
    slug: 'recompras',
    name: 'Recompras',
    description:
      'A los 45 días del último pedido, reactivamos al cliente — pero con un mensaje distinto según cuánto compró: a quien llevó por volumen (3+ unidades) le proponemos reponer con una oferta de volumen; a quien compró individual, volver a pedir su producto. Dispara una vez por ciclo.',
    category: 'retencion',
    icon: 'repeat-2',
    tags: ['Retención', 'Recompras'],
    // Dedicated cron in /api/cron/reengagement reads
    // `days_threshold` from trigger_config to know the inactivity
    // cutoff.
    trigger_type: 'customer_inactive',
    trigger_config: { days_threshold: 45 },
    suggested_template_body:
      'Hola {{customer_name}}, hace un tiempo de tu último pedido. ¿Quieres reponer? Te dejo el link para volver a comprar.',
    // Flujo ramificado: el camino se elige según las UNIDADES de la última
    // compra (last_offer_units, que el webhook de pedidos guarda en el
    // contacto). El merchant puede cambiar la condición por la oferta elegida
    // (last_offer_chosen) o el producto (last_product) desde el editor. Cada
    // rama termina etiquetando para segmentar después.
    steps: [
      {
        // 0 — ¿Compró por volumen (3+ unidades) la última vez?
        step_type: 'condition',
        step_config: {
          subject: 'contact_field',
          operand: 'last_offer_units',
          op: 'gte',
          value: '3',
        },
      },
      {
        // 1 — Sí (comprador de volumen): reponer con oferta de volumen.
        step_type: 'send_template',
        step_config: { template_name: '', language: 'es', variables: {} },
        parent_index: 0,
        branch: 'yes',
      },
      {
        // 2 — etiqueta de la rama de volumen.
        step_type: 'add_tag',
        step_config: { tag_id: '' },
        parent_index: 0,
        branch: 'yes',
      },
      {
        // 3 — No (comprador individual): volver a pedir su producto.
        step_type: 'send_template',
        step_config: { template_name: '', language: 'es', variables: {} },
        parent_index: 0,
        branch: 'no',
      },
      {
        // 4 — etiqueta de la rama individual.
        step_type: 'add_tag',
        step_config: { tag_id: '' },
        parent_index: 0,
        branch: 'no',
      },
    ],
  },
}

/**
 * Order used by the gallery on /automatizaciones. Anything not listed
 * here is appended in object-iteration order.
 */
export const TEMPLATE_GALLERY_ORDER: TemplateSlug[] = [
  'carrito-abandonado',
  'pago-rechazado',
  'nuevo-pedido',
  'enviar-tracking',
  'post-survey',
  'recompras',
]

/**
 * English variants of the suggested Meta-template body. The gallery
 * name/description are localized via i18n keys at the call sites; the seed
 * step content is mostly empty placeholders (template_name / tag_id the
 * merchant fills), so the only language-bearing pieces are this guidance
 * body and the `send_template` language code — both followed to the
 * merchant's locale so an English merchant doesn't seed Spanish defaults.
 */
const SUGGESTED_BODIES_EN: Partial<Record<TemplateSlug, string>> = {
  'carrito-abandonado':
    'Hi {{customer_name}}, you left your cart unfinished. We saved it in case you want to pick it back up: {{checkout_url}}.',
  'nuevo-pedido':
    "Thanks for your purchase, {{customer_name}}. We confirmed order {{order_name}} for {{total_price}} {{currency}}. We'll let you know as soon as it ships.",
  'enviar-tracking':
    'Your order has shipped. Tracking number: {{tracking_number}}. Follow it here: {{tracking_url}}.',
  'post-survey':
    '{{customer_name}}, how did it go with your order? Any feedback really helps us.',
  recompras:
    "Hi {{customer_name}}, it's been a while since your last order. Want to restock? Here's the link to buy again.",
}

function localizeTemplate(
  t: AutomationTemplateDefinition,
  locale: Locale,
): AutomationTemplateDefinition {
  if (locale !== 'en') return t
  return {
    ...t,
    suggested_template_body: SUGGESTED_BODIES_EN[t.slug] ?? t.suggested_template_body,
    steps: t.steps.map((s) =>
      s.step_type === 'send_template'
        ? {
            ...s,
            step_config: {
              ...(s.step_config as Record<string, unknown>),
              language: 'en',
            } as AutomationStepConfig,
          }
        : s,
    ),
  }
}

export function getTemplate(
  slug: string,
  locale: Locale = 'es',
): AutomationTemplateDefinition | null {
  const t = AUTOMATION_TEMPLATES[slug as TemplateSlug]
  return t ? localizeTemplate(t, locale) : null
}

/**
 * i18n keys for a template's gallery name / pitch, resolved by the UI
 * (`useT`) so the gallery follows the active locale. The literal
 * `name`/`description` on the definition are the Spanish source-of-truth
 * fallback. `suggested_template_body` and step copy are NOT keyed here —
 * those are customer-facing message bodies the merchant edits.
 */
export function automationTemplateNameKey(slug: string): string {
  return `automations.tpl_${slug}_name`
}
export function automationTemplateDescKey(slug: string): string {
  return `automations.tpl_${slug}_desc`
}

export function listTemplates(locale: Locale = 'es'): AutomationTemplateDefinition[] {
  const seen = new Set<TemplateSlug>()
  const out: AutomationTemplateDefinition[] = []
  for (const slug of TEMPLATE_GALLERY_ORDER) {
    const t = AUTOMATION_TEMPLATES[slug]
    if (t) {
      out.push(localizeTemplate(t, locale))
      seen.add(slug)
    }
  }
  for (const slug of Object.keys(AUTOMATION_TEMPLATES) as TemplateSlug[]) {
    if (!seen.has(slug)) out.push(localizeTemplate(AUTOMATION_TEMPLATES[slug], locale))
  }
  return out
}
