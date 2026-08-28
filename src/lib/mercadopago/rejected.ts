import type { SupabaseClient } from '@supabase/supabase-js'
import { normalizeForDialing, isValidE164 } from '@/lib/whatsapp/phone-utils'
import { samePerson } from './client'
import { traerTodo } from '@/lib/db/paginar'

/**
 * Pagos rechazados de Mercado Pago → recuperación por WhatsApp.
 *
 * La app de contabilidad (repo `contabilidad-shopify`) ya arma la lista:
 * agrupa los intentos por persona y le cruza email/teléfono contra los
 * carritos abandonados de Shopify. Acá la ingerimos, la normalizamos y la
 * dejamos lista para que el cron `mercadopago-recovery` dispare UN mensaje
 * por persona.
 *
 * Este módulo NO envía nada: solo normaliza y persiste. El envío vive en el
 * cron para que la barrera anti doble envío (`dispatched_at`) sea el único
 * lugar que decide a quién se le escribe.
 */

/** status_detail de MP → texto claro (mismo mapa que la hoja de contabilidad). */
export const REJECTION_REASONS: Record<string, string> = {
  cc_rejected_call_for_authorize: 'El banco pide autorización',
  cc_rejected_insufficient_amount: 'Fondos insuficientes',
  cc_rejected_bad_filled_security_code: 'Código de seguridad mal cargado',
  cc_rejected_bad_filled_date: 'Vencimiento mal cargado',
  cc_rejected_bad_filled_other: 'Datos de la tarjeta mal cargados',
  cc_rejected_high_risk: 'Rechazado por prevención de fraude',
  cc_rejected_max_attempts: 'Demasiados intentos',
  cc_rejected_card_disabled: 'Tarjeta inhabilitada',
  cc_rejected_other_reason: 'Rechazo genérico del banco',
  cc_rejected_blacklist: 'Tarjeta en lista negra',
  cc_rejected_invalid_installments: 'Cuotas no permitidas para esa tarjeta',
  cc_rejected_card_type_not_allowed: 'Tipo de tarjeta no aceptado',
  rejected_by_bank: 'Rechazado por el banco',
  rejected_high_risk: 'Rechazado por prevención de fraude',
  rejected_insufficient_data: 'Faltaron datos del pago',
  invalid_account: 'Cuenta inválida para el débito',
  bank_error: 'Error del banco',
}

export type ReasonBucket = 'retry' | 'funds' | 'bank' | 'risk' | 'other'

/**
 * Agrupa el status_detail en cubos accionables. El mensaje es UNO SOLO para
 * todos, pero el cubo decide a quién NO escribirle (`risk`) y queda como
 * dato para segmentar y medir después.
 */
export function reasonBucket(statusDetail: string | null | undefined): ReasonBucket {
  const d = (statusDetail ?? '').trim().toLowerCase()
  if (!d) return 'other'
  if (
    d === 'cc_rejected_high_risk' ||
    d === 'rejected_high_risk' ||
    d === 'cc_rejected_blacklist' ||
    d === 'cc_rejected_max_attempts' ||
    d.includes('fraud')
  ) {
    return 'risk'
  }
  if (d === 'cc_rejected_insufficient_amount') return 'funds'
  if (d.startsWith('cc_rejected_bad_filled') || d === 'cc_rejected_invalid_installments') {
    return 'retry'
  }
  if (
    d === 'cc_rejected_call_for_authorize' ||
    d === 'cc_rejected_card_disabled' ||
    d === 'cc_rejected_other_reason' ||
    d === 'rejected_by_bank' ||
    d === 'bank_error'
  ) {
    return 'bank'
  }
  return 'other'
}

/**
 * Cubos a los que NO se les escribe automáticamente.
 *
 * `risk` es fraude detectado por MP (lista negra, alto riesgo, demasiados
 * intentos). Invitar a reintentar ahí no recupera una venta: invita a un
 * contracargo, que sale más caro que la venta perdida. Quedan en la tabla
 * con `skip_reason='risk'` para que el comerciante los vea si quiere.
 */
const NO_CONTACT_BUCKETS = new Set<ReasonBucket>(['risk'])

export function shouldContact(bucket: ReasonBucket): boolean {
  return !NO_CONTACT_BUCKETS.has(bucket)
}

/** Fila cruda tal como la manda la app de contabilidad. */
export interface RejectedPaymentInput {
  external_key: string
  mp_payment_ids?: string[]
  rejected_at: string
  name?: string | null
  email?: string | null
  phone?: string | null
  amount?: number | string | null
  currency?: string | null
  installments?: number | null
  attempts?: number | null
  status_detail?: string | null
  payment_method?: string | null
  recovery_url?: string | null
}

