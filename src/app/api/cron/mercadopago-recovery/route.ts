import { NextResponse } from 'next/server'
import { assertCronAuth } from '@/lib/auth/cron'
import { serverError } from '@/lib/api/errors'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { runAutomationsForTrigger } from '@/lib/automations/engine'
import { upsertWhatsappContact } from '@/lib/shopify/contact-upsert'
import { isOptedOut } from '@/lib/whatsapp/opt-out'
import { recentlyContacted } from '@/lib/outreach/cooldown'
import {
  REJECTION_REASONS,
  shouldContact,
  type ReasonBucket,
} from '@/lib/mercadopago/rejected'
import {
  getActiveShopifyConnection,
  fetchRecentOrders,
  normPhone,
} from '@/lib/attribution/shopify'
import { withCronRun } from '@/lib/cron/heartbeat'
import { getLogger } from '@/lib/log/logger'

const log = getLogger('cron.mercadopago-recovery')

/**
 * Recuperación de pagos rechazados de Mercado Pago.
 *
 * Corre cada hora y hace dos pasadas independientes:
 *
 *   1. ENVÍO — toma las filas de `mp_rejected_payments` con teléfono que
 *      ya cumplieron la espera y dispara el trigger `payment_rejected`.
 *      Un mensaje por persona, el mismo para todos los motivos.
 *
 *   2. RECUPERACIÓN — a quien ya se contactó, le busca un pedido posterior
 *      en Shopify. Si aparece, marca `recovered_at` + monto. Eso es lo que
 *      la hoja de contabilidad muestra como "Recuperado" y lo que hace
 *      medible la automatización.
 *
 * Las dos pasadas son independientes a propósito: si Shopify está caído, el
 * envío sigue funcionando y la recuperación se detecta en la corrida
 * siguiente.
 */

/**
 * Espera antes de escribir, por defecto. Un rechazo se reintenta solo muy
 * seguido (se ven hasta 11 intentos de la misma persona): escribir al toque
 * interrumpe a alguien que está en pleno checkout. Pasadas las horas, quien
 * no completó la compra es un cliente perdido de verdad.
 *
 * Se puede cambiar por automatización en `trigger_config.hours_after`.
 */
const DEFAULT_GRACE_HOURS = 3

/**
 * Antigüedad máxima por defecto. Sin este tope, encender la automatización
 * con meses de historial cargado le escribiría a cientos de personas por un
 * pago que falló en marzo. Configurable en `trigger_config.max_age_days`.
 */
const DEFAULT_MAX_AGE_DAYS = 14

/** Techo duro de la espera configurable: una semana. */
const MAX_GRACE_HOURS = 168

interface TriggerSettings {
  graceHours: number
  maxAgeDays: number
}

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.min(Math.max(Math.trunc(n), min), max)
}

/** Lee la espera y la antigüedad que configuró el comerciante. */
function settingsOf(config: Record<string, unknown> | null | undefined): TriggerSettings {
  return {
    graceHours: clampInt(config?.hours_after, DEFAULT_GRACE_HOURS, 1, MAX_GRACE_HOURS),
    maxAgeDays: clampInt(config?.max_age_days, DEFAULT_MAX_AGE_DAYS, 1, 90),
  }
}

/** No volver a escribirle a la misma persona antes de esto. */
const RECONTACT_DAYS = 30

/** Filas por corrida. A una por hora alcanza de sobra para el volumen real. */
const BATCH = 50

/** Ventana en la que un pedido posterior cuenta como recuperación. */
const RECOVERY_WINDOW_DAYS = 14

interface PendingRow {
  id: string
  workspace_id: string
  external_key: string
  payer_name: string | null
  email: string | null
  phone: string
  amount: number | null
  currency: string
  installments: number | null
  attempts: number
  status_detail: string | null
  reason_bucket: ReasonBucket | null
  recovery_url: string | null
  rejected_at: string
}

/** Marca la fila como no enviada y por qué. Deja `dispatched_at` puesto. */
async function skip(
  admin: ReturnType<typeof supabaseAdmin>,
  id: string,
  reason: string,
): Promise<void> {
  await admin
    .from('mp_rejected_payments')
    .update({ skip_reason: reason, updated_at: new Date().toISOString() })
    .eq('id', id)
}

