import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { verifyShopifyWebhook } from '@/lib/shopify/webhook-auth'
import { getConnectionByShop } from '@/lib/shopify/connection'
import { resolveWorkspaceIdForUser } from '@/lib/workspaces/resolve'
import { sanitizePhoneForMeta, isValidE164 } from '@/lib/whatsapp/phone-utils'
import { getLogger } from '@/lib/log/logger'

const log = getLogger('shopify.gdpr.customers-redact')

/**
 * CANONICAL GDPR endpoint — customers/redact.
 *
 * Fires (typically 10 days) after a buyer asks the merchant to erase their
 * data. The only buyer PII we hold is a phone-derived WhatsApp contact in
 * the `contacts` table (phone, name, email). This handler performs the
 * REAL erasure: it finds the matching contact for the shop's workspace and
 * anonymizes the identifying columns in place.
 *
 * We anonymize rather than hard-delete because the contact may anchor
 * inbox conversations / automation logs whose foreign keys we don't want
 * to orphan; nulling name/email/phone/external_id removes the personal
 * data while preserving referential integrity. The phone-derived
 * `external_id` is replaced with a non-reversible redaction marker so the
 * row can never be re-matched to the person.
 *
 * Payload shape (Shopify):
 *   { shop_domain, customer: { id, email, phone }, ... }
 *
 * Fail-CLOSED: missing SHOPIFY_API_SECRET → 503, never accept unverified.
 */
export async function POST(request: Request) {
  const rawBody = await request.text()
  const verdict = await verifyShopifyWebhook(supabaseAdmin(), request, rawBody)
  if (verdict === 'unconfigured') {
    return new NextResponse('Webhook not configured', { status: 503 })
  }
  if (verdict === 'invalid') {
    return new NextResponse('Invalid HMAC', { status: 401 })
  }

  const shopDomain = request.headers.get('x-shopify-shop-domain')
  try {
    const payload = JSON.parse(rawBody) as {
      shop_domain?: string
      customer?: { id?: number | string; email?: string; phone?: string }
    }
    const customer = payload.customer ?? {}
    const rawPhone = customer.phone ? String(customer.phone) : ''
    const phone = rawPhone ? sanitizePhoneForMeta(rawPhone) : ''
    const email = customer.email ? String(customer.email) : ''

    // No phone and no email → nothing we can key on; the contact (if any)
    // was created from a phone, so without a phone we can't match it.
    if ((!phone || !isValidE164(phone)) && !email) {
      log.info('redact ack: no matchable identifier', { shop: shopDomain ?? null })
      return NextResponse.json({ ok: true, redacted: 0 })
    }

    const admin = supabaseAdmin()

    // Scope the wipe to the shop's workspace so we never touch another
    // tenant's contact that happens to share a phone number.
    const resolvedShop = shopDomain || payload.shop_domain || ''
    let workspaceId: string | null = null
    if (resolvedShop) {
      const conn = await getConnectionByShop(admin, resolvedShop)
      if (conn) {
        workspaceId =
          conn.row.workspace_id ||
          (await resolveWorkspaceIdForUser(admin, conn.row.user_id))
      } else {
        // Carrera con shop/redact: si la conexión ya fue desactivada (o
        // borrada por shop/redact, que corre cerca), getConnectionByShop
        // (solo 'active') devuelve null y la PII del comprador quedaría sin
        // anonimizar. Fallback: resolver el workspace por shop_domain SIN
        // filtrar por status. Sigue scoped a esa tienda → sin fuga cross-tenant.
        const { data: anyConn } = await admin
          .from('shopify_connections')
          .select('workspace_id, user_id')
          .eq('shop_domain', resolvedShop)
          .order('installed_at', { ascending: false })
          .limit(1)
          .maybeSingle()
        if (anyConn) {
          workspaceId =
            (anyConn as { workspace_id: string | null }).workspace_id ||
            (await resolveWorkspaceIdForUser(
              admin,
              (anyConn as { user_id: string }).user_id,
            ))
        }
      }
    }

    const redaction = {
      name: null as string | null,
      email: null as string | null,
      phone: null as string | null,
      external_id: `redacted:${
        customer.id ? String(customer.id) : crypto.randomUUID()
      }`,
      is_shopify_customer: false,
    }

    let matched = 0
    if (workspaceId) {
      // Anonymize by phone (the key we created the contact with). We OR in
      // email as a secondary match for contacts whose phone later changed.
      if (phone && isValidE164(phone)) {
        const { data, error } = await admin
          .from('contacts')
          .update(redaction)
          .eq('workspace_id', workspaceId)
          .eq('channel', 'whatsapp')
          .eq('external_id', phone)
          .select('id')
        if (error) throw error
        matched += data?.length ?? 0
      }
      if (matched === 0 && email) {
        const { data, error } = await admin
          .from('contacts')
          .update(redaction)
          .eq('workspace_id', workspaceId)
          .eq('channel', 'whatsapp')
          .eq('email', email)
          .select('id')
        if (error) throw error
        matched += data?.length ?? 0
      }
    }

    log.info('redact done', { shop: resolvedShop || null, redacted: matched })
    return NextResponse.json({ ok: true, redacted: matched })
  } catch (err) {
    // Signature already verified — log and still ack 200 so Shopify does
    // not enter its retry storm; the erasure is idempotent on replay.
    log.error('redact failed', {
      shop: shopDomain ?? null,
      error: err instanceof Error ? err.message : String(err),
    })
    return NextResponse.json({ ok: true })
  }
}
