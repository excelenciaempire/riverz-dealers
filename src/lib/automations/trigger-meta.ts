import type { AutomationTriggerType } from '@/types'

export interface TriggerMeta {
  label: string
  /** Tailwind classes for the Badge pill on the list row. */
  pillClass: string
}

export const TRIGGER_META: Record<AutomationTriggerType, TriggerMeta> = {
  new_message_received: {
    label: 'Nuevo mensaje',
    pillClass: 'border-blue-500/30 bg-blue-500/10 text-blue-300',
  },
  first_inbound_message: {
    label: 'Primer mensaje del contacto',
    pillClass: 'border-teal-500/30 bg-teal-500/10 text-teal-300',
  },
  keyword_match: {
    label: 'Coincidencia de palabra clave',
    pillClass: 'border-purple-500/30 bg-purple-500/10 text-purple-300',
  },
  new_contact_created: {
    label: 'Nuevo contacto',
    pillClass: 'border-primary/30 bg-primary/10 text-primary',
  },
  conversation_assigned: {
    label: 'Conversación asignada',
    pillClass: 'border-cyan-500/30 bg-cyan-500/10 text-cyan-300',
  },
  tag_added: {
    label: 'Etiqueta añadida',
    pillClass: 'border-amber-500/30 bg-amber-500/10 text-amber-300',
  },
  time_based: {
    label: 'Programada',
    pillClass: 'border-slate-500/30 bg-slate-500/10 text-slate-300',
  },
  shopify_abandoned_checkout: {
    label: 'Carrito abandonado (Shopify)',
    pillClass: 'border-green-500/30 bg-green-500/10 text-green-300',
  },
  shopify_order_created: {
    label: 'Nuevo pedido (Shopify)',
    pillClass: 'border-green-500/30 bg-green-500/10 text-green-300',
  },
  shopify_order_paid: {
    label: 'Pedido pagado (Shopify)',
    pillClass: 'border-green-500/30 bg-green-500/10 text-green-300',
  },
  shopify_order_fulfilled: {
    label: 'Pedido despachado (Shopify)',
    pillClass: 'border-green-500/30 bg-green-500/10 text-green-300',
  },
  shopify_order_delivered: {
    label: 'Pedido entregado (Shopify)',
    pillClass: 'border-green-500/30 bg-green-500/10 text-green-300',
  },
  shopify_order_cancelled: {
    label: 'Pedido cancelado (Shopify)',
    pillClass: 'border-rose-500/30 bg-rose-500/10 text-rose-300',
  },
  shopify_order_refunded: {
    label: 'Pedido reembolsado (Shopify)',
    pillClass: 'border-rose-500/30 bg-rose-500/10 text-rose-300',
  },
  post_delivery_feedback: {
    label: 'Feedback post-entrega',
    pillClass: 'border-amber-500/30 bg-amber-500/10 text-amber-300',
  },
  customer_inactive: {
    label: 'Cliente inactivo',
    pillClass: 'border-rose-500/30 bg-rose-500/10 text-rose-300',
  },
  voice_call_completed: {
    label: 'Llamada finalizada (Voz IA)',
    pillClass: 'border-violet-500/30 bg-violet-500/10 text-violet-300',
  },
}

export function triggerMeta(t: AutomationTriggerType | string): TriggerMeta {
  return (
    TRIGGER_META[t as AutomationTriggerType] ?? {
      label: t,
      pillClass: 'border-slate-500/30 bg-slate-500/10 text-slate-300',
    }
  )
}

export function formatRelative(iso: string | null | undefined): string {
  if (!iso) return 'nunca'
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return 'nunca'
  const diffSec = Math.round((Date.now() - then) / 1000)
  if (diffSec < 60) return 'hace un momento'
  if (diffSec < 3600) return `hace ${Math.floor(diffSec / 60)} min`
  if (diffSec < 86400) return `hace ${Math.floor(diffSec / 3600)} h`
  if (diffSec < 2_592_000) return `hace ${Math.floor(diffSec / 86400)} d`
  return new Date(iso).toLocaleDateString('es-ES')
}