/**
 * De las automatizaciones activas, cuáles pueden REALMENTE enviar hoy.
 *
 * Tener la automatización armada no alcanza: Meta tarda entre uno y dos días
 * en aprobar una plantilla nueva, y mientras está en revisión cada envío
 * rebota. Sin este chequeo, el cron gastaría los 3 reintentos de cada fila
 * durante la espera y ese lote quedaría muerto justo antes de que la
 * plantilla se habilite — el peor momento posible.
 *
 * Un paso que no manda plantilla (mensaje suelto, etiqueta, asignar) no
 * depende de Meta, así que ese workspace se considera listo igual.
 */
async function resolveSendableWorkspaces(
  admin: ReturnType<typeof supabaseAdmin>,
  autos: { id: string; workspace_id: string }[],
): Promise<string[]> {
  if (autos.length === 0) return []

  const { data: steps } = await admin
    .from('automation_steps')
    .select('automation_id, step_type, step_config')
    .in('automation_id', autos.map((a) => a.id))
    .eq('step_type', 'send_template')

  const needed = new Map<string, Set<string>>() // automation_id -> template names
  for (const s of (steps ?? []) as {
    automation_id: string
    step_config: { template_name?: string } | null
  }[]) {
    const name = s.step_config?.template_name
    if (!name) continue
    const set = needed.get(s.automation_id) ?? new Set<string>()
    set.add(name)
    needed.set(s.automation_id, set)
  }

  const allNames = [...new Set([...needed.values()].flatMap((s) => [...s]))]
  const approved = new Set<string>()
  if (allNames.length) {
    const { data: tpls } = await admin
      .from('message_templates')
      .select('name, workspace_id, status')
      .in('workspace_id', [...new Set(autos.map((a) => a.workspace_id))])
      .in('name', allNames)
    for (const t of (tpls ?? []) as {
      name: string
      workspace_id: string
      status: string | null
    }[]) {
      if ((t.status ?? '').toUpperCase() === 'APPROVED') {
        approved.add(`${t.workspace_id}::${t.name}`)
      }
    }
  }

  const out: string[] = []
  for (const a of autos) {
    const names = needed.get(a.id)
    // Sin paso de plantilla no hay nada que esperar de Meta.
    if (!names || names.size === 0) {
      out.push(a.workspace_id)
      continue
    }
    const allApproved = [...names].every((n) => approved.has(`${a.workspace_id}::${n}`))
    if (allApproved) out.push(a.workspace_id)
  }
  return out
}

type ShopifyOrders = Awaited<ReturnType<typeof fetchRecentOrders>> | null
type OrdersCache = Map<string, ShopifyOrders>

/**
 * ¿La persona terminó comprando después del rechazo?
 *
 * Un rechazo no genera pedido, así que cualquier pedido posterior de esa
 * misma persona es la compra que sí prosperó. Se empareja por correo (la
 * señal fuerte: sale del mismo checkout) y por los últimos 8 dígitos del
 * teléfono, que cubre al que volvió a comprar como invitado.
 *
 * Ante un fallo de Shopify devuelve `false` — es decir, sigue adelante y
 * manda. El error opuesto (frenar todos los envíos porque la tienda no
 * contesta) rompería la automatización entera por una caída ajena.
 */
async function boughtSinceRejection(
  admin: ReturnType<typeof supabaseAdmin>,
  row: { workspace_id: string; email: string | null; phone: string; rejected_at: string },
  cache: OrdersCache,
): Promise<boolean> {
  if (!cache.has(row.workspace_id)) {
    let orders: ShopifyOrders = null
    try {
      const conn = await getActiveShopifyConnection(admin, row.workspace_id)
      if (conn) {
        // 90 días cubre de sobra cualquier `max_age_days` configurable.
        const since = new Date(Date.now() - 90 * 86_400_000).toISOString()
        orders = await fetchRecentOrders(conn, since)
      }
    } catch (err) {
      log.captureException(err, { workspaceId: row.workspace_id })
      orders = null
    }
    cache.set(row.workspace_id, orders)
  }

  const orders = cache.get(row.workspace_id)
  if (!orders || orders.length === 0) return false

  const email = row.email?.toLowerCase() ?? null
  const last8 = normPhone(row.phone)?.slice(-8) ?? null

  return orders.some((o) => {
    if (o.created_at <= row.rejected_at) return false
    if (email && (o.email ?? '').toLowerCase() === email) return true
    if (last8) {
      const op = normPhone(o.phone)
      if (op && op.endsWith(last8)) return true
    }
    return false
  })
}

