import { NextResponse } from 'next/server'
import { assertCronAuth } from '@/lib/auth/cron'
import { serverError } from '@/lib/api/errors'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { runAutomationsForTrigger } from '@/lib/automations/engine'
import { maybeAutoVoiceCall } from '@/lib/voice/auto-enqueue'
import { upsertWhatsappContact } from '@/lib/shopify/contact-upsert'
import { applyCategoryTags } from '@/lib/contacts/tags'
import { withCronRun } from "@/lib/cron/heartbeat";
import { getLogger } from '@/lib/log/logger'

const log = getLogger('cron.shopify-cart-recovery')

/**
 * Cron de carritos abandonados (Pilar).
 *
 * Corre cada hora. Busca filas en `shopify_checkouts` que cumplen:
 *
 *   - `completed_at IS NULL`               (carrito sigue abierto)
 *   - `recovery_dispatched_at IS NULL`     (no le mandamos recovery todavía)
 *   - `created_at < now() - interval '2h'` (pasaron al menos 2 horas)
 *   - `customer_phone IS NOT NULL`         (necesitamos un WhatsApp)
 *
 * Para cada uno:
 *
 *   1. Upsertea el contacto vía `upsertWhatsappContact` (mismo helper
 *      que usa el webhook de checkouts) para asegurar que existe.
 *   2. Dispara el trigger `shopify_abandoned_checkout` con las vars
 *      del checkout (customer_name, checkout_url, total_price...). Eso
 *      ejecuta el automation "Carrito abandonado Pilar (2h)" que
 *      manda el WhatsApp.
 *   3. Marca `recovery_dispatched_at = now()` para que el próximo
 *      tick no vuelva a disparar el mismo carrito.
 *
 * Anti-spam: el flag `recovery_dispatched_at` es la única barrera. Si
 * el automation falla al enviar (templates rechazados, sin token),
 * el mensaje no se manda pero el flag igual se setea — preferimos no
 * spamear a costa de perder algunos recovery sobre intentarlo en loop.
 */
