import type { SupabaseClient } from '@supabase/supabase-js'
import {
  fetchPayments,
  payerName,
  payerPhone,
  samePerson,
  type MpPayment,
} from './client'
import {
  ingestRejectedPayments,
  type RejectedPaymentInput,
} from './rejected'

/**
 * Trae los pagos rechazados de Mercado Pago de un workspace y los deja
 * listos para la recuperación.
 *
 * Tres cosas que no son obvias:
 *
 * 1. Un rechazo NO trae contacto. Mercado Pago enmascara el pagador en los
 *    pagos que no prosperaron, así que el teléfono sale de cruzar contra
 *    los carritos abandonados de la tienda y contra los contactos que ya
 *    existen. Sin ese cruce no hay a quién escribirle.
 *
 * 2. Una misma persona reintenta varias veces. Se agrupan los intentos y
 *    se manda UNA fila, con el id de pago más viejo como clave estable.
 *
 * 3. Si después del rechazo aparece un pago APROBADO de esa persona, la
 *    fila se marca `paid_at` y nunca se le escribe: compró igual, por su
 *    cuenta. Es la regla central del producto — el mensaje es para quien
 *    se quedó sin comprar, no para quien tardó dos intentos.
 */

export interface MpSyncResult {
  fetched: number
  rejected: number
  people: number
  paid: number
  ingested: { inserted: number; updated: number; invalid: number }
}

interface PersonGroup {
  key: string
  ids: string[]
  attempts: MpPayment[]
  name: string
  email: string | null
  phone: string | null
  lastRejectedAt: string
  paidAt: string | null
}

function whenOf(p: MpPayment): string {
  return p.date_created ?? p.date_approved ?? ''
}

/** Agrupa los intentos rechazados por persona (email exacto, o nombre). */
function groupByPerson(rejected: MpPayment[]): PersonGroup[] {
  const groups: PersonGroup[] = []

  for (const p of rejected) {
    const name = payerName(p)
    const email = (p.payer?.email ?? '').trim().toLowerCase() || null
    // El email es la señal fuerte; el nombre es el respaldo cuando MP lo
    // enmascara (que es el caso habitual en los rechazados).
    const hit = groups.find((g) =>
      email && g.email ? g.email === email : samePerson(g.name, name),
    )
    if (hit) {
      hit.attempts.push(p)
      if (!hit.email && email) hit.email = email
      // Nos quedamos con el nombre más largo: los enmascarados vienen
      // recortados y el completo es el que sirve para saludar.
      if (name.length > hit.name.length && !name.includes('*')) hit.name = name
    } else {
      groups.push({
        key: '',
        ids: [],
        attempts: [p],
        name,
        email,
        phone: payerPhone(p),
        lastRejectedAt: '',
        paidAt: null,
      })
    }
  }

  for (const g of groups) {
    g.ids = g.attempts.map((a) => String(a.id)).sort()
    // Clave = id más viejo. Los ids de MP son crecientes, así que el mínimo
    // no se mueve cuando llegan reintentos nuevos y reenviar la lista no
    // duplica la fila ni el mensaje.
    g.key = g.ids[0]
    g.lastRejectedAt = g.attempts
      .map(whenOf)
      .filter(Boolean)
      .sort()
      .slice(-1)[0] ?? ''
    if (!g.phone) {
      g.phone = g.attempts.map(payerPhone).find(Boolean) ?? null
    }
  }

  return groups
}

/** Marca a quién le apareció un pago aprobado DESPUÉS de su último rechazo. */
function markSelfPaid(groups: PersonGroup[], approved: MpPayment[]): number {
  let n = 0
  for (const g of groups) {
    const paid = approved.find((a) => {
      const when = whenOf(a)
      if (!when || when <= g.lastRejectedAt) return false
      const email = (a.payer?.email ?? '').trim().toLowerCase()
      if (g.email && email) return g.email === email
      return samePerson(g.name, payerName(a))
    })
    if (paid) {
      g.paidAt = whenOf(paid)
      n++
    }
  }
  return n
}

interface CheckoutRow {
  customer_email: string | null
  customer_phone: string | null
  customer_name: string | null
  total_price: number | null
  abandoned_checkout_url: string | null
}

/**
 * Completa email/teléfono desde los carritos abandonados de la tienda.
 *
 * El rechazo y el carrito son el mismo intento de compra visto desde dos
 * lados: mismo monto, mismo nombre. El carrito sí trae contacto y además
 * el link para retomar la compra.
 */
