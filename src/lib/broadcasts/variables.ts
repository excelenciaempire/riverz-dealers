/**
 * De qué campo del contacto sale cada {{n}} de la plantilla.
 *
 * Vivía dentro del cron de campañas (`app/api/broadcasts/cron/route.ts`), que
 * hasta ahora era el único que necesitaba resolverlo. Desde que se puede armar
 * una campaña desde el chat, quien la arma también tiene que saber con qué
 * texto va a salir: si acá hubiera dos resoluciones del mismo {{1}}, la
 * previsualización mostraría una cosa y la persona recibiría otra.
 *
 * El cuerpo se movió tal cual — mismos campos, mismo formato de moneda, mismo
 * '' cuando falta el dato. Lo único nuevo es que la lista de campos y la
 * resolución de UNO quedaron exportadas por separado, para que quien ya tiene
 * el contacto en memoria no tenga que volver a la base.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Los campos que puede llenar una variable, en el orden en que se ofrecen.
 *
 * Cualquier otro nombre se interpreta como el id de un campo personalizado
 * (`custom_fields.id`) y se busca en la base al enviar.
 */
export const BROADCAST_VARIABLE_FIELDS = [
  'name',
  'first_name',
  'last_name',
  'phone',
  'email',
  'company',
  // Campos dinámicos de Shopify — salen de contacts.shopify_customer_data.
  'shopify_orders_count',
  'shopify_total_spent',
  'shopify_last_order',
  'shopify_city',
] as const

export type BroadcastVariableField = (typeof BROADCAST_VARIABLE_FIELDS)[number]

export const BUILTIN_FIELDS: ReadonlySet<string> = new Set(BROADCAST_VARIABLE_FIELDS)

function readString(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

/** Resolve a Shopify dynamic field from the contact's cached
 *  shopify_customer_data snapshot (written by the enrich cron). Returns ''
 *  when the contact has no Shopify data yet, matching the built-in fields. */
export function resolveShopifyField(
  field: string,
  contact: Record<string, unknown>,
): string {
  const scd = (contact.shopify_customer_data ?? null) as {
    total_spent?: number
    currency?: string
    orders_count?: number
    default_address?: { city?: string | null } | null
    lifetime_orders?: Array<{ name?: string }> | null
  } | null
  if (!scd) return ''
  switch (field) {
    case 'shopify_orders_count':
      return scd.orders_count != null ? String(scd.orders_count) : ''
    case 'shopify_total_spent': {
      if (scd.total_spent == null) return ''
      const cur = scd.currency
      try {
        return cur
          ? new Intl.NumberFormat('es', { style: 'currency', currency: cur, maximumFractionDigits: 0 }).format(Number(scd.total_spent))
          : String(scd.total_spent)
      } catch {
        return String(scd.total_spent)
      }
    }
    case 'shopify_last_order':
      return readString(scd.lifetime_orders?.[0]?.name)
    case 'shopify_city':
      return readString(scd.default_address?.city ?? '')
    default:
      return ''
  }
}

/**
 * El valor de UN campo para UN contacto, sin tocar la base.
 *
 * Devuelve `null` —y no ''— cuando el nombre no es un campo de contacto: ahí
 * quien llama tiene que buscarlo entre los campos personalizados. Confundir
 * "no tiene ciudad" con "no es un campo" haría que un id mal escrito saliera
 * como texto vacío en vez de avisar.
 */
export function resolveContactField(
  field: string,
  contact: Record<string, unknown>,
): string | null {
  if (field === 'name') return readString(contact.name)
  if (field === 'first_name') {
    const full = readString(contact.name)
    return full.split(/\s+/)[0] ?? ''
  }
  if (field === 'last_name') {
    const full = readString(contact.name)
    const parts = full.split(/\s+/)
    return parts.length > 1 ? parts.slice(1).join(' ') : ''
  }
  if (field === 'phone') return readString(contact.phone)
  if (field === 'email') return readString(contact.email)
  if (field === 'company') return readString(contact.company)
  if (field.startsWith('shopify_')) return resolveShopifyField(field, contact)
  return null
}

/**
 * Si la campaña define `variable_mapping`, releemos los valores del
 * contacto (built-in o custom field) en el momento del envío para que
 * los datos sean los más recientes. Si no hay mapping, usamos los
 * params resueltos en tiempo de programación.
 */
export async function resolveBroadcastParams(
  db: SupabaseClient,
  contact: Record<string, unknown> | null,
  fallback: string[] | null,
  mapping: Record<string, string> | null,
): Promise<string[]> {
  if (!mapping || Object.keys(mapping).length === 0) return fallback ?? []
  if (!contact) return fallback ?? []

  const keys = Object.keys(mapping).sort((a, b) => Number(a) - Number(b))
  const customFieldIds = keys
    .map((k) => mapping[k])
    .filter((field) => field && !BUILTIN_FIELDS.has(field))

  const customValues = new Map<string, string>()
  if (customFieldIds.length > 0 && contact.id) {
    const { data: rows } = await db
      .from('contact_custom_values')
      .select('custom_field_id, value')
      .eq('contact_id', contact.id as string)
      .in('custom_field_id', customFieldIds)
    for (const row of (rows ?? []) as Array<{ custom_field_id: string; value: string | null }>) {
      customValues.set(row.custom_field_id, row.value ?? '')
    }
  }

  return keys.map((key) => {
    const field = mapping[key]
    if (!field) return ''
    return resolveContactField(field, contact) ?? customValues.get(field) ?? ''
  })
}

/**
 * Los {{n}} que trae un cuerpo de plantilla, ordenados y sin repetir.
 *
 * Meta llena los parámetros POR POSICIÓN, no por número: una campaña que
 * declara sólo {{2}} manda ese valor en el lugar de {{1}}. Por eso quien arma
 * la campaña necesita la lista completa y contigua, no "cuántas hay".
 */
export function templateVariableNumbers(body: string | null | undefined): number[] {
  const found = String(body ?? '').match(/\{\{\s*(\d+)\s*\}\}/g) ?? []
  const nums = found.map((m) => Number(m.replace(/\D/g, '')))
  return [...new Set(nums)].sort((a, b) => a - b)
}