async function sendPass(admin: ReturnType<typeof supabaseAdmin>) {
  const now = Date.now()
  // La espera real es por automatización, así que acá sólo se descarta lo
  // recién nacido (una hora, el mínimo configurable). El corte fino de cada
  // workspace se aplica fila por fila, más abajo.
  const minCutoff = new Date(now - 3_600_000).toISOString()

  const { data, error } = await admin
    .from('mp_rejected_payments')
    .select(
      'id, workspace_id, external_key, payer_name, email, phone, amount, currency, installments, attempts, status_detail, reason_bucket, recovery_url, rejected_at',
    )
    .is('dispatched_at', null)
    .is('contacted_at', null)
    .is('skip_reason', null)
    // Quien completó la compra por su cuenta no recibe nada. Es la regla
    // central: el mensaje es para el que se quedó sin comprar.
    .is('paid_at', null)
    .not('phone', 'is', null)
    .lt('rejected_at', minCutoff)
    .order('rejected_at', { ascending: false })
    .limit(BATCH)

  if (error) throw error
  const due = (data ?? []) as PendingRow[]
  if (due.length === 0) return { processed: 0, dispatched: 0, skipped: 0 }

  // Si el workspace todavía NO tiene una automatización activa con este
  // disparador, no se toca ninguna fila.
  //
  // Sin esta guarda, la ingesta puede arrancar días antes de que el
  // comerciante termine de aprobar la plantilla y armar la automatización.
  // Cada corrida quemaría un intento de los 5 que tiene cada fila, así que
  // en cinco horas toda la gente ingresada quedaría marcada `not_sent` para
  // siempre — y el día que la automatización existiera, no le escribiría a
  // nadie de ese lote. Mejor esperar sin gastar intentos.
  const workspaces = [...new Set(due.map((r) => r.workspace_id))]
  const { data: autos } = await admin
    .from('automations')
    .select('id, workspace_id, trigger_config')
    .in('workspace_id', workspaces)
    .eq('trigger_type', 'payment_rejected')
    .eq('is_active', true)
    .is('deleted_at', null)
  const automations = (autos ?? []) as {
    id: string
    workspace_id: string
    trigger_config: Record<string, unknown> | null
  }[]
  const ready = new Set(await resolveSendableWorkspaces(admin, automations))

  // La espera y la antigüedad las decide el comerciante en la automatización.
  const settingsByWorkspace = new Map<string, TriggerSettings>()
  for (const a of automations) {
    if (!settingsByWorkspace.has(a.workspace_id)) {
      settingsByWorkspace.set(a.workspace_id, settingsOf(a.trigger_config))
    }
  }

  const actionable = due.filter((r) => {
    if (!ready.has(r.workspace_id)) return false
    const s = settingsByWorkspace.get(r.workspace_id)
    if (!s) return false
    // Todavía no cumplió la espera: se deja para una corrida futura SIN
    // reclamarla, porque no es un descarte sino un "todavía no".
    return r.rejected_at < new Date(now - s.graceHours * 3_600_000).toISOString()
  })
  if (actionable.length === 0) {
    return { processed: 0, dispatched: 0, skipped: 0, waiting_to_send: due.length }
  }

  let processed = 0
  let dispatched = 0
  let skipped = 0

  // Una sola persona por corrida aunque tenga varias filas (dos grupos de
  // intentos que la hoja no unió). Misma barrera que el cron de carritos.
  const seenPhones = new Set<string>()

  // Pedidos de Shopify por workspace, traídos una sola vez por corrida.
  // Sin esta caché, comprobar "¿ya compró?" haría una llamada a Shopify por
  // cada fila.
  const ordersCache: OrdersCache = new Map()

  for (const r of actionable) {
    processed++

    // Reclamamos ANTES de cualquier trabajo: si el proceso muere en el
    // medio, la fila no se reintenta y nadie recibe el mensaje dos veces.
    const { data: claim } = await admin
      .from('mp_rejected_payments')
      .update({ dispatched_at: new Date().toISOString() })
      .eq('id', r.id)
      .is('dispatched_at', null)
      .select('id')
      .maybeSingle()
    if (!claim) continue

    const settings = settingsByWorkspace.get(r.workspace_id) ?? {
      graceHours: DEFAULT_GRACE_HOURS,
      maxAgeDays: DEFAULT_MAX_AGE_DAYS,
    }
    const ageFloor = new Date(now - settings.maxAgeDays * 86_400_000).toISOString()
    if (r.rejected_at < ageFloor) {
      await skip(admin, r.id, 'too_old')
      skipped++
      continue
    }

    // ¿Terminó comprando? El pago rechazado no crea pedido, así que un
    // pedido posterior de esa misma persona significa que volvió y pagó
    // —con otra tarjeta, en otro intento— y ya no hay nada que recuperar.
    // Escribirle igual sería decirle "no pudimos procesar tu pago" a
    // alguien que tiene el pedido confirmado.
    if (await boughtSinceRejection(admin, r, ordersCache)) {
      await admin
        .from('mp_rejected_payments')
        .update({ paid_at: new Date().toISOString(), skip_reason: 'already_paid' })
        .eq('id', r.id)
      skipped++
      continue
    }

    const bucket = (r.reason_bucket ?? 'other') as ReasonBucket
    if (!shouldContact(bucket)) {
      await skip(admin, r.id, 'risk')
      skipped++
      continue
    }

    const phoneKey = r.phone.replace(/\D/g, '')
    if (seenPhones.has(phoneKey)) {
      await skip(admin, r.id, 'recent_contact')
      skipped++
      continue
    }
    seenPhones.add(phoneKey)

    // Antispam entre corridas: los últimos 8 dígitos porque el mismo número
    // convive con y sin el 9 argentino según de dónde vino.
    const last8 = phoneKey.slice(-8)
    const since = new Date(now - RECONTACT_DAYS * 86_400_000).toISOString()
    const { data: recent } = await admin
      .from('mp_rejected_payments')
      .select('id')
      .eq('workspace_id', r.workspace_id)
      .neq('id', r.id)
      .like('phone', `%${last8}`)
      .gte('contacted_at', since)
      .limit(1)
      .maybeSingle()
    if (recent) {
      await skip(admin, r.id, 'recent_contact')
      skipped++
      continue
    }

    // Red de seguridad del otro lado del cruce con carritos abandonados.
    // El cron de carritos ya se hace a un lado cuando ve un rechazo, pero
    // corre a las 2h y éste a las 3h: si el rechazo se ingirió DESPUÉS de
    // que el carrito salió, aquella barrera no lo pudo ver. Acá se corta el
    // segundo mensaje mirando lo que efectivamente se envió.
    const { data: cartSent } = await admin
      .from('shopify_checkouts')
      .select('id')
      .eq('workspace_id', r.workspace_id)
      .like('customer_phone', `%${last8}`)
      .gte('recovery_dispatched_at', new Date(now - 24 * 3_600_000).toISOString())
      .limit(1)
      .maybeSingle()
    if (cartSent) {
      await skip(admin, r.id, 'cart_recovery_sent')
      skipped++
      continue
    }

    try {
      const contactId = await upsertWhatsappContact(admin, {
        workspaceId: r.workspace_id,
        phone: r.phone,
        name: r.payer_name ?? undefined,
        email: r.email ?? undefined,
      })
      if (!contactId) {
        await skip(admin, r.id, 'no_contact')
        skipped++
        continue
      }

      // Barrera compartida contra duplicados: si ya se le mandó cualquier
      // plantilla en las últimas 24h, no se le suma ésta. Cubre lo que las
      // barreras por tabla no pueden ver —una campaña, una reactivación—
      // porque mira el envío real y no el flujo que lo originó.
      const nudged = await recentlyContacted(admin, {
        workspaceId: r.workspace_id,
        contactId,
      })
      if (nudged.blocked) {
        await admin
          .from('mp_rejected_payments')
          .update({ contact_id: contactId, skip_reason: 'recently_contacted' })
          .eq('id', r.id)
        skipped++
        continue
      }

      // Quien pidió baja no recibe una recuperación de venta. El envío la
      // respeta igual, pero chequear acá deja el motivo en la hoja en vez
      // de un error genérico.
      if (await isOptedOut(admin, r.workspace_id, contactId)) {
        await admin
          .from('mp_rejected_payments')
          .update({ contact_id: contactId, skip_reason: 'opted_out' })
          .eq('id', r.id)
        skipped++
        continue
      }

      const reasonText = r.status_detail
        ? (REJECTION_REASONS[r.status_detail] ?? r.status_detail)
        : ''

      // Marca de tiempo ANTES del disparo: es el piso de la ventana con la
      // que después buscamos el log que confirma el envío.
      const dispatchStart = Date.now()

      await runAutomationsForTrigger({
        workspaceId: r.workspace_id,
        triggerType: 'payment_rejected',
        contactId,
        context: {
          vars: {
            customer_name: r.payer_name ?? '',
            customer_email: r.email ?? '',
            customer_phone: r.phone,
            total_price: String(r.amount ?? ''),
            currency: r.currency,
            installments: String(r.installments ?? ''),
            payment_attempts: String(r.attempts),
            payment_reason: reasonText,
            payment_reason_code: r.status_detail ?? '',
            payment_reason_bucket: bucket,
            checkout_url: r.recovery_url ?? '',
          },
        },
      })

      // `runAutomationsForTrigger` no informa si mandó algo: devuelve void
      // tanto si envió como si no había automatización activa, si el
      // segmento no matcheó o si el guard de IA reciente la frenó. Marcar
      // "contactado" a ciegas llenaría la hoja de contadores falsos, así
      // que confirmamos contra el rastro real que deja el motor — el mismo
      // `automation_logs` del que después vive la atribución.
      const { data: logRow } = await admin
        .from('automation_logs')
        .select('id')
        .eq('workspace_id', r.workspace_id)
        .eq('contact_id', contactId)
        .eq('trigger_event', 'payment_rejected')
        .gte('created_at', new Date(dispatchStart).toISOString())
        .in('status', ['success', 'partial'])
        .limit(1)
        .maybeSingle()

      if (!logRow) {
        // No se envió: puede ser que el comerciante todavía no creó la
        // automatización, que el segmento no matcheó, o que el guard de IA
        // reciente la frenó. Los tres son transitorios, así que SOLTAMOS el
        // claim en vez de quemar la fila — si marcáramos skip_reason la
        // consulta la excluiría para siempre y crear la automatización
        // después no recuperaría a nadie de los ya procesados.
        //
        // `dispatch_attempts` la corta a los 5 intentos (5 horas) para que
        // una fila sin automatización no se relea eternamente; MAX_AGE_DAYS
        // es el tope duro de todos modos.
        const { data: cur } = await admin
          .from('mp_rejected_payments')
          .select('dispatch_attempts')
          .eq('id', r.id)
          .maybeSingle()
        const attempt =
          ((cur as { dispatch_attempts?: number } | null)?.dispatch_attempts ?? 0) + 1
        await admin
          .from('mp_rejected_payments')
          .update({
            contact_id: contactId,
            dispatch_attempts: attempt,
            last_error: 'not_sent',
            dispatched_at: attempt < 5 ? null : new Date().toISOString(),
            skip_reason: attempt < 5 ? null : 'not_sent',
            updated_at: new Date().toISOString(),
          })
          .eq('id', r.id)
        skipped++
        continue
      }

      await admin
        .from('mp_rejected_payments')
        .update({
          contact_id: contactId,
          contacted_at: new Date().toISOString(),
          last_error: null,
          skip_reason: null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', r.id)
      dispatched++
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      log.captureException(err, { rejectedId: r.id })
      const { data: cur } = await admin
        .from('mp_rejected_payments')
        .select('dispatch_attempts')
        .eq('id', r.id)
        .maybeSingle()
      const attempt =
        ((cur as { dispatch_attempts?: number } | null)?.dispatch_attempts ?? 0) + 1
      const patch: Record<string, unknown> = {
        dispatch_attempts: attempt,
        last_error: msg.slice(0, 500),
        updated_at: new Date().toISOString(),
      }
      // Fallo transitorio (Meta caída, plantilla en revisión): soltamos el
      // claim para reintentar. A la tercera se queda quieto.
      if (attempt < 3) patch.dispatched_at = null
      await admin.from('mp_rejected_payments').update(patch).eq('id', r.id)
    }
  }

  return { processed, dispatched, skipped }
}

/**
 * Marca como recuperados a los contactados que después compraron.
 *
 * Empareja por email o teléfono contra los pedidos de Shopify creados
 * DESPUÉS del contacto. El email es la señal fuerte (la hoja lo saca del
 * carrito abandonado, que es el mismo que usa el pedido); el teléfono es el
 * respaldo cuando el cliente compró como invitado con otro correo.
 */
async function recoveryPass(admin: ReturnType<typeof supabaseAdmin>) {
  const since = new Date(Date.now() - RECOVERY_WINDOW_DAYS * 86_400_000).toISOString()

  const { data, error } = await admin
    .from('mp_rejected_payments')
    .select('id, workspace_id, email, phone, contacted_at')
    .not('contacted_at', 'is', null)
    .is('recovered_at', null)
    .gte('contacted_at', since)
    .limit(500)

  if (error) throw error
  const pending = (data ?? []) as {
    id: string
    workspace_id: string
    email: string | null
    phone: string | null
    contacted_at: string
  }[]
  if (pending.length === 0) return { checked: 0, recovered: 0 }

  // Agrupamos por workspace: un solo fetch a Shopify por tienda, no uno por
  // fila. Con 500 filas eso es la diferencia entre 1 llamada y 500.
  const byWorkspace = new Map<string, typeof pending>()
  for (const row of pending) {
    const list = byWorkspace.get(row.workspace_id) ?? []
    list.push(row)
    byWorkspace.set(row.workspace_id, list)
  }

  let recovered = 0
  for (const [workspaceId, rows] of byWorkspace) {
    const conn = await getActiveShopifyConnection(admin, workspaceId)
    if (!conn) continue

    const oldest = rows.reduce(
      (min, r) => (r.contacted_at < min ? r.contacted_at : min),
      rows[0].contacted_at,
    )

    let orders: Awaited<ReturnType<typeof fetchRecentOrders>>
    try {
      orders = await fetchRecentOrders(conn, oldest)
    } catch (err) {
      // Shopify caído o token vencido: la corrida siguiente reintenta. No
      // marcamos nada para no inventar recuperaciones que no pasaron.
      log.captureException(err, { workspaceId })
      continue
    }

    for (const row of rows) {
      const email = row.email?.toLowerCase() ?? null
      const phoneKey = normPhone(row.phone)
      const last8 = phoneKey ? phoneKey.slice(-8) : null

      const match = orders.find((o) => {
        if (o.created_at <= row.contacted_at) return false
        if (email && (o.email ?? '').toLowerCase() === email) return true
        if (last8) {
          const op = normPhone(o.phone)
          if (op && op.endsWith(last8)) return true
        }
        return false
      })
      if (!match) continue

      await admin
        .from('mp_rejected_payments')
        .update({
          recovered_at: match.created_at,
          recovered_order_id: String(match.id),
          recovered_amount: match.total_price ? Number(match.total_price) : null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', row.id)
      recovered++
    }
  }

  return { checked: pending.length, recovered }
}

async function cronHandler(request: Request) {
  try {
    assertCronAuth(request, 'AUTOMATION_CRON_SECRET')
  } catch (r) {
    if (r instanceof Response) return r
    throw r
  }

  const admin = supabaseAdmin()
  try {
    const sent = await sendPass(admin)
    const rec = await recoveryPass(admin)
    return NextResponse.json({ ...sent, ...rec })
  } catch (err) {
    log.captureException(err)
    return serverError(err)
  }
}

export const GET = withCronRun('mercadopago-recovery', cronHandler)
