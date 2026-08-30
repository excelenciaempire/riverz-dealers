/**
 * Todo lo que hay que pagar para que Riverz siga prendido, en un solo lugar.
 *
 * Antes eran dos: `/admin/saldos` («cuánto le queda a cada proveedor») y
 * `/admin/infra` («saldo y estado en vivo de cada API conectada»). Sondeaban
 * los MISMOS cinco proveedores —Anthropic, Telnyx, Deepgram, Fish, ElevenLabs—
 * con dos capas de código distintas, así que podían mostrar números distintos
 * el mismo día, y cada pantalla abierta disparaba su propia ronda de sondas
 * facturables. Ahora la ronda es una.
 *
 * Tres reglas, heredadas de la capa de saldos porque son las que importan:
 *
 * 1. **Nadie puede tumbar la pantalla.** Cada proveedor se consulta aparte, con
 *    su propio corte de tiempo, y un fallo se muestra como fallo de ESE
 *    proveedor. Un timeout de Telnyx no puede esconder el saldo de Anthropic.
 * 2. **No saber no es estar bien.** El que no tiene forma de consultar saldo
 *    dice `desconocido`, no `ok`. Un tablero que pinta verde lo que no midió es
 *    peor que no tener tablero.
 * 3. **Las llaves nunca salen de acá.** Se usan para preguntar; lo que vuelve al
 *    navegador es un número y un estado.
 *
 * Y una cuarta, de la capa de infraestructura: **el texto viaja como clave**.
 * Esta pantalla se ve en español y en inglés, así que un literal acá sería un
 * literal en el idioma equivocado allá.
 */

import { leerCostosFijos, type Fijos } from './costos-fijos'
import { leerCostoIa, proveedorDeModelo } from './costo-ia'
import { supabaseAdmin } from '@/lib/channels/admin-client'

export type EstadoProveedor =
  | 'ok'
  | 'bajo'
  | 'sin_saldo'
  | 'desconocido'
  | 'sin_llave'
  | 'error'

export type CategoriaProveedor = 'llm' | 'voz' | 'mensajeria' | 'infra' | 'ingresos'

export interface Proveedor {
  /** Identificador estable, para el orden y las claves de React. */
  id: string
  /** Nombre comercial. No se traduce: es un nombre propio. */
  nombre: string
  categoria: CategoriaProveedor
  /**
   * Se le carga plata (va en «¿me alcanza para hoy?») o sólo se mira si está en
   * pie (va en «¿está todo funcionando?»).
   */
  recargable: boolean
  estado: EstadoProveedor
  /** El número, cuando el proveedor lo publica. */
  saldo: number | null
  /** 'USD', 'chars', o lo que devuelva el proveedor. */
  unidad: string | null
  /** Clave i18n: para qué sirve, o qué pasó. */
  detalleKey: string | null
  /** Dato crudo que no se traduce: un HTTP, un monto en camino. */
  detalle: string | null
  /** Su tablero: dónde se recarga o se mira. */
  url: string | null
  /**
   * Lo que Riverz le consumió este mes, cuando se puede saber.
   *
   * Los modelos de lenguaje no publican saldo por API — ninguno de los cinco.
   * Pero el gasto sí se conoce, porque lo generamos nosotros. Un guion en la
   * columna del saldo no dice nada; «US$ 34 este mes» dice exactamente cuánto
   * se está quemando y a qué ritmo.
   *
   * Sale del desglose por modelo de la migración 230, así que cada fila muestra
   * lo suyo: antes la de Anthropic sumaba TODOS los modelos y una caída al
   * respaldo de Groq aparecía como gasto de Anthropic.
   *
   * Sólo la parte que paga la plataforma: lo que un comercio gasta con SU
   * propia llave no toca nuestro saldo.
   */
  consumo?: { usdMes: number } | null
}

export interface EstadoDeProveedores {
  proveedores: Proveedor[]
  fijos: Fijos
  /** Cuántos necesitan plata ahora. Es el titular de la pantalla. */
  enRojo: number
  consultadoAt: string
}

