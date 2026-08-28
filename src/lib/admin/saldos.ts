/**
 * El saldo de cada proveedor que hay que recargar.
 *
 * Riverz corre con las llaves de Riverz: la IA la paga Anthropic, las llamadas
 * Telnyx, la voz Fish Audio, la transcripción Deepgram. Cuando uno de esos se
 * queda sin saldo, la plataforma no devuelve un error claro — devuelve
 * silencio: el agente deja de contestar, la llamada no sale, la voz no suena.
 * Ya pasó, más de una vez, y cada vez se descubrió por un cliente que no
 * recibió respuesta.
 *
 * Esta pantalla existe para que se descubra antes.
 *
 * Tres reglas:
 *
 * 1. **Nadie puede tumbar la pantalla.** Cada proveedor se consulta aparte, con
 *    su propio corte de tiempo, y un fallo se muestra como fallo de ESE
 *    proveedor. Un timeout de Telnyx no puede esconder el saldo de Anthropic.
 * 2. **No saber no es estar bien.** El que no tiene forma de consultar saldo
 *    dice `desconocido` y no `ok`. Un tablero que pinta verde lo que no midió
 *    es peor que no tener tablero.
 * 3. **Las llaves nunca salen de acá.** Se usan para preguntar; lo que vuelve
 *    al navegador es un número y un estado.
 */

export type EstadoSaldo = 'ok' | 'bajo' | 'sin_saldo' | 'desconocido' | 'sin_llave' | 'error'

export interface SaldoProveedor {
  /** Identificador estable, para el orden y las claves de React. */
  id: string
  nombre: string
  /** Para qué se usa: lo que se rompe si esto se queda sin saldo. */
  paraQue: string
  estado: EstadoSaldo
  /** El número, cuando el proveedor lo da. */
  saldo: number | null
  unidad: string | null
  /** Texto corto: el error, o el detalle que el número no dice. */
  detalle: string | null
  /** Dónde se recarga. */
  url: string
}

/** Corte por proveedor. Ninguno vale la espera de una pantalla trabada. */
const TIMEOUT_MS = 6000

async function pedir(
  url: string,
  init: RequestInit = {},
): Promise<{ ok: boolean; status: number; json: unknown; texto: string }> {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal, cache: 'no-store' })
    const texto = await res.text()
    let json: unknown = null
    try {
      json = JSON.parse(texto)
    } catch {
      json = null
    }
    return { ok: res.ok, status: res.status, json, texto }
  } finally {
    clearTimeout(t)
  }
}

const sinLlave = (
  id: string,
  nombre: string,
  paraQue: string,
  url: string,
  llave: string,
): SaldoProveedor => ({
  id,
  nombre,
  paraQue,
  estado: 'sin_llave',
  saldo: null,
  unidad: null,
  detalle: `Falta ${llave}`,
  url,
})

function porUmbral(saldo: number, bajo: number): EstadoSaldo {
  if (saldo <= 0) return 'sin_saldo'
  return saldo < bajo ? 'bajo' : 'ok'
}

/**
 * Anthropic no publica el saldo.
 *
 * Lo que sí se puede es preguntarle si cobraría: una llamada de un token. Si la
 * cuenta está sin crédito responde 400 con `credit balance is too low`, que es
 * exactamente el estado que hay que ver acá. Cuesta una fracción de centavo y
 * es la única señal fiable — el resto sería adivinar.
 */
async function anthropic(): Promise<SaldoProveedor> {
  const base: Omit<SaldoProveedor, 'estado' | 'saldo' | 'unidad' | 'detalle'> = {
    id: 'anthropic',
    nombre: 'Anthropic',
    paraQue: 'Las respuestas de la IA y el Operador',
    url: 'https://console.anthropic.com/settings/billing',
  }
  const key = process.env.ANTHROPIC_API_KEY
  if (!key) return sinLlave(base.id, base.nombre, base.paraQue, base.url, 'ANTHROPIC_API_KEY')

  try {
    const r = await pedir('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5',
        max_tokens: 1,
        messages: [{ role: 'user', content: 'hi' }],
      }),
    })
    if (r.ok) {
      return { ...base, estado: 'ok', saldo: null, unidad: null, detalle: 'Responde y cobra' }
    }
    const mensaje =
      (r.json as { error?: { message?: string } } | null)?.error?.message ?? r.texto.slice(0, 160)
    const sinCredito = /credit balance|insufficient|billing/i.test(mensaje)
    return {
      ...base,
      estado: sinCredito ? 'sin_saldo' : 'error',
      saldo: null,
      unidad: null,
      detalle: mensaje.slice(0, 160),
    }
  } catch (e) {
    return {
      ...base,
      estado: 'error',
      saldo: null,
      unidad: null,
      detalle: e instanceof Error ? e.message : 'no respondió',
    }
  }
}