async function enrichFromCheckouts(
  admin: SupabaseClient,
  workspaceId: string,
  groups: PersonGroup[],
): Promise<void> {
  const needy = groups.filter((g) => !g.phone || !g.email)
  if (needy.length === 0) return

  const { data } = await admin
    .from('shopify_checkouts')
    .select('customer_email, customer_phone, customer_name, total_price, abandoned_checkout_url')
    .eq('workspace_id', workspaceId)
    .not('customer_phone', 'is', null)
    .order('created_at', { ascending: false })
    .limit(2000)

  const checkouts = (data ?? []) as CheckoutRow[]
  if (checkouts.length === 0) return

  const byAmount = new Map<number, CheckoutRow[]>()
  for (const c of checkouts) {
    const amt = Math.round(Number(c.total_price ?? 0))
    const list = byAmount.get(amt) ?? []
    list.push(c)
    byAmount.set(amt, list)
  }

  for (const g of needy) {
    const amount = Math.round(Number(g.attempts[0].transaction_amount ?? 0))
    const email = g.email
    const candidates = byAmount.get(amount) ?? []
    const match =
      (email
        ? checkouts.find((c) => (c.customer_email ?? '').toLowerCase() === email)
        : undefined) ?? candidates.find((c) => samePerson(c.customer_name, g.name))
    if (!match) continue
    if (!g.phone) g.phone = match.customer_phone
    if (!g.email) g.email = match.customer_email
  }
}

/** Último recurso: el contacto ya existe en la base con ese correo. */
async function enrichFromContacts(
  admin: SupabaseClient,
  workspaceId: string,
  groups: PersonGroup[],
): Promise<void> {
  const emails = groups
    .filter((g) => !g.phone && g.email)
    .map((g) => g.email as string)
  if (emails.length === 0) return

  const { data } = await admin
    .from('contacts')
    .select('email, phone')
    .eq('workspace_id', workspaceId)
    .in('email', [...new Set(emails)])
    .not('phone', 'is', null)

  const byEmail = new Map<string, string>()
  for (const c of (data ?? []) as { email: string | null; phone: string | null }[]) {
    if (c.email && c.phone) byEmail.set(c.email.toLowerCase(), c.phone)
  }
  for (const g of groups) {
    if (!g.phone && g.email) g.phone = byEmail.get(g.email) ?? null
  }
}

/**
 * Corre el sync completo para un workspace ya conectado.
 *
 * @param windowDays ventana hacia atrás. Se pide con solape en cada
 *   corrida porque un pago puede aparecer con retraso; la ingesta es
 *   idempotente, así que repetir no duplica.
 */
export async function syncWorkspaceRejectedPayments(
  admin: SupabaseClient,
  args: {
    workspaceId: string
    token: string
    windowDays: number
    defaultCountry: string
  },
): Promise<MpSyncResult> {
  const until = new Date()
  const since = new Date(until.getTime() - args.windowDays * 86_400_000)

  const payments = await fetchPayments(args.token, since.toISOString(), until.toISOString())
  const rejected = payments.filter((p) => p.status === 'rejected')
  const approved = payments.filter((p) => p.status === 'approved')

  const groups = groupByPerson(rejected)
  const paid = markSelfPaid(groups, approved)

  await enrichFromCheckouts(admin, args.workspaceId, groups)
  await enrichFromContacts(admin, args.workspaceId, groups)

  const inputs: RejectedPaymentInput[] = groups.map((g) => {
    const last = g.attempts
      .slice()
      .sort((a, b) => (whenOf(a) < whenOf(b) ? -1 : 1))
      .slice(-1)[0]
    return {
      external_key: g.key,
      mp_payment_ids: g.ids,
      rejected_at: g.lastRejectedAt,
      name: g.name || null,
      email: g.email,
      phone: g.phone,
      amount: last.transaction_amount ?? null,
      currency: last.currency_id ?? 'ARS',
      installments: last.installments ?? null,
      attempts: g.attempts.length,
      status_detail: last.status_detail ?? null,
      payment_method: last.payment_method_id ?? last.payment_type_id ?? null,
    }
  })

  const ingested = await ingestRejectedPayments(admin, {
    workspaceId: args.workspaceId,
    defaultCountry: args.defaultCountry,
    payments: inputs,
  })

  // Quien compró por su cuenta queda marcado para que el cron de envío no
  // lo toque. Se hace DESPUÉS de la ingesta para que la fila ya exista.
  const selfPaid = groups.filter((g) => g.paidAt)
  for (const g of selfPaid) {
    await admin
      .from('mp_rejected_payments')
      .update({ paid_at: g.paidAt, updated_at: new Date().toISOString() })
      .eq('workspace_id', args.workspaceId)
      .eq('external_key', g.key)
      .is('contacted_at', null)
  }

  return {
    fetched: payments.length,
    rejected: rejected.length,
    people: groups.length,
    paid,
    ingested: {
      inserted: ingested.inserted,
      updated: ingested.updated,
      invalid: ingested.invalid,
    },
  }
}