/** Corte por proveedor. Ninguno vale la espera de una pantalla trabada. */
const TIMEOUT_MS = 8000

/**
 * Un User-Agent de navegador, o Cloudflare contesta 403.
 *
 * Groq, Cerebras y Resend están detrás de Cloudflare, que rechaza el
 * User-Agent por defecto de `fetch` con **HTTP 403 y el cuerpo
 * `error code: 1010`**. Eso no se parece en nada a un problema de saldo, así
 * que el panel los pintaba «No respondió» y «Sin saldo» mientras las tres
 * llaves andaban perfectamente — verificado el 2026-08-28 pidiendo lo mismo con
 * y sin esta cabecera: 403 sin ella, 200 con ella.
 *
 * No es un truco nuevo en esta base: `costos-fijos.ts` ya se lo pone a Supabase
 * por exactamente el mismo motivo.
 */
const UA = 'Mozilla/5.0'

async function pedir(url: string, init: RequestInit = {}): Promise<Response> {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  try {
    return await fetch(url, {
      ...init,
      headers: { 'user-agent': UA, ...(init.headers as Record<string, string>) },
      signal: ctrl.signal,
      cache: 'no-store',
    })
  } finally {
    clearTimeout(t)
  }
}

/** Base común: todo proveedor nace en error y cada sonda lo mejora. */
function base(
  p: Pick<Proveedor, 'id' | 'nombre' | 'categoria' | 'recargable' | 'url'> & {
    detalleKey?: string
  },
): Proveedor {
  return {
    ...p,
    estado: 'error',
    saldo: null,
    unidad: null,
    detalleKey: p.detalleKey ?? null,
    detalle: null,
  }
}

/**
 * Sin llave el detalle deja de ser «para qué sirve» y pasa a ser qué falta: es
 * lo único accionable, y nombrar la variable ahorra el viaje a Render a
 * adivinar cuál era.
 */
const sinLlave = (p: Proveedor, llave: string): Proveedor => ({
  ...p,
  estado: 'sin_llave',
  detalleKey: 'admin.fixedMissingEnv',
  detalle: llave,
})

const sinRespuesta = (p: Proveedor): Proveedor => ({
  ...p,
  estado: 'error',
  detalleKey: 'admin.svcNoAnswer',
})

/** Cero es vacío; por debajo del umbral, bajo. */
function porUmbral(saldo: number, bajo: number): EstadoProveedor {
  if (saldo <= 0) return 'sin_saldo'
  return saldo < bajo ? 'bajo' : 'ok'
}

// ──────────────────────────── Los que dan un número ───────────────────────────

async function telnyx(): Promise<Proveedor> {
  const p = base({
    id: 'telnyx',
    nombre: 'Telnyx',
    categoria: 'voz',
    recargable: true,
    url: 'https://portal.telnyx.com/#/app/billing/payments',
    detalleKey: 'admin.svcTelephony',
  })
  const key = process.env.TELNYX_API_KEY
  if (!key) return sinLlave(p, 'TELNYX_API_KEY')
  try {
    const r = await pedir('https://api.telnyx.com/v2/balance', {
      headers: { Authorization: `Bearer ${key}` },
    })
    const j = await r.json()
    const b = j?.data
    if (!b) return { ...p, detalleKey: 'admin.svcNoData' }
    const credito = Number(b.available_credit ?? b.balance ?? 0)
    return {
      ...p,
      estado: porUmbral(credito, 10),
      saldo: credito,
      unidad: b.currency || 'USD',
    }
  } catch {
    return sinRespuesta(p)
  }
}

