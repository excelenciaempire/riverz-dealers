import {
  normalizeToWhatsApp,
  sanitizePhoneForMeta,
  isValidE164,
  phonesMatch,
} from '@/lib/whatsapp/phone-utils'
import { resolveWorkspaceOwnerUserId } from '@/lib/workspaces/owner'
import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * The ISO country the customer bought from, used to add the right country
 * code to a bare local phone. Tries shipping → billing → customer default
 * address. Returns '' when Shopify didn't send one (then normalization falls
 * back to parsing any already-international form).
 */
export function extractShopifyCountry(payload: Record<string, unknown>): string {
  const customer = payload.customer as Record<string, unknown> | undefined
  const ship = payload.shipping_address as Record<string, unknown> | undefined
  const bill = payload.billing_address as Record<string, unknown> | undefined
  const custAddr = customer?.default_address as Record<string, unknown> | undefined
  return String(
    ship?.country_code ||
      bill?.country_code ||
      custAddr?.country_code ||
      customer?.country_code ||
      '',
  )
}

/**
 * Pull the best WhatsApp-reachable phone number out of a Shopify payload.
 * Tries the order/checkout's own phone first, then customer, then ship/bill
 * addresses, and normalizes it to E.164 USING THE PURCHASE COUNTRY so bare
 * local numbers (e.g. an AR "3516501221") get the right country code instead
 * of being stored unreachable. Returns null when no usable phone exists.
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
  const phone = normalizeToWhatsApp(raw, extractShopifyCountry(payload))
  return isValidE164(phone) ? phone : null
}

/**
 * Pull the customer's display name out of a Shopify payload: first + last name.
 * When the buyer checked out as a guest with no name, returns undefined so the
 * contact keeps a null name and the UI shows the phone — better than falling
 * back to the order/checkout id, which on abandoned checkouts is a giant numeric
 * ref ("#38443325718628") that's meaningless to the merchant.
 */
export function extractShopifyName(payload: Record<string, unknown>): string | undefined {
  const customer = payload.customer as Record<string, unknown> | undefined
  const composed = [customer?.first_name, customer?.last_name].filter(Boolean).join(' ')
  return composed || undefined
}

/**
 * The legacy digits-only form (what `sanitizePhoneForMeta` produced BEFORE
 * country-aware normalization). Used only to find + migrate a contact that
 * was created under the broken local key (e.g. AR "1156309090" with no +54),
 * so the backfill/webhooks fix it in place instead of duplicating it.
 */
export function extractShopifyLegacyPhone(payload: Record<string, unknown>): string {
  const customer = payload.customer as Record<string, unknown> | undefined
  const ship = payload.shipping_address as Record<string, unknown> | undefined
  const bill = payload.billing_address as Record<string, unknown> | undefined
  const raw =
    (payload.phone as string) ||
    (customer?.phone as string) ||
    (ship?.phone as string) ||
    (bill?.phone as string) ||
    ''
  return sanitizePhoneForMeta(raw)
}

/** Find-or-create a WhatsApp contact in the unified inbox keyed by phone.
 *  Marks `is_shopify_customer=true` siempre que se llame desde un
 *  webhook Shopify — la lista de Contactos lo usa para mostrar el
 *  badge "Cliente Shopify". Si el contacto ya existía sin la marca,
 *  la levantamos con un update separado.
 *
 *  `legacyExternalId` (optional): the pre-normalization key for the same
 *  buyer. When the canonical slot is empty but a contact exists under the
 *  legacy key, we MOVE that row to the canonical phone in place — preserving
 *  its conversations + tags — instead of creating a duplicate. */
