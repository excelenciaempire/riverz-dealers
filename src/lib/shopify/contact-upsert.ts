import { sanitizePhoneForMeta, isValidE164 } from '@/lib/whatsapp/phone-utils'
import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Pull the best WhatsApp-reachable phone number out of a Shopify payload.
 * Tries the order/checkout's own phone first, then customer, then ship/bill
 * addresses. Returns a sanitized E.164 string or null when no usable phone
 * exists — without one there's nothing WhatsApp can do.
 */
export function extractShopifyPhone(payload: Record<string, unknown>): string | null {
  const customer = payload.customer as Record<string, unknown> | undefined
  const ship = payload.shipping_address as Record<string, unknown> | undefined
  const bill = payload.billing_address as Record<string, unknown> | undefined
  const raw =
    (payload.phone as string) ||
    (customer?.phone as string) ||
    (ship?.phone as string) ||
    (bill?.phone as string) ||
    ''
  if (!raw) return null
  const phone = sanitizePhoneForMeta(raw)
  return isValidE164(phone) ? phone : null
}

/**
 * Pull the customer's display name out of a Shopify payload. Falls back to
 * the order/checkout name (e.g. "#1042") so messages aren't impersonal when
 * the buyer checks out as guest.
 */
export function extractShopifyName(payload: Record<string, unknown>): string | undefined {
  const customer = payload.customer as Record<string, unknown> | undefined
  const composed = [customer?.first_name, customer?.last_name].filter(Boolean).join(' ')
  return composed || (payload.name as string) || undefined
}

/** Find-or-create a WhatsApp contact in the unified inbox keyed by phone.
 *  Marks `is_shopify_customer=true` siempre que se llame desde un
 *  webhook Shopify — la lista de Contactos lo usa para mostrar el
 *  badge "Cliente Shopify". Si el contacto ya existía sin la marca,
 *  la levantamos con un update separado. */
export async function upsertWhatsappContact(
  admin: SupabaseClient,
  args: { workspaceId: string; phone: string; name?: string; email?: string },
): Promise<string | null> {
  const { data: existing } = await admin
    .from('contacts')
    .select('id, is_shopify_customer')
    .eq('workspace_id', args.workspaceId)
    .eq('channel', 'whatsapp')
    .eq('external_id', args.phone)
    .maybeSingle()
  if (existing?.id) {
    if (!(existing as { is_shopify_customer?: boolean }).is_shopify_customer) {
      // No esperamos al resultado — fire-and-forget para no demorar
      // el webhook. Si falla, el siguiente webhook lo intentará.
      void admin
        .from('contacts')
        .update({ is_shopify_customer: true })
        .eq('id', existing.id);
    }
    return existing.id as string
  }

  const { data: created, error } = await admin
    .from('contacts')
    .insert({
      workspace_id: args.workspaceId,
      channel: 'whatsapp',
      external_id: args.phone,
      phone: args.phone,
      name: args.name ?? null,
      email: args.email ?? null,
      is_shopify_customer: true,
    })
    .select('id')
    .single()
  if (error) {
    console.error('[shopify] contact upsert failed:', error)
    return null
  }
  return created.id as string
}
