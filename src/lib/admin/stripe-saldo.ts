/**
 * El saldo de Stripe, leído una sola vez para todo el panel.
 *
 * Lo leían dos pantallas con dos cálculos distintos: la fila de Proveedores
 * tomaba `available[0]` —**sólo el primer bucket de moneda**— y la Caja sumaba
 * todos. Con una cuenta multi-moneda las dos mostraban números distintos para
 * la misma pregunta, y ninguna de las dos decía que estaba mirando una parte.
 *
 * Acá se suma todo y se nombra lo que no entra en el total. La regla es la
 * misma que gobierna el resto de esta capa: **no saber no es estar bien**, y un
 * total que se come una moneda sin decirlo es peor que un total incompleto que
 * lo dice.
 *
 * Ninguna de las tres llamadas se cobra.
 */

const TIMEOUT_MS = 8000

export interface PayoutEnCamino {
  usd: number
  /** Cuándo lo deposita Stripe. Null si no lo dice. */
  llegaAt: string | null
  /** `in_transit` o `pending`. */
  estado: string
}

export interface SaldoDeStripe {
  /** Liquidado: se puede transferir hoy. */
  disponibleUsd: number | null
  /** Cobrado y todavía reteniendo (los T+2). */
  pendienteUsd: number | null
  /**
   * Lo que aceptaría una transferencia instantánea.
   *
   * Null = la cuenta no es elegible todavía, que es distinto de no tener plata.
   */
  instantaneoUsd: number | null
  enCamino: PayoutEnCamino[]
  /** `daily` / `weekly` / `manual`, y cuántos días hábiles retiene. */
  agenda: { intervalo: string; demoraDias: number | null } | null
  /**
   * Las monedas que quedaron fuera del total en dólares.
   *
   * Una cuenta que cobra en euros tiene su propio bucket, y sumarlo como si
   * fueran dólares inventa plata. Se nombra en vez de sumarse.
   */
  otrasMonedas: string[]
  /** Clave i18n del problema, si lo hubo. */
  errorKey: string | null
  /** El dato crudo: un HTTP, el nombre de la variable que falta. */
  error: string | null
}

const VACIO: SaldoDeStripe = {
  disponibleUsd: null,
  pendienteUsd: null,
  instantaneoUsd: null,
  enCamino: [],
  agenda: null,
  otrasMonedas: [],
  errorKey: null,
  error: null,
}

async function pedir(path: string, key: string): Promise<Response> {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  try {
    return await fetch(`https://api.stripe.com/v1/${path}`, {
      headers: { authorization: `Bearer ${key}` },
      signal: ctrl.signal,
      cache: 'no-store',
    })
  } finally {
    clearTimeout(t)
  }
}

type Bucket = { amount?: number; currency?: string }

/** Sólo los dólares. Lo demás se nombra aparte. */
const enUsd = (xs: Bucket[] | undefined): number =>
  (xs ?? [])
    .filter((x) => (x.currency ?? 'usd').toLowerCase() === 'usd')
    .reduce((n, x) => n + Number(x.amount ?? 0), 0) / 100

const monedasAjenas = (...listas: (Bucket[] | undefined)[]): string[] => {
  const set = new Set<string>()
  for (const xs of listas) {
    for (const x of xs ?? []) {
      const c = (x.currency ?? 'usd').toLowerCase()
      if (c !== 'usd' && Number(x.amount ?? 0) !== 0) set.add(c.toUpperCase())
    }
  }
  return [...set]
}

export async function leerSaldoDeStripe(): Promise<SaldoDeStripe> {
  const key = process.env.STRIPE_SECRET_KEY
  if (!key) {
    return { ...VACIO, errorKey: 'admin.fixedMissingEnv', error: 'STRIPE_SECRET_KEY' }
  }

  try {
    const r = await pedir('balance', key)
    const d = (await r.json()) as {
      available?: Bucket[]
      pending?: Bucket[]
      instant_available?: Bucket[]
    } | null
    if (!r.ok || !d?.available) {
      return { ...VACIO, errorKey: 'admin.svcHttpError', error: `HTTP ${r.status}` }
    }

    const base: SaldoDeStripe = {
      ...VACIO,
      disponibleUsd: enUsd(d.available),
      pendienteUsd: enUsd(d.pending),
      instantaneoUsd: d.instant_available ? enUsd(d.instant_available) : null,
      otrasMonedas: monedasAjenas(d.available, d.pending),
    }

    // Un fallo en los payouts o en la agenda no puede tumbar el saldo: son
    // detalles de una respuesta que ya sirve sin ellos.
    const [camino, agenda] = await Promise.allSettled([enCamino(key), agendaDePagos(key)])

    return {
      ...base,
      enCamino: camino.status === 'fulfilled' ? camino.value : [],
      agenda: agenda.status === 'fulfilled' ? agenda.value : null,
    }
  } catch {
    return { ...VACIO, errorKey: 'admin.svcNoAnswer', error: null }
  }
}

/** Las transferencias que ya salieron y todavía no están en el banco. */
async function enCamino(key: string): Promise<PayoutEnCamino[]> {
  const r = await pedir('payouts?limit=10', key)
  if (!r.ok) return []
  const j = (await r.json()) as {
    data?: { amount?: number; status?: string; arrival_date?: number }[]
  }
  return (j.data ?? [])
    .filter((p) => p.status === 'in_transit' || p.status === 'pending')
    .map((p) => ({
      usd: Number(p.amount ?? 0) / 100,
      // Stripe da la fecha en segundos; el resto del panel habla ISO.
      llegaAt: p.arrival_date ? new Date(p.arrival_date * 1000).toISOString() : null,
      estado: p.status ?? 'pending',
    }))
}

/** Cada cuánto paga la cuenta y cuántos días hábiles retiene. */
async function agendaDePagos(
  key: string,
): Promise<{ intervalo: string; demoraDias: number | null } | null> {
  const r = await pedir('account', key)
  if (!r.ok) return null
  const j = (await r.json()) as {
    settings?: { payouts?: { schedule?: { interval?: string; delay_days?: number } } }
  }
  const s = j.settings?.payouts?.schedule
  if (!s?.interval) return null
  return { intervalo: s.interval, demoraDias: s.delay_days ?? null }
}