async function deepgram(): Promise<Proveedor> {
  const p = base({
    id: 'deepgram',
    nombre: 'Deepgram',
    categoria: 'voz',
    recargable: true,
    url: 'https://console.deepgram.com/',
    detalleKey: 'admin.svcStt',
  })
  const key = process.env.DEEPGRAM_API_KEY
  if (!key) return sinLlave(p, 'DEEPGRAM_API_KEY')
  try {
    const pr = await pedir('https://api.deepgram.com/v1/projects', {
      headers: { Authorization: `Token ${key}` },
    })
    const pj = await pr.json()
    const pid = pj?.projects?.[0]?.project_id
    if (!pid) return { ...p, detalleKey: 'admin.svcNoProject' }
    const br = await pedir(`https://api.deepgram.com/v1/projects/${pid}/balances`, {
      headers: { Authorization: `Token ${key}` },
    })
    const bj = await br.json()
    const monto = Number(bj?.balances?.[0]?.amount ?? 0)
    return { ...p, estado: porUmbral(monto, 15), saldo: monto, unidad: 'USD' }
  } catch {
    return sinRespuesta(p)
  }
}

async function fishAudio(): Promise<Proveedor> {
  const p = base({
    id: 'fish',
    nombre: 'Fish Audio',
    categoria: 'voz',
    recargable: true,
    url: 'https://fish.audio/go-api/',
    detalleKey: 'admin.svcTts',
  })
  const key = process.env.FISH_API_KEY
  if (!key) return sinLlave(p, 'FISH_API_KEY')
  try {
    const r = await pedir('https://api.fish.audio/wallet/self/api-credit', {
      headers: { Authorization: `Bearer ${key}` },
    })
    const j = await r.json()
    // `credit` viene como string en la API de Fish.
    const credito = Number(j?.credit ?? 0)
    return {
      ...p,
      estado: porUmbral(credito, 5),
      saldo: credito,
      unidad: 'USD',
      // Sin saldo Fish NO queda muerto: s2.1-pro-free sigue sintetizando (sin
      // garantías de latencia). Los modelos pagos sí devuelven 402.
      detalleKey: credito <= 0 ? 'admin.svcTtsFree' : 'admin.svcTts',
    }
  } catch {
    return sinRespuesta(p)
  }
}

async function elevenlabs(): Promise<Proveedor> {
  const p = base({
    id: 'elevenlabs',
    nombre: 'ElevenLabs',
    categoria: 'voz',
    recargable: true,
    url: 'https://elevenlabs.io/app/subscription',
    detalleKey: 'admin.svcTtsPremium',
  })
  const key = process.env.ELEVENLABS_API_KEY
  if (!key) return sinLlave(p, 'ELEVENLABS_API_KEY')
  try {
    const r = await pedir('https://api.elevenlabs.io/v1/user/subscription', {
      headers: { 'xi-api-key': key },
    })
    const j = await r.json()
    const quedan = Number(j?.character_limit ?? 0) - Number(j?.character_count ?? 0)
    return { ...p, estado: porUmbral(quedan, 5000), saldo: quedan, unidad: 'chars' }
  } catch {
    return sinRespuesta(p)
  }
}

/**
 * Stripe no es un proveedor que se recargue: es el que trae la plata.
 *
 * Va en la misma pantalla igual porque la pregunta que trae a alguien acá
 * —«¿me alcanza para que esto siga andando?»— se contesta mirando las dos
 * mitades.
 */
async function stripe(): Promise<Proveedor> {
  const p = base({
    id: 'stripe',
    nombre: 'Stripe',
    categoria: 'ingresos',
    recargable: false,
    url: 'https://dashboard.stripe.com/balance/overview',
    detalleKey: 'admin.svcIncome',
  })
  const key = process.env.STRIPE_SECRET_KEY
  if (!key) return sinLlave(p, 'STRIPE_SECRET_KEY')
  try {
    const r = await pedir('https://api.stripe.com/v1/balance', {
      headers: { authorization: `Bearer ${key}` },
    })
    const d = (await r.json()) as {
      available?: { amount: number; currency: string }[]
      pending?: { amount: number }[]
    } | null
    const disponible = d?.available?.[0]
    if (!r.ok || !disponible) return { ...p, detalle: `HTTP ${r.status}` }
    const pendiente = (d?.pending ?? []).reduce((n, x) => n + (x.amount ?? 0), 0)
    return {
      ...p,
      // Cero acá no es una alarma: significa que ya se transfirió.
      estado: 'ok',
      saldo: disponible.amount / 100,
      unidad: (disponible.currency ?? 'usd').toUpperCase(),
      detalle: pendiente > 0 ? `+${(pendiente / 100).toFixed(2)}` : null,
      detalleKey: pendiente > 0 ? 'admin.svcIncomePending' : 'admin.svcIncome',
    }
  } catch {
    return sinRespuesta(p)
  }
}