/** Telnyx sí publica el saldo, y es el que paga cada minuto de llamada. */
async function telnyx(): Promise<SaldoProveedor> {
  const base = {
    id: 'telnyx',
    nombre: 'Telnyx',
    paraQue: 'Los números y los minutos de llamada',
    url: 'https://portal.telnyx.com/#/app/billing/payments',
  }
  const key = process.env.TELNYX_API_KEY
  if (!key) return sinLlave(base.id, base.nombre, base.paraQue, base.url, 'TELNYX_API_KEY')

  try {
    const r = await pedir('https://api.telnyx.com/v2/balance', {
      headers: { authorization: `Bearer ${key}` },
    })
    const d = (r.json as { data?: { balance?: string; currency?: string } } | null)?.data
    if (!r.ok || !d) {
      return { ...base, estado: 'error', saldo: null, unidad: null, detalle: `HTTP ${r.status}` }
    }
    const saldo = Number(d.balance ?? 0)
    return {
      ...base,
      estado: porUmbral(saldo, 10),
      saldo,
      unidad: (d.currency ?? 'USD').toUpperCase(),
      detalle: null,
    }
  } catch (e) {
    return {
      ...base,
      estado: 'error',
      saldo: null,
      unidad: null,
      detalle: e instanceof Error ? e.message : 'no respondió',
    }
  }
}

/** Fish Audio: la voz de las llamadas. */
async function fishAudio(): Promise<SaldoProveedor> {
  const base = {
    id: 'fish',
    nombre: 'Fish Audio',
    paraQue: 'La voz con la que habla el agente',
    url: 'https://fish.audio/go-api/billing/',
  }
  const key = process.env.FISH_API_KEY
  if (!key) return sinLlave(base.id, base.nombre, base.paraQue, base.url, 'FISH_API_KEY')

  try {
    const r = await pedir('https://api.fish.audio/wallet/self/api-credit', {
      headers: { authorization: `Bearer ${key}` },
    })
    const credito = (r.json as { credit?: number | string } | null)?.credit
    if (!r.ok || credito === undefined || credito === null) {
      return { ...base, estado: 'error', saldo: null, unidad: null, detalle: `HTTP ${r.status}` }
    }
    const saldo = Number(credito)
    return { ...base, estado: porUmbral(saldo, 5), saldo, unidad: 'USD', detalle: null }
  } catch (e) {
    return {
      ...base,
      estado: 'error',
      saldo: null,
      unidad: null,
      detalle: e instanceof Error ? e.message : 'no respondió',
    }
  }
}

/** Deepgram: lo que transcribe lo que dice el cliente en una llamada. */
async function deepgram(): Promise<SaldoProveedor> {
  const base = {
    id: 'deepgram',
    nombre: 'Deepgram',
    paraQue: 'Entender lo que dice el cliente en una llamada',
    url: 'https://console.deepgram.com/',
  }
  const key = process.env.DEEPGRAM_API_KEY
  if (!key) return sinLlave(base.id, base.nombre, base.paraQue, base.url, 'DEEPGRAM_API_KEY')

  try {
    const cabeceras = { authorization: `Token ${key}` }
    const p = await pedir('https://api.deepgram.com/v1/projects', { headers: cabeceras })
    const proyecto = (p.json as { projects?: { project_id: string }[] } | null)?.projects?.[0]
    if (!p.ok || !proyecto) {
      return { ...base, estado: 'error', saldo: null, unidad: null, detalle: `HTTP ${p.status}` }
    }
    const b = await pedir(
      `https://api.deepgram.com/v1/projects/${proyecto.project_id}/balances`,
      { headers: cabeceras },
    )
    const saldos = (b.json as { balances?: { amount?: number; units?: string }[] } | null)?.balances
    const primero = saldos?.[0]
    if (!b.ok || !primero) {
      return {
        ...base,
        estado: 'desconocido',
        saldo: null,
        unidad: null,
        detalle: 'La cuenta no expone saldo (plan por factura)',
      }
    }
    const saldo = Number(primero.amount ?? 0)
    return {
      ...base,
      estado: porUmbral(saldo, 10),
      saldo,
      unidad: (primero.units ?? 'usd').toUpperCase(),
      detalle: null,
    }
  } catch (e) {
    return {
      ...base,
      estado: 'error',
      saldo: null,
      unidad: null,
      detalle: e instanceof Error ? e.message : 'no respondió',
    }
  }
}