export interface NormalizedRejectedPayment {
  external_key: string
  mp_payment_ids: string[]
  rejected_at: string
  payer_name: string | null
  email: string | null
  phone: string | null
  amount: number | null
  currency: string
  installments: number | null
  attempts: number
  status_detail: string | null
  reason_bucket: ReasonBucket
  payment_method: string | null
  recovery_url: string | null
}

/**
 * Número, o null. NO adivina formatos de moneda con separador de miles.
 *
 * "$39.990" es 39990 en Argentina y 39.99 en Estados Unidos: no hay forma de
 * resolverlo sin saber la configuración regional de quien lo escribió, y
 * equivocarse mete un factor 1000 en el monto que después va en el mensaje
 * al cliente. El contrato de la API es un número; una cadena solo se acepta
 * si es inequívoca (entera, o con a lo sumo dos decimales).
 */
function toNumber(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  const s = String(v)
    .trim()
    .replace(/[\s$€£]|ARS|USD|COP|MXN/gi, '')
  if (!/^-?\d+(\.\d{1,2})?$/.test(s)) return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

/**
 * Normaliza una fila de la hoja al shape de la tabla.
 *
 * El teléfono es lo delicado: la hoja lo trae como lo escribió el cliente en
 * el checkout — "1144960458", "02227547762" (con 0 de larga distancia),
 * "543489454730" (ya internacional).
 *
 * Se usa `normalizeForDialing` y no `normalizeToWhatsApp` por el 9 argentino:
 * `normalizeToWhatsApp('1144960458','AR')` devuelve "541144960458", que es un
 * E.164 válido y aun así INALCANZABLE por WhatsApp — a un móvil argentino le
 * falta el 9 (`5491144960458`). Como casi todos los teléfonos de esta hoja
 * son móviles argentinos escritos en formato local, con el otro helper la
 * recuperación fallaría en silencio para la mayoría.
 *
 * Si aun así no sale un número válido lo dejamos en NULL: la fila queda como
 * `sin_telefono` en la hoja, que es honesto, en vez de intentar un envío que
 * Meta va a rechazar y que ensucia la salud del número.
 */
export function normalizeRejectedPayment(
  raw: RejectedPaymentInput,
  defaultCountry: string,
): NormalizedRejectedPayment | null {
  const key = String(raw.external_key ?? '').trim()
  if (!key) return null

  const when = new Date(raw.rejected_at)
  if (Number.isNaN(when.getTime())) return null

  let phone: string | null = null
  if (raw.phone) {
    const e164 = normalizeForDialing(String(raw.phone), defaultCountry).replace(/^\+/, '')
    phone = isValidE164(e164) ? e164 : null
  }

  const email = raw.email ? String(raw.email).trim().toLowerCase() : null
  const statusDetail = raw.status_detail ? String(raw.status_detail).trim() : null

  return {
    external_key: key,
    mp_payment_ids: (raw.mp_payment_ids ?? []).map(String).filter(Boolean),
    rejected_at: when.toISOString(),
    payer_name: raw.name ? String(raw.name).trim() : null,
    email: email && email.includes('@') ? email : null,
    phone,
    amount: toNumber(raw.amount),
    currency: (raw.currency || 'ARS').toUpperCase(),
    installments: toNumber(raw.installments),
    attempts: Math.max(1, Math.trunc(toNumber(raw.attempts) ?? 1)),
    status_detail: statusDetail,
    reason_bucket: reasonBucket(statusDetail),
    payment_method: raw.payment_method ? String(raw.payment_method).trim() : null,
    recovery_url: raw.recovery_url ? String(raw.recovery_url).trim() : null,
  }
}

export interface IngestResult {
  received: number
  inserted: number
  updated: number
  invalid: number
}

/**
 * Upsertea la lista completa. Idempotente: la app de contabilidad reenvía la
 * misma lista cada 30 minutos, así que esto corre muchas veces sobre las
 * mismas filas.
 *
 * Regla clave: en una fila YA CONTACTADA solo se refrescan los datos del
 * pago (intentos, motivo, monto). NO se toca `phone` ni `contact_id` ni
 * ningún campo de estado — si un reintento posterior cambiara el teléfono,
 * pisar el original desalinearía el mensaje ya enviado de su destinatario y
 * rompería la atribución.
 */
export async function ingestRejectedPayments(
  admin: SupabaseClient,
  args: {
    workspaceId: string
    defaultCountry: string
    payments: RejectedPaymentInput[]
  },
): Promise<IngestResult> {
  const { workspaceId, defaultCountry, payments } = args
  const result: IngestResult = {
    received: payments.length,
    inserted: 0,
    updated: 0,
    invalid: 0,
  }

  const rows: NormalizedRejectedPayment[] = []
  for (const raw of payments) {
    const norm = normalizeRejectedPayment(raw, defaultCountry)
    if (!norm) {
      result.invalid++
      continue
    }
    rows.push(norm)
  }
  if (rows.length === 0) return result

  // Una sola lectura para saber cuáles ya existen y cuáles ya se enviaron.
  const keys = rows.map((r) => r.external_key)
  const existing = new Map<string, { contacted_at: string | null; skip_reason: string | null }>()
  // Trozos de 200 para no pasarnos del largo de URL de PostgREST con listas
  // largas: la hoja acumula meses de rechazos y `in()` va en la query string.
  for (let i = 0; i < keys.length; i += 200) {
    const { data } = await admin
      .from('mp_rejected_payments')
      .select('external_key, contacted_at, skip_reason')
      .eq('workspace_id', workspaceId)
      .in('external_key', keys.slice(i, i + 200))
    for (const row of (data ?? []) as {
      external_key: string
      contacted_at: string | null
      skip_reason: string | null
    }[]) {
      existing.set(row.external_key, {
        contacted_at: row.contacted_at,
        skip_reason: row.skip_reason,
      })
    }
  }

  const now = new Date().toISOString()
  const toInsert: Record<string, unknown>[] = []

  for (const r of rows) {
    const prev = existing.get(r.external_key)
    if (!prev) {
      toInsert.push({ workspace_id: workspaceId, ...r, created_at: now, updated_at: now })
      result.inserted++
      continue
    }
    // Ya existe: refrescamos los datos del pago. Si ya se contactó, NO
    // tocamos identidad (teléfono/email/nombre) por lo dicho arriba.
    const patch: Record<string, unknown> = {
      mp_payment_ids: r.mp_payment_ids,
      rejected_at: r.rejected_at,
      amount: r.amount,
      currency: r.currency,
      installments: r.installments,
      attempts: r.attempts,
      status_detail: r.status_detail,
      reason_bucket: r.reason_bucket,
      payment_method: r.payment_method,
      updated_at: now,
    }
    if (!prev.contacted_at) {
      patch.payer_name = r.payer_name
      patch.email = r.email
      patch.phone = r.phone
      patch.recovery_url = r.recovery_url
      // El cruce de contacto mejora con el tiempo (aparece el carrito
      // abandonado que le faltaba). Si la fila estaba marcada "sin
      // teléfono" y ahora sí lo tiene, vuelve a la cola.
      //
      // Sólo se limpia desde `no_phone`. Los demás motivos son decisiones
      // tomadas —riesgo de fraude, demasiado vieja, o `backlog`, que es el
      // historial anterior a encender la automatización— y conseguir un
      // teléfono no las revierte. Sin esta condición, la próxima corrida
      // resucitaría a toda la gente que se decidió no contactar.
      if (r.phone && (prev.skip_reason === null || prev.skip_reason === 'no_phone')) {
        patch.skip_reason = null
      }
    }
    await admin
      .from('mp_rejected_payments')
      .update(patch)
      .eq('workspace_id', workspaceId)
      .eq('external_key', r.external_key)
    result.updated++
  }

  // Insert en lote con onConflict: si dos corridas se pisan, la segunda no
  // explota por clave duplicada.
  for (let i = 0; i < toInsert.length; i += 200) {
    const { error } = await admin
      .from('mp_rejected_payments')
      .upsert(toInsert.slice(i, i + 200), {
        onConflict: 'workspace_id,external_key',
        ignoreDuplicates: true,
      })
    if (error) throw new Error(`ingest mp_rejected_payments: ${error.message}`)
  }

  // Segunda pasada: buscarle el teléfono a quien entró sin él. Va acá y no
  // en el cron de envío para que la hoja y el panel muestren el número
  // apenas se consigue, aunque a esa persona todavía no le toque mensaje.
  try {
    await enrichMissingPhones(admin, workspaceId, defaultCountry)
  } catch {
    // Es una mejora, no un requisito: si falla, las filas quedan sin
    // teléfono y la ingesta igual se da por buena.
  }

  return result
}

/**
 * Segunda pasada para conseguir el teléfono de quien llegó sin él.
 *
 * Mercado Pago enmascara el pagador en los rechazos, así que muchas filas
 * entran sin número y ésas son plata que no se puede recuperar: sin
 * WhatsApp no hay mensaje. Acá se busca a la persona en los datos que el
 * propio Riverz ya tiene, en orden de qué tan confiable es la señal:
 *
 *   1. Correo exacto contra los contactos. Es identidad, no parecido.
 *   2. Correo exacto contra los carritos abandonados de la tienda.
 *   3. Monto + nombre contra los carritos: el rechazo y el carrito son el
 *      mismo intento de compra visto desde los dos lados.
 *   4. Nombre contra los contactos, y SÓLO si hay un único candidato.
 *
 * El paso 4 es el más flojo a propósito: con dos candidatos se descarta en
 * vez de elegir. Un empate mal resuelto no ensucia una fila, le manda un
 * WhatsApp sobre un pago rechazado a alguien que nunca intentó comprar.
 */
export async function enrichMissingPhones(
  admin: SupabaseClient,
  workspaceId: string,
  defaultCountry: string,
): Promise<{ resolved: number; stillMissing: number }> {
  const { data: pending } = await admin
    .from('mp_rejected_payments')
    .select('id, external_key, payer_name, email, amount')
    .eq('workspace_id', workspaceId)
    .is('phone', null)
    .is('contacted_at', null)
    .limit(500)

  const rows = (pending ?? []) as {
    id: string
    external_key: string
    payer_name: string | null
    email: string | null
    amount: number | null
  }[]
  if (rows.length === 0) return { resolved: 0, stillMissing: 0 }

  const contactRows = await traerTodo<{
    name: string | null
    email: string | null
    phone: string | null
  }>((d, h) =>
    admin
      .from('contacts')
      .select('name, email, phone')
      .eq('workspace_id', workspaceId)
      .not('phone', 'is', null)
      .order('id', { ascending: true })
      .range(d, h),
  )
  const contacts = (contactRows ?? []) as {
    name: string | null
    email: string | null
    phone: string | null
  }[]

  const { data: checkoutRows } = await admin
    .from('shopify_checkouts')
    .select('customer_email, customer_phone, customer_name, total_price')
    .eq('workspace_id', workspaceId)
    .not('customer_phone', 'is', null)
    .order('created_at', { ascending: false })
    .limit(3000)
  const checkouts = (checkoutRows ?? []) as {
    customer_email: string | null
    customer_phone: string | null
    customer_name: string | null
    total_price: number | null
  }[]

  const contactByEmail = new Map<string, string>()
  for (const c of contacts) {
    if (c.email && c.phone) contactByEmail.set(c.email.toLowerCase(), c.phone)
  }
  const checkoutByEmail = new Map<string, string>()
  const checkoutByAmount = new Map<number, typeof checkouts>()
  for (const c of checkouts) {
    if (c.customer_email && c.customer_phone) {
      checkoutByEmail.set(c.customer_email.toLowerCase(), c.customer_phone)
    }
    const amt = Math.round(Number(c.total_price ?? 0))
    const list = checkoutByAmount.get(amt) ?? []
    list.push(c)
    checkoutByAmount.set(amt, list)
  }

  let resolved = 0
  for (const r of rows) {
    const email = r.email?.toLowerCase() ?? null
    let raw: string | null = null

    if (email) raw = contactByEmail.get(email) ?? checkoutByEmail.get(email) ?? null

    if (!raw && r.amount !== null) {
      const candidates = (checkoutByAmount.get(Math.round(Number(r.amount))) ?? []).filter(
        (c) => samePerson(c.customer_name, r.payer_name),
      )
      if (candidates.length === 1) raw = candidates[0].customer_phone
    }

    if (!raw && r.payer_name) {
      const hits = contacts.filter((c) => samePerson(c.name, r.payer_name))
      const phones = new Set(hits.map((h) => h.phone).filter(Boolean) as string[])
      if (phones.size === 1) raw = [...phones][0]
    }

    if (!raw) continue
    const e164 = normalizeForDialing(raw, defaultCountry).replace(/^\+/, '')
    if (!isValidE164(e164)) continue

    // El filtro va en el WHERE y no en el SET: sólo se reabre lo que estaba
    // frenado por falta de número. Un `risk` o un `backlog` son decisiones
    // tomadas, no datos faltantes, y encontrarle el teléfono no las
    // revierte — esas filas ni se tocan.
    const { data: touched } = await admin
      .from('mp_rejected_payments')
      .update({ phone: e164, skip_reason: null, updated_at: new Date().toISOString() })
      .eq('id', r.id)
      .or('skip_reason.is.null,skip_reason.eq.no_phone')
      .select('id')
    if (touched && touched.length > 0) resolved++
  }

  return { resolved, stillMissing: rows.length - resolved }
}

/** Estado que la hoja de contabilidad pinta en sus columnas nuevas. */
export type RejectedStatus =
  | 'pendiente'
  | 'contactado'
  | 'recuperado'
  | 'sin_telefono'
  | 'omitido'
  | 'error'

export function statusOf(row: {
  phone: string | null
  contacted_at: string | null
  recovered_at: string | null
  skip_reason: string | null
  last_error: string | null
}): RejectedStatus {
  if (row.recovered_at) return 'recuperado'
  if (row.contacted_at) return 'contactado'
  if (row.skip_reason === 'no_phone' || !row.phone) return 'sin_telefono'
  if (row.skip_reason) return 'omitido'
  if (row.last_error) return 'error'
  return 'pendiente'
}