// ─────────────────────────── Los que sólo dicen si andan ──────────────────────

/**
 * Sonda mínima OpenAI-compatible: una completion de un token.
 *
 * Cuesta una fracción de centavo y es la única señal fiable: 200 significa que
 * la cuenta puede facturar Y responder, que es justo lo que hay que saber. 402
 * es sin saldo; 429, al límite.
 */
async function sondaOpenAICompat(
  id: string,
  nombre: string,
  baseUrl: string,
  key: string | undefined,
  modelo: string,
  detalleKey: string,
  url: string,
  llave: string,
): Promise<Proveedor> {
  const p = base({ id, nombre, categoria: 'llm', recargable: true, url, detalleKey })
  if (!key) return sinLlave(p, llave)

  const cabeceras = { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }
  const tirar = (m: string) =>
    pedir(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: cabeceras,
      body: JSON.stringify({
        model: m,
        max_tokens: 1,
        messages: [{ role: 'user', content: 'hi' }],
      }),
    })

  try {
    let r = await tirar(modelo)

    // El modelo de la sonda se pudre solo: Groq retiró `llama-3.1-8b-instant` y
    // desde entonces contestaba 404, que el panel mostraba como «respondió con
    // error» — indistinguible de una cuenta sin saldo, sobre una llave sana.
    //
    // Cuando el modelo no existe se pregunta cuáles hay y se reintenta con el
    // primero. Cuesta una llamada más sólo el día que el catálogo cambia, y a
    // cambio la sonda no vuelve a envejecer.
    if (r.status === 404) {
      const otro = await primerModelo(baseUrl, cabeceras)
      if (otro) r = await tirar(otro)
    }

    if (r.status === 200) return { ...p, estado: 'ok' }
    if (r.status === 402) return { ...p, estado: 'sin_saldo', detalleKey: 'admin.svcNoCredit' }
    if (r.status === 429) return { ...p, estado: 'bajo', detalleKey: 'admin.svcRateLimited' }
    return { ...p, detalleKey: 'admin.svcHttpError', detalle: `HTTP ${r.status}` }
  } catch {
    return sinRespuesta(p)
  }
}

/** Un modelo que el proveedor tenga hoy, para reintentar la sonda. */
async function primerModelo(
  baseUrl: string,
  cabeceras: Record<string, string>,
): Promise<string | null> {
  try {
    const r = await pedir(`${baseUrl}/models`, { headers: cabeceras })
    if (!r.ok) return null
    const j = (await r.json()) as { data?: { id?: string; active?: boolean }[] }
    const vivo = (j.data ?? []).find((m) => m.id && m.active !== false)
    return vivo?.id ?? null
  } catch {
    return null
  }
}

/**
 * Anthropic no publica el saldo.
 *
 * Lo que sí se puede es preguntarle si cobraría: una llamada de un token. Sin
 * crédito responde 400 con `credit balance is too low`, que es exactamente el
 * estado que hay que ver acá.
 */
async function anthropic(): Promise<Proveedor> {
  const p = base({
    id: 'anthropic',
    nombre: 'Anthropic',
    categoria: 'llm',
    recargable: true,
    url: 'https://console.anthropic.com/settings/billing',
    detalleKey: 'admin.svcTextBot',
  })
  const key = process.env.ANTHROPIC_API_KEY
  if (!key) return sinLlave(p, 'ANTHROPIC_API_KEY')
  try {
    const r = await pedir('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1,
        messages: [{ role: 'user', content: 'hi' }],
      }),
    })
    if (r.status === 200) return { ...p, estado: 'ok' }
    const j = await r.json().catch(() => null)
    const msg = String(j?.error?.message || '')
    if (/credit balance/i.test(msg))
      return { ...p, estado: 'sin_saldo', detalleKey: 'admin.svcNoCredit' }
    return { ...p, detalleKey: 'admin.svcHttpError', detalle: `HTTP ${r.status}` }
  } catch {
    return sinRespuesta(p)
  }
}