async function cronHandler(request: Request) {
  try {
    assertCronAuth(request, 'AUTOMATION_CRON_SECRET')
  } catch (r) {
    if (r instanceof Response) return r
    throw r
  }

  const admin = supabaseAdmin()
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString()

  const { data: due, error } = await admin
    .from('shopify_checkouts')
    .select(
      'id, workspace_id, shop_domain, checkout_id, customer_email, customer_phone, customer_name, total_price, currency, abandoned_checkout_url, line_items, created_at',
    )
    .is('completed_at', null)
    .is('recovery_dispatched_at', null)
    .not('customer_phone', 'is', null)
    .lt('created_at', twoHoursAgo)
    .order('created_at', { ascending: true })
    .limit(50)

  if (error) {
    return serverError(error)
  }
  if (!due || due.length === 0) {
    return NextResponse.json({ processed: 0 })
  }

  // Dedupe by recipient WITHIN this run. Shopify mints a NEW checkout token
  // every time the same customer re-enters checkout, so one abandoner routinely
  // owns several open `shopify_checkouts` rows (same phone, different
  // checkout_id). Without this, the cron claims each row and fires an identical
  // "dejaste tu carrito" to the same person two or three times in a row. Keyed
  // by the normalized phone; the first row wins, the siblings are claimed
  // (so the next tick skips them) but never re-sent.
  const dispatchedPhones = new Set<string>()

  let processed = 0
  let dispatched = 0
  for (const row of due) {
    const r = row as {
      id: string
      workspace_id: string
      shop_domain: string
      checkout_id: string
      customer_email: string | null
      customer_phone: string
      customer_name: string | null
      total_price: number | null
      currency: string | null
      abandoned_checkout_url: string | null
      line_items: unknown
    }

    // Reclamamos el row primero: el siguiente tick no vuelve a tocarlo
    // aunque el dispatch falle. Si dejáramos el flag para después del
    // dispatch, un crash entre dispatch y update mandaría dos recovery.
    // Also require completed_at to still be null at claim time. The
    // orders/create webhook (or checkouts/update) may have completed
    // the cart in the window between the SELECT and this UPDATE — if
    // we don't re-check we'd send "vi que dejaste tu carrito" to a
    // customer who already paid minutes ago.
    const { data: claim } = await admin
      .from('shopify_checkouts')
      .update({ recovery_dispatched_at: new Date().toISOString() })
      .eq('id', r.id)
      .is('recovery_dispatched_at', null)
      .is('completed_at', null)
      .select('id')
      .maybeSingle()
    if (!claim) continue

    // Same person, multiple open checkout tokens → send once. The row is
    // already claimed above, so skipping here just means "no second message".
    const phoneKey = (r.customer_phone || '').replace(/\D/g, '')

    // A quien se le rechazó el PAGO no le mandamos además "dejaste tu
    // carrito". Es la misma persona y el mismo intento de compra visto
    // desde dos lados: un rechazo de tarjeta deja el checkout abierto, así
    // que sin esta barrera recibiría dos mensajes con una hora de
    // diferencia (este cron a las 2h, el de pagos a las 3h).
    //
    // Gana el de pago rechazado, por dos razones: dice lo que realmente
    // pasó en vez de un "dejaste algo a medias" genérico, y va como
    // plantilla Utility, que Meta entrega — las Marketing de recuperación
    // las viene reteniendo.
    if (phoneKey) {
      const last8 = phoneKey.slice(-8)
      const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
      const { data: rejected } = await admin
        .from('mp_rejected_payments')
        .select('id')
        .eq('workspace_id', r.workspace_id)
        .like('phone', `%${last8}`)
        .gte('rejected_at', dayAgo)
        .is('skip_reason', null)
        .is('paid_at', null)
        .limit(1)
        .maybeSingle()
      if (rejected) {
        processed++
        continue
      }
    }

    if (phoneKey) {
      if (dispatchedPhones.has(phoneKey)) {
        processed++
        continue
      }
      dispatchedPhones.add(phoneKey)

      // Cross-run guard: a sibling checkout for the same phone may have been
      // recovered in a PREVIOUS tick (within the last day). If so, don't
      // re-message — the abandoner already got the nudge.
      const last8 = phoneKey.slice(-8)
      const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
      const { data: recent } = await admin
        .from('shopify_checkouts')
        .select('id')
        .eq('workspace_id', r.workspace_id)
        .neq('id', r.id)
        .like('customer_phone', `%${last8}`)
        .gte('recovery_dispatched_at', dayAgo)
        .limit(1)
        .maybeSingle()
      if (recent) {
        processed++
        continue
      }
    }

    try {
      const contactId = await upsertWhatsappContact(admin, {
        workspaceId: r.workspace_id,
        phone: r.customer_phone,
        name: r.customer_name ?? undefined,
        email: r.customer_email ?? undefined,
      })
      if (!contactId) {
        processed++
        continue
      }

      // Tag the abandoner so they're selectable in segments / broadcasts:
      // carrito-abandonado + rango de unidades. Data-only, no send.
      try {
        const items = Array.isArray(r.line_items)
          ? (r.line_items as Record<string, unknown>[])
          : []
        const units = items.reduce(
          (sum, li) => sum + (Number(li.quantity) || 0),
          0,
        )
        await applyCategoryTags(admin, r.workspace_id, contactId, {
          ordersCount: 0,
          isAbandoned: true,
          units,
        })
      } catch (e) {
        log.captureException(e, { checkoutId: r.id })
      }

      const cartVars = {
        checkout_url: r.abandoned_checkout_url ?? '',
        total_price: String(r.total_price ?? ''),
        currency: r.currency ?? '',
        customer_name: r.customer_name ?? '',
        checkout_token: r.checkout_id,
      }
      await runAutomationsForTrigger({
        workspaceId: r.workspace_id,
        triggerType: 'shopify_abandoned_checkout',
        contactId,
        context: { vars: cartVars },
      })
      // Voice AI: si un agente activó "llamar para recuperar carrito", se encola
      // la llamada sin automatización. Respeta horario/opt-out/límites/dedup.
      void maybeAutoVoiceCall(admin, {
        workspaceId: r.workspace_id,
        contactId,
        callType: 'cart_recovery',
        context: cartVars,
      })
      dispatched++
    } catch (err) {
      // Track attempts so a transient failure (Meta blip, template
      // rejection) can be retried up to 3 times instead of silently
      // burning the recovery permanently. Migration 059 added the
      // `recovery_attempts` + `recovery_last_error` columns.
      const errMsg = err instanceof Error ? err.message : String(err)
      log.captureException(err, { checkoutId: r.id })
      const { data: cur } = await admin
        .from('shopify_checkouts')
        .select('recovery_attempts')
        .eq('id', r.id)
        .maybeSingle()
      const attempt =
        ((cur as { recovery_attempts?: number } | null)?.recovery_attempts ?? 0) + 1
      const patch: Record<string, unknown> = {
        recovery_attempts: attempt,
        recovery_last_error: errMsg.slice(0, 500),
      }
      // Transient — reset the claim so the next tick retries.
      if (attempt < 3) {
        patch.recovery_dispatched_at = null
      }
      await admin.from('shopify_checkouts').update(patch).eq('id', r.id)
    }
    processed++
  }

  return NextResponse.json({ processed, dispatched })
}

/** Registra la corrida en cron_runs con duración y resultado reales. */
export const GET = withCronRun("shopify-cart-recovery", cronHandler);