export async function upsertWhatsappContact(
  admin: SupabaseClient,
  args: {
    workspaceId: string
    phone: string
    name?: string
    email?: string
    legacyExternalId?: string
    /** Non-Shopify integrations reuse phone identity without inventing a Shopify purchase. */
    isShopifyCustomer?: boolean
  },
): Promise<string | null> {
  // Sanitize to the canonical E.164-digits form BEFORE lookup/insert. Callers
  // pass phones in mixed shapes — the orders webhook pre-sanitizes, but the
  // cart-recovery cron forwards the raw stored checkout phone (e.g.
  // "+19802052076"). Keying on the raw value would create a second contact
  // ("+19802052076") distinct from the canonical one ("19802052076") and the
  // send would target a brand-new conversation-less contact.
  const phone = sanitizePhoneForMeta(args.phone)
  if (!isValidE164(phone)) return null

  let { data: existing } = await admin
    .from('contacts')
    .select('id, is_shopify_customer')
    .eq('workspace_id', args.workspaceId)
    .eq('channel', 'whatsapp')
    .eq('external_id', phone)
    .maybeSingle()

  // Migrate a contact stored under the legacy (pre-country-code) key to the
  // canonical phone, but only when the canonical slot is free (no merge).
  const legacy = args.legacyExternalId
    ? sanitizePhoneForMeta(args.legacyExternalId)
    : ''
  if (!existing?.id && legacy && legacy !== phone) {
    const { data: legacyRow } = await admin
      .from('contacts')
      .select('id, is_shopify_customer')
      .eq('workspace_id', args.workspaceId)
      .eq('channel', 'whatsapp')
      .eq('external_id', legacy)
      .maybeSingle()
    if (legacyRow?.id) {
      await admin
        .from('contacts')
        .update({ external_id: phone, phone })
        .eq('id', legacyRow.id)
      existing = legacyRow
    }
  }

  // Variant match: the same person may already exist under their WhatsApp
  // identity — an AR mobile is "54911…" as wa_id/external_id (webhook-created
  // contact) but "5411…" once normalized from the Shopify payload, so both
  // exact lookups above miss and the order would mint a duplicate contact,
  // splitting the customer's thread in two. Match by wa_id or phone suffix
  // before inserting.
  if (!existing?.id) {
    const last8 = phone.slice(-8)
    if (last8.length === 8) {
      const { data: candidates } = await admin
        .from('contacts')
        .select('id, is_shopify_customer, phone, wa_id, name, email')
        .eq('workspace_id', args.workspaceId)
        .eq('channel', 'whatsapp')
        .or(`wa_id.eq.${phone},phone.like.%${last8}`)
        .order('created_at', { ascending: true })
      type Cand = {
        id: string
        is_shopify_customer?: boolean
        phone?: string | null
        wa_id?: string | null
        name?: string | null
        email?: string | null
      }
      const rows = (candidates ?? []) as Cand[]
      const match =
        rows.find((c) => c.wa_id === phone) ??
        rows.find((c) => c.phone && phonesMatch(c.phone, phone))
      if (match) {
        // Backfill what Shopify knows and the webhook didn't: full name/email.
        const patch: Record<string, unknown> = {}
        if (!match.name && args.name) patch.name = args.name
        if (!match.email && args.email) patch.email = args.email
        if (Object.keys(patch).length > 0) {
          void admin.from('contacts').update(patch).eq('id', match.id)
        }
        existing = { id: match.id, is_shopify_customer: match.is_shopify_customer }
      }
    }
  }

  if (existing?.id) {
    if (args.isShopifyCustomer !== false && !(existing as { is_shopify_customer?: boolean }).is_shopify_customer) {
      // No esperamos al resultado — fire-and-forget para no demorar
      // el webhook. Si falla, el siguiente webhook lo intentará.
      void admin
        .from('contacts')
        .update({ is_shopify_customer: true })
        .eq('id', existing.id);
    }
    return existing.id as string
  }

  // Stamp the legacy single-tenant user_id (= workspace owner). The
  // automation sender (engineSendTemplate / engineSendText) looks up the
  // contact with `.eq('user_id', ownerUserId)`, so a contact created
  // WITHOUT user_id can never be messaged by any Shopify automation —
  // the send throws "contact not found for this user". The WhatsApp
  // inbound webhook already sets user_id; we mirror it here so
  // Shopify-created contacts behave identically.
  const ownerUserId = await resolveWorkspaceOwnerUserId(admin, args.workspaceId)

  const { data: created, error } = await admin
    .from('contacts')
    .insert({
      workspace_id: args.workspaceId,
      user_id: ownerUserId,
      channel: 'whatsapp',
      external_id: phone,
      phone: phone,
      name: args.name ?? null,
      email: args.email ?? null,
      is_shopify_customer: args.isShopifyCustomer !== false,
    })
    .select('id')
    .single()
  if (error) {
    console.error('[shopify] contact upsert failed:', error)
    return null
  }
  return created.id as string
}