/**
 * Gemini: la lista de modelos es gratis, así que un 200 dice que la llave sirve
 * y NO dice que haya crédito. Por la regla 2, eso es `desconocido`.
 */
async function gemini(): Promise<Proveedor> {
  const p = base({
    id: 'gemini',
    nombre: 'Google Gemini',
    categoria: 'llm',
    recargable: true,
    url: 'https://aistudio.google.com/app/billing',
    detalleKey: 'admin.svcNoBalanceApi',
  })
  const key = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY
  if (!key) return sinLlave(p, 'GEMINI_API_KEY')
  try {
    const r = await pedir(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${key}`,
    )
    if (r.status === 200) return { ...p, estado: 'desconocido' }
    return { ...p, detalleKey: 'admin.svcHttpError', detalle: `HTTP ${r.status}` }
  } catch {
    return sinRespuesta(p)
  }
}

async function render(): Promise<Proveedor> {
  const p = base({
    id: 'render',
    nombre: 'Render',
    categoria: 'infra',
    recargable: false,
    url: 'https://dashboard.render.com/',
    detalleKey: 'admin.svcAllUp',
  })
  const key = process.env.RENDER_API_KEY
  if (!key) return sinLlave(p, 'RENDER_API_KEY')
  try {
    const r = await pedir('https://api.render.com/v1/services?limit=100', {
      headers: { Authorization: `Bearer ${key}` },
    })
    const a = (await r.json()) as Array<
      { service?: { suspended?: string } } & { suspended?: string }
    >
    const svcs = a.map((x) => x.service || x)
    const total = svcs.length
    const suspendidos = svcs.filter(
      (s) => (s as { suspended?: string }).suspended === 'suspended',
    ).length
    return {
      ...p,
      estado: suspendidos > 0 ? 'bajo' : 'ok',
      saldo: total - suspendidos,
      unidad: `/${total}`,
      detalleKey: suspendidos > 0 ? 'admin.svcSuspended' : 'admin.svcAllUp',
    }
  } catch {
    return sinRespuesta(p)
  }
}

async function supabase(): Promise<Proveedor> {
  const p = base({
    id: 'supabase',
    nombre: 'Supabase',
    categoria: 'infra',
    recargable: false,
    url: 'https://supabase.com/dashboard',
    detalleKey: 'admin.svcOperational',
  })
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) return sinLlave(p, 'SUPABASE_SERVICE_ROLE_KEY')
  try {
    const r = await pedir(`${url}/rest/v1/`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
    })
    if (r.ok) return { ...p, estado: 'ok' }
    return { ...p, detalleKey: 'admin.svcHttpError', detalle: `HTTP ${r.status}` }
  } catch {
    return sinRespuesta(p)
  }
}

async function livekit(): Promise<Proveedor> {
  const p = base({
    id: 'livekit',
    nombre: 'LiveKit',
    categoria: 'infra',
    recargable: false,
    url: 'https://cloud.livekit.io/',
    detalleKey: 'admin.svcCallOrchestration',
  })
  const listo =
    process.env.LIVEKIT_URL &&
    process.env.LIVEKIT_API_KEY &&
    process.env.LIVEKIT_API_SECRET
  // El SDK de servidor firma los tokens localmente: con las tres variables
  // puestas está operativo, no hay a quién preguntarle.
  if (!listo) return sinLlave(p, 'LIVEKIT_API_KEY')
  return { ...p, estado: 'ok' }
}

/**
 * Resend: por acá salen la lista de espera y el aviso diario de «esto se rompió
 * en tu cuenta». Es de los pocos servicios cuya caída no se nota por ningún
 * otro lado — un correo que no sale no deja rastro.
 */
async function resend(): Promise<Proveedor> {
  const p = base({
    id: 'resend',
    nombre: 'Resend',
    categoria: 'mensajeria',
    recargable: false,
    url: 'https://resend.com/domains',
    detalleKey: 'admin.svcEmail',
  })
  const key = process.env.RESEND_API_KEY
  if (!key) return sinLlave(p, 'RESEND_API_KEY')
  try {
    const r = await pedir('https://api.resend.com/domains', {
      headers: { Authorization: `Bearer ${key}` },
    })
    if (r.ok) return { ...p, estado: 'ok' }
    // Una llave restringida a enviar es una llave SANA: enviar es lo único que
    // Riverz le pide. `/domains` pide alcance completo y contesta 401
    // `restricted_api_key` — pintarlo en rojo era decir que el correo estaba
    // caído cuando salía perfecto.
    if (r.status === 401) {
      const cuerpo = await r.text().catch(() => '')
      if (/restricted_api_key/i.test(cuerpo)) {
        return { ...p, estado: 'ok', detalleKey: 'admin.svcEmailSendOnly' }
      }
    }
    return { ...p, detalleKey: 'admin.svcHttpError', detalle: `HTTP ${r.status}` }
  } catch {
    return sinRespuesta(p)
  }
}

/**
 * El WhatsApp de la plataforma — el número por el que Riverz pregunta lo que la
 * IA no decide sola. Si no está configurado, esas preguntas no salen.
 */
async function whatsappDeRiverz(): Promise<Proveedor> {
  const p = base({
    id: 'platform-whatsapp',
    nombre: 'WhatsApp de Riverz',
    categoria: 'mensajeria',
    recargable: false,
    url: 'https://business.facebook.com/billing_hub/accounts',
    detalleKey: 'admin.svcPlatformWa',
  })
  try {
    const { platformWhatsAppStatus } = await import('./platform-whatsapp')
    const st = await platformWhatsAppStatus()
    if (!st.configured) return sinLlave(p, 'PLATFORM_WHATSAPP_TOKEN')
    return { ...p, estado: st.active ? 'ok' : 'bajo' }
  } catch {
    return sinRespuesta(p)
  }
}

// ──────────────────────── Lo que consumimos nosotros ─────────────────────────

/**
 * Los tokens y el gasto del mes que la PLATAFORMA le puso a Anthropic.
 *
 * Es el único proveedor de modelos del que se sabe el consumo real, porque el
 * runner guarda los tokens de cada despacho desde la migración 024. Ninguno de
 * los cinco publica saldo por API, así que sin esto la columna quedaba en un
 * guion — y un guion no dice si se están quemando diez dólares por mes o mil.
 *
 * Dos cosas que este número hacía mal y ahora no:
 *
 * 1. **Sumaba todos los modelos bajo la fila de Anthropic.** Una caída al
 *    respaldo de Groq aparecía como gasto de Anthropic. Ahora el desglose por
 *    modelo de la migración 230 dice de quién es cada dólar, y cada fila
 *    muestra lo suyo.
 * 2. **Prorrateaba por tokens.** Entre Haiku (1 USD/M) y Opus (5 USD/M) la
 *    proporción de tokens no es la proporción de plata. El corte por bolsillo
 *    ahora viene guardado, no estimado.
 *
 * Sólo la parte que paga la plataforma: lo que un comercio gasta con SU llave
 * no sale de nuestro saldo, y sumarlo acá inflaría el número justo en la
 * pantalla que existe para saber cuánto hay que recargar.
 */
async function consumoPorProveedor(): Promise<Map<string, { usdMes: number }>> {
  const porProveedor = new Map<string, { usdMes: number }>()
  try {
    const ahora = new Date()
    const desde = new Date(Date.UTC(ahora.getUTCFullYear(), ahora.getUTCMonth(), 1))
    const costo = await leerCostoIa(supabaseAdmin(), { desde, hasta: ahora })

    for (const cuenta of costo.porCuenta.values()) {
      for (const [modelo, linea] of Object.entries(cuenta.porModelo)) {
        const id = proveedorDeModelo(modelo)
        if (!id) continue
        const acc = porProveedor.get(id) ?? { usdMes: 0 }
        acc.usdMes += linea.plataformaUsd
        porProveedor.set(id, acc)
      }
    }
    for (const [id, v] of porProveedor) {
      porProveedor.set(id, { usdMes: Number(v.usdMes.toFixed(2)) })
    }
  } catch {
    // El consumo es un extra: si la consulta falla, la pantalla sigue
    // contestando lo que de verdad vino a contestar.
  }
  return porProveedor
}

// ────────────────────────────────── La ronda ─────────────────────────────────

/** Qué estados significan «esto necesita plata ahora». */
const EN_ROJO: EstadoProveedor[] = ['sin_saldo', 'bajo']

export function cuantosEnRojo(proveedores: Proveedor[]): number {
  return proveedores.filter((p) => EN_ROJO.includes(p.estado)).length
}

/**
 * Todos, en paralelo, más los costos fijos. Ninguno puede tumbar al resto.
 *
 * `allSettled` y no `all`: una promesa rechazada acá dejaba la pantalla entera
 * en error por un proveedor.
 */
export async function leerProveedores(): Promise<EstadoDeProveedores> {
  const [sondas, fijos, consumo] = await Promise.all([
    Promise.allSettled([
      // Modelos
      anthropic(),
      sondaOpenAICompat(
        'cerebras',
        'Cerebras',
        'https://api.cerebras.ai/v1',
        process.env.CEREBRAS_API_KEY,
        'gpt-oss-120b',
        'admin.svcVoiceLlm',
        'https://cloud.cerebras.ai/',
        'CEREBRAS_API_KEY',
      ),
      sondaOpenAICompat(
        'groq',
        'Groq',
        'https://api.groq.com/openai/v1',
        process.env.GROQ_API_KEY,
        'openai/gpt-oss-20b',
        'admin.svcBackupLlm',
        'https://console.groq.com/settings/billing',
        'GROQ_API_KEY',
      ),
      sondaOpenAICompat(
        'openai',
        'OpenAI',
        'https://api.openai.com/v1',
        process.env.OPENAI_API_KEY,
        'gpt-4o-mini',
        'admin.svcGpt',
        'https://platform.openai.com/settings/organization/billing',
        'OPENAI_API_KEY',
      ),
      gemini(),
      // Voz y telefonía
      telnyx(),
      deepgram(),
      fishAudio(),
      elevenlabs(),
      // Mensajería de la plataforma
      resend(),
      whatsappDeRiverz(),
      // Infraestructura
      render(),
      supabase(),
      livekit(),
      // Lo que entra
      stripe(),
    ]),
    leerCostosFijos(),
    consumoPorProveedor(),
  ])

  const proveedores = sondas
    .filter((r): r is PromiseFulfilledResult<Proveedor> => r.status === 'fulfilled')
    .map((r) => r.value)
    .map((p) => {
      const gasto = consumo.get(p.id)
      return gasto ? { ...p, consumo: gasto } : p
    })

  return {
    proveedores,
    fijos,
    enRojo: cuantosEnRojo(proveedores),
    consultadoAt: new Date().toISOString(),
  }
}

/**
 * La misma ronda, compartida por todo el que la necesite.
 *
 * **La caché no es una optimización: es plata.** Varias de estas sondas son
 * completions FACTURABLES (Anthropic, Cerebras, Groq, OpenAI). Vivía en la ruta
 * `/api/admin/proveedores`, y funcionó mientras esa ruta era la única que la
 * llamaba. La Caja necesita los mismos saldos, así que sin mover la caché acá
 * abrir las dos pantallas eran dos rondas pagas.
 *
 * `enVuelo` es el otro medio: dos pedidos simultáneos comparten la misma ronda
 * en vez de disparar dos.
 */
const CACHE_TTL_MS = 55_000

let cache: { at: number; data: EstadoDeProveedores } | null = null
let enVuelo: Promise<EstadoDeProveedores> | null = null

export async function leerProveedoresConCache(): Promise<EstadoDeProveedores> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.data
  if (enVuelo) return enVuelo

  enVuelo = leerProveedores()
    .then((data) => {
      cache = { at: Date.now(), data }
      return data
    })
    .finally(() => {
      enVuelo = null
    })

  return enVuelo
}