/** ElevenLabs cobra por caracteres, no por dólares: lo que queda del mes. */
async function elevenlabs(): Promise<SaldoProveedor> {
  const base = {
    id: 'elevenlabs',
    nombre: 'ElevenLabs',
    paraQue: 'Voz (alternativa a Fish Audio)',
    url: 'https://elevenlabs.io/app/subscription',
  }
  const key = process.env.ELEVENLABS_API_KEY
  if (!key) return sinLlave(base.id, base.nombre, base.paraQue, base.url, 'ELEVENLABS_API_KEY')

  try {
    const r = await pedir('https://api.elevenlabs.io/v1/user/subscription', {
      headers: { 'xi-api-key': key },
    })
    const d = r.json as { character_count?: number; character_limit?: number } | null
    if (!r.ok || !d || d.character_limit === undefined) {
      return { ...base, estado: 'error', saldo: null, unidad: null, detalle: `HTTP ${r.status}` }
    }
    const quedan = (d.character_limit ?? 0) - (d.character_count ?? 0)
    return {
      ...base,
      estado: porUmbral(quedan, Math.max(1000, (d.character_limit ?? 0) * 0.1)),
      saldo: quedan,
      unidad: 'caracteres',
      detalle: `de ${(d.character_limit ?? 0).toLocaleString()} del mes`,
    }
  } catch (e) {
    return {
      ...base,
      estado: 'error',
      saldo: null,
      unidad: null,
      detalle: e instanceof Error ? e.message : 'no respondió',
    }
  }
}

/**
 * Stripe no es un proveedor que se recargue: es el que trae la plata.
 *
 * Va en la misma pantalla igual porque la pregunta que trae a alguien acá —«¿me
 * alcanza para que esto siga andando?»— se contesta mirando las dos mitades.
 */
async function stripeSaldo(): Promise<SaldoProveedor> {
  const base = {
    id: 'stripe',
    nombre: 'Stripe',
    paraQue: 'Lo que entra: suscripciones y recargas',
    url: 'https://dashboard.stripe.com/balance/overview',
  }
  const key = process.env.STRIPE_SECRET_KEY
  if (!key) return sinLlave(base.id, base.nombre, base.paraQue, base.url, 'STRIPE_SECRET_KEY')

  try {
    const r = await pedir('https://api.stripe.com/v1/balance', {
      headers: { authorization: `Bearer ${key}` },
    })
    const d = r.json as {
      available?: { amount: number; currency: string }[]
      pending?: { amount: number }[]
    } | null
    const disponible = d?.available?.[0]
    if (!r.ok || !disponible) {
      return { ...base, estado: 'error', saldo: null, unidad: null, detalle: `HTTP ${r.status}` }
    }
    const pendiente = (d?.pending ?? []).reduce((n, p) => n + (p.amount ?? 0), 0)
    return {
      ...base,
      // Cero acá no es una alarma: significa que ya se transfirió.
      estado: 'ok',
      saldo: disponible.amount / 100,
      unidad: (disponible.currency ?? 'usd').toUpperCase(),
      detalle: pendiente > 0 ? `+${(pendiente / 100).toFixed(2)} en camino` : null,
    }
  } catch (e) {
    return {
      ...base,
      estado: 'error',
      saldo: null,
      unidad: null,
      detalle: e instanceof Error ? e.message : 'no respondió',
    }
  }
}

/**
 * Los que no publican saldo por API.
 *
 * Se listan igual, con el enlace a su tablero. Esconderlos daría a entender que
 * no hay que mirarlos, y son justo los que se caen en silencio.
 */
function sinApi(): SaldoProveedor[] {
  const item = (
    id: string,
    nombre: string,
    paraQue: string,
    url: string,
    llave: string,
  ): SaldoProveedor => ({
    id,
    nombre,
    paraQue,
    estado: process.env[llave] ? 'desconocido' : 'sin_llave',
    saldo: null,
    unidad: null,
    detalle: process.env[llave]
      ? 'No publica saldo por API — hay que mirarlo en su tablero'
      : `Falta ${llave}`,
    url,
  })
  return [
    item(
      'cerebras',
      'Cerebras',
      'El modelo que piensa durante una llamada',
      'https://cloud.cerebras.ai/',
      'CEREBRAS_API_KEY',
    ),
    item(
      'gemini',
      'Google Gemini',
      'Voz en tiempo real y visión',
      'https://aistudio.google.com/app/billing',
      'GEMINI_API_KEY',
    ),
    item(
      'render',
      'Render',
      'Donde corre todo: servidor y minutos de build',
      'https://dashboard.render.com/billing',
      'RENDER_API_KEY',
    ),
  ]
}

/** Todos, en paralelo. Ninguno puede tumbar al resto. */
export async function leerSaldosDeProveedores(): Promise<SaldoProveedor[]> {
  const resultados = await Promise.allSettled([
    anthropic(),
    telnyx(),
    fishAudio(),
    deepgram(),
    elevenlabs(),
    stripeSaldo(),
  ])
  const vivos = resultados
    .filter((r): r is PromiseFulfilledResult<SaldoProveedor> => r.status === 'fulfilled')
    .map((r) => r.value)
  return [...vivos, ...sinApi()]
}

/** El titular: cuántos necesitan plata ahora. */
export function cuantosEnRojo(saldos: SaldoProveedor[]): number {
  return saldos.filter((s) => s.estado === 'sin_saldo' || s.estado === 'bajo').length
}
