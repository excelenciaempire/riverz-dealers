/**
 * Cliente de la API de pagos de Mercado Pago.
 *
 * Lo que Shopify NO da: los pagos RECHAZADOS. Un rechazo no genera pedido,
 * así que ningún webhook de comercio lo ve. Esta es la única forma de
 * enterarse de que alguien intentó comprar y no pudo.
 *
 * Auth: Access Token de producción (`APP_USR-…`) de la cuenta del
 * comerciante, que él mismo pega en Integraciones.
 */

const API = 'https://api.mercadopago.com'

export interface MpPayment {
  id: number | string
  status: string
  status_detail?: string | null
  date_created?: string
  date_approved?: string | null
  transaction_amount?: number
  currency_id?: string
  installments?: number
  payment_method_id?: string | null
  payment_type_id?: string | null
  external_reference?: string | null
  payer?: { email?: string | null; first_name?: string | null; last_name?: string | null }
  additional_info?: {
    payer?: { first_name?: string | null; last_name?: string | null; phone?: { number?: string | null } | null }
  }
}

export class MercadoPagoError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
    this.name = 'MercadoPagoError'
  }
}

/**
 * Trae los pagos creados entre dos fechas. Pagina hasta agotar.
 *
 * `limit` de MP es 100 por página; el tope de páginas evita que un token
 * de una cuenta enorme haga girar el cron para siempre — con la ventana
 * de días que usa el sync, 20 páginas (2000 pagos) es de sobra.
 */
export async function fetchPayments(
  token: string,
  sinceIso: string,
  untilIso: string,
  maxPages = 20,
): Promise<MpPayment[]> {
  const out: MpPayment[] = []
  let offset = 0

  for (let page = 0; page < maxPages; page++) {
    const qs = new URLSearchParams({
      sort: 'date_created',
      criteria: 'desc',
      range: 'date_created',
      begin_date: sinceIso,
      end_date: untilIso,
      limit: '100',
      offset: String(offset),
    })
    const res = await fetch(`${API}/v1/payments/search?${qs}`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new MercadoPagoError(
        `payments/search ${res.status}: ${body.slice(0, 200)}`,
        res.status,
      )
    }
    const data = (await res.json()) as {
      results?: MpPayment[]
      paging?: { total?: number }
    }
    const results = data.results ?? []
    out.push(...results)
    offset += results.length
    if (results.length === 0 || offset >= (data.paging?.total ?? 0)) break
  }

  return out
}

/**
 * Valida un token contra la API. Se usa al conectar para no guardar una
 * credencial rota que después falle en silencio dentro del cron.
 *
 * Pide una ventana mínima de pagos en vez de `/users/me`: es el mismo
 * permiso que el sync necesita de verdad, así que un token con scope
 * insuficiente se detecta al conectar y no tres horas después.
 */
export async function verifyToken(token: string): Promise<boolean> {
  const until = new Date()
  const since = new Date(until.getTime() - 86_400_000)
  const qs = new URLSearchParams({
    sort: 'date_created',
    criteria: 'desc',
    range: 'date_created',
    begin_date: since.toISOString(),
    end_date: until.toISOString(),
    limit: '1',
  })
  const res = await fetch(`${API}/v1/payments/search?${qs}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
  })
  return res.ok
}

/** Nombre real del pagador. En los rechazados `payer` viene enmascarado. */
export function payerName(p: MpPayment): string {
  const ai = p.additional_info?.payer
  const full = [ai?.first_name, ai?.last_name].filter(Boolean).join(' ').trim()
  if (full) return full
  const basic = [p.payer?.first_name, p.payer?.last_name].filter(Boolean).join(' ').trim()
  return basic || ''
}

export function payerPhone(p: MpPayment): string | null {
  const n = p.additional_info?.payer?.phone?.number
  return n ? String(n) : null
}

/** Tokens de un nombre, sin acentos ni mayúsculas, para casar identidades. */
export function nameTokens(s: string | null | undefined): Set<string> {
  const clean = (s ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
  return new Set(clean.match(/[a-z]+/g) ?? [])
}

/**
 * ¿Son la misma persona? Un nombre contenido en el otro (variantes con y
 * sin segundo nombre) o al menos 3 tokens en común.
 *
 * El umbral de 3 es deliberado: con 2 alcanzaría para que "María Cecilia
 * López" y "María Cecilia Fernández" se crucen, y ahí el error no es una
 * fila mal pintada sino un WhatsApp al cliente equivocado.
 */
export function samePerson(a: string | null | undefined, b: string | null | undefined): boolean {
  const ta = nameTokens(a)
  const tb = nameTokens(b)
  if (ta.size === 0 || tb.size === 0) return false
  const shared = [...ta].filter((t) => tb.has(t))
  if (shared.length >= 3) return true
  const aInB = [...ta].every((t) => tb.has(t))
  const bInA = [...tb].every((t) => ta.has(t))
  return aInB || bInA
}
