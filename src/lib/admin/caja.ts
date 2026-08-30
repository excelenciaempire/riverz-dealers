/**
 * La caja: cuánta plata hay, cuántos días aguanta y qué hacer ahora.
 *
 * Proveedores contesta «¿cuánto le queda a cada API?» y Negocio contesta
 * «¿cuánto factura Riverz?». Falta la pregunta que las une, que es la única que
 * se hace de verdad un lunes a la mañana: **¿tengo con qué pagar lo que los
 * comercios van a consumir esta semana?**
 *
 * Hay tres plazos distintos y confundirlos es como se llega a un proveedor en
 * cero con la cuenta de Stripe llena:
 *
 *  1. **El comercio gasta hoy.** Recarga a las 10 y puede quemar todo el saldo
 *     antes del mediodía.
 *  2. **Stripe paga en dos días hábiles.** Lo del viernes llega el martes.
 *  3. **El proveedor cobra por adelantado.** Anthropic, Telnyx y Deepgram son
 *     prepagos: sin saldo no atienden, y no fían.
 *
 * Ese hueco —entre que el comercio gasta y que la plata llega— es capital de
 * trabajo, y hay que tenerlo puesto ANTES. De ahí sale todo lo que se calcula
 * acá: el colchón, los días de autonomía y los pasos.
 *
 * Dos reglas heredadas de Proveedores, porque siguen siendo las que importan:
 *
 * - **No saber no es estar bien.** Anthropic no publica saldo. Lo que no se
 *   pudo medir se dice, no se estima: un tablero que pinta verde lo que no
 *   midió es peor que no tener tablero.
 * - **El texto viaja como clave.** Esta pantalla se ve en español y en inglés.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

import { leerProveedoresConCache, type Proveedor } from './proveedores'
import { leerSaldoDeStripe, type SaldoDeStripe, type PayoutEnCamino } from './stripe-saldo'

/**
 * Días de consumo que hay que tener puestos en los proveedores.
 *
 * Cinco, y no dos: Stripe paga a T+2 **días hábiles**, así que lo cobrado un
 * viernes llega el martes. Cinco cubre el peor fin de semana largo sin que
 * ningún comercio se quede sin IA esperando una transferencia.
 */
export const COLCHON_DIAS = 5

/** Ventana para medir el ritmo de consumo. Una semana incluye el fin de semana,
 *  que consume distinto y no se puede promediar afuera. */
const VENTANA_DIAS = 7

// ────────────────────────────── Lo que se devuelve ─────────────────────────────

/**
 * El estado de la cuenta de Stripe. El tipo vive en `stripe-saldo` porque lo
 * comparten esta pantalla y la fila de Proveedores: eran dos lecturas con dos
 * cálculos distintos del mismo saldo.
 */
export type CajaStripe = SaldoDeStripe
export type { PayoutEnCamino }

export interface Paso {
  id: string
  tono: 'ok' | 'warn' | 'error' | 'muted'
  /** Clave i18n del texto. */
  key: string
  /** Lo que interpola la clave. `usd` y `dias` los formatea la pantalla. */
  params: { nombre?: string; usd?: number; dias?: number }
  /** Dónde se resuelve. Null cuando no hay a dónde ir. */
  href: string | null
}

/**
 * Lo que cuesta meterle plata a cada plataforma.
 *
 * No es el precio por token —ese lo cobra la billetera y se ve en Uso— sino la
 * fricción de la recarga: el recargo por pagar con tarjeta, el mínimo, y si los
 * créditos vencen. Es lo que decide CUÁNTO y CADA CUÁNTO conviene cargar, y no
 * está en ninguna API: se investigó una vez y vive acá para no volver a
 * buscarlo en once tableros.
 *
 * Verificado el 2026-08-30 contra la documentación de cada proveedor.
 */
export interface CosteDeRecarga {
  id: string
  /** Nombre comercial. No se traduce: es un nombre propio. */
  nombre: string
  modelo: 'prepago' | 'suscripcion' | 'mixto'
  /** Recargo por cargar saldo, en porcentaje. 0 = no cobra por cargar. */
  recargoPct: number
  /** Mínimo de recarga en USD. Null = no tiene. */
  minimoUsd: number | null
  /** Meses hasta que vencen los créditos. 0 = al cierre del ciclo.
   *  Null = no vencen. */
  venceMeses: number | null
  /** Clave i18n de la advertencia, cuando hay una que cuesta plata ignorar. */
  notaKey: string | null
  url: string
}

export interface Caja {
  stripe: CajaStripe
  /** Los prepagos, con lo que cada uno declara. */
  proveedores: {
    id: string
    nombre: string
    usd: number | null
    unidad: string | null
    estado: Proveedor['estado']
    url: string | null
  }[]
  /** Suma de los prepagos que SÍ dan un número. */
  enProveedoresUsd: number
  /** Los que no publican saldo. Se nombran: sin ellos el total miente. */
  sinMedir: string[]
  /** Saldo cobrado a comercios y todavía no consumido. Es deuda, no ingreso. */
  deudaUsd: number
  /** Lo que hay menos lo que se debe. Es la plata que de verdad es de Riverz. */
  cajaLibreUsd: number
  /** Consumo real diario de los comercios, medido sobre la última semana. */
  quemaDiaUsd: number
  /** Lo fijo del mes (Render, Supabase): no sale de los prepagos, sale de la
   *  tarjeta, así que no entra en los días de autonomía. */
  fijoMesUsd: number
  /** Cuántos días cubre lo que hay puesto en los prepagos. Null si no se pudo
   *  medir el ritmo o no hay ningún saldo medido. */
  diasDeAutonomia: number | null
  /** Lo que falta cargar para llegar al colchón. */
  faltaParaColchonUsd: number
  /** Los días de colchón contra los que se mide. Viaja en el payload y no como
   *  constante importada: la pantalla es un componente de cliente, y traerse
   *  este módulo por un número metería Supabase en el bundle del navegador. */
  colchonDias: number
  pasos: Paso[]
  costes: CosteDeRecarga[]
  medidoAt: string
}

// ───────────────────────────── El ritmo de consumo ─────────────────────────────

/**
 * Lo que los comercios consumieron por día, en USD, sobre la última semana.
 *
 * Se mide el **costo**, no lo cobrado: el que tiene que pagarle a Anthropic es
 * Riverz, y desde la migración 225 casi todas las cuentas cobran a costo, así
 * que las dos cifras son casi la misma — pero la que vacía los prepagos es esta.
 * Cuando un consumo no trae costo medido se usa lo cobrado, que es la tarifa:
 * un movimiento sin medir no puede valer cero.
 *
 * Se pagina a mano porque **PostgREST corta en 1000 filas sin avisar**, y una
 * semana de movimientos pasa esa marca apenas haya una decena de comercios: el
 * ritmo saldría bajo, el colchón chico, y el error sería invisible.
 */
async function quemaDiariaUsd(db: SupabaseClient): Promise<number> {
  const desde = new Date(Date.now() - VENTANA_DIAS * 24 * 60 * 60 * 1000).toISOString()
  const PAGINA = 1000

  let total = 0
  for (let pagina = 0; ; pagina++) {
    const { data, error } = await db
      .from('wallet_movimientos')
      .select('centavos, costo_centavos')
      .eq('tipo', 'consumo')
      .gte('creado_en', desde)
      .range(pagina * PAGINA, pagina * PAGINA + PAGINA - 1)
    if (error || !data?.length) break

    for (const m of data as { centavos: number; costo_centavos: number | null }[]) {
      const costo = m.costo_centavos ?? Math.abs(Number(m.centavos ?? 0))
      total += Number(costo) || 0
    }
    if (data.length < PAGINA) break
  }

  return total / 100 / VENTANA_DIAS
}

/**
 * Todo el saldo cobrado a comercios y todavía sin consumir.
 *
 * Es **deuda**: servicio pagado y no prestado. Se resta de la caja libre porque
 * esa plata ya tiene dueño, y mirarla como propia es exactamente como se llega
 * a fin de mes sin con qué recargar.
 *
 * Antes salía de `leerNegocio`, que para dar este único campo corría cinco
 * consultas —una de ellas un barrido de hasta 100.000 movimientos— cada vez que
 * alguien abría la Caja. Acá es una sola, paginada porque **PostgREST corta en
 * 1000 filas sin avisar** y un total truncado se lee igual de razonable que uno
 * completo.
 */
async function saldoQueSeDebe(db: SupabaseClient): Promise<number> {
  const PAGINA = 1000
  let centavos = 0
  for (let pagina = 0; ; pagina++) {
    const { data, error } = await db
      .from('wallet_accounts')
      .select('saldo_centavos')
      .range(pagina * PAGINA, pagina * PAGINA + PAGINA - 1)
    if (error || !data?.length) break
    for (const f of data as { saldo_centavos: number | null }[]) {
      centavos += Number(f.saldo_centavos ?? 0) || 0
    }
    if (data.length < PAGINA) break
  }
  return centavos / 100
}

// ────────────────────────── Qué hacer ahora, y en qué orden ────────────────────

/**
 * Los pasos, ordenados por lo que duele si no se hace.
 *
 * Se cortan en cinco. Una lista de doce cosas pendientes no se lee: se cierra.
 */
function armarPasos(c: Omit<Caja, 'pasos' | 'costes' | 'medidoAt'>): Paso[] {
  const pasos: Paso[] = []

  if (c.stripe.errorKey === 'admin.fixedMissingEnv') {
    pasos.push({
      id: 'stripe-sin-llave',
      tono: 'error',
      key: 'admin.cashStepNoStripe',
      params: {},
      href: null,
    })
  }

  // Primero los que ya están en cero: ahí hay un comercio sin respuesta ahora
  // mismo, no un riesgo.
  for (const p of c.proveedores) {
    if (p.estado === 'sin_saldo') {
      pasos.push({
        id: `recargar-${p.id}`,
        tono: 'error',
        key: 'admin.cashStepEmpty',
        params: { nombre: p.nombre },
        href: p.url,
      })
    }
  }

  if (c.faltaParaColchonUsd > 0 && c.quemaDiaUsd > 0) {
    pasos.push({
      id: 'colchon',
      tono: c.diasDeAutonomia !== null && c.diasDeAutonomia < 2 ? 'error' : 'warn',
      key: 'admin.cashStepCushion',
      params: { usd: c.faltaParaColchonUsd, dias: COLCHON_DIAS },
      href: null,
    })
  }

  for (const p of c.proveedores) {
    if (p.estado === 'bajo') {
      pasos.push({
        id: `bajo-${p.id}`,
        tono: 'warn',
        key: 'admin.cashStepLow',
        params: { nombre: p.nombre, usd: p.usd ?? 0 },
        href: p.url,
      })
    }
  }

  // La deuda por encima de la caja significa que se está gastando saldo que
  // todavía se le debe a un comercio. Es el aviso más importante de la pantalla
  // y el único que no se ve en ningún otro lado.
  if (c.cajaLibreUsd < 0) {
    pasos.push({
      id: 'deuda',
      tono: 'error',
      key: 'admin.cashStepDebt',
      params: { usd: Math.abs(c.cajaLibreUsd) },
      href: null,
    })
  }

  if ((c.stripe.disponibleUsd ?? 0) > 0) {
    pasos.push({
      id: 'transferir',
      tono: 'ok',
      key: 'admin.cashStepPayout',
      params: { usd: c.stripe.disponibleUsd ?? 0 },
      href: 'https://dashboard.stripe.com/balance/overview',
    })
  }

  return pasos.slice(0, 5)
}

// ───────────────────────── Lo que cuesta recargar cada uno ─────────────────────

/**
 * La tabla de fricción, investigada el 2026-08-30.
 *
 * Va compilada y no en la base a propósito: son condiciones comerciales que
 * cambian una o dos veces por año, y una tabla editable pediría una pantalla
 * de edición para un dato que nadie toca.
 */
const COSTES: CosteDeRecarga[] = [
  {
    id: 'anthropic',
    nombre: 'Anthropic',
    modelo: 'prepago',
    recargoPct: 0,
    minimoUsd: 5,
    venceMeses: 12,
    notaKey: 'admin.cashNoteAnthropic',
    url: 'https://console.anthropic.com/settings/billing',
  },
  {
    id: 'telnyx',
    nombre: 'Telnyx',
    modelo: 'prepago',
    recargoPct: 3,
    minimoUsd: 10,
    venceMeses: null,
    notaKey: 'admin.cashNoteTelnyx',
    url: 'https://portal.telnyx.com/#/app/billing/payments',
  },
  {
    id: 'deepgram',
    nombre: 'Deepgram',
    modelo: 'prepago',
    recargoPct: 0,
    minimoUsd: null,
    venceMeses: null,
    notaKey: 'admin.cashNoteDeepgram',
    url: 'https://console.deepgram.com/',
  },
  {
    id: 'fish',
    nombre: 'Fish Audio',
    modelo: 'prepago',
    recargoPct: 0,
    minimoUsd: null,
    venceMeses: null,
    notaKey: 'admin.cashNoteFish',
    url: 'https://fish.audio/go-api/',
  },
  {
    id: 'groq',
    nombre: 'Groq',
    modelo: 'prepago',
    recargoPct: 0,
    minimoUsd: null,
    venceMeses: 12,
    notaKey: null,
    url: 'https://console.groq.com/settings/billing',
  },
  {
    id: 'gemini',
    nombre: 'Google Gemini',
    modelo: 'mixto',
    recargoPct: 0,
    minimoUsd: null,
    venceMeses: null,
    notaKey: 'admin.cashNoteGemini',
    url: 'https://aistudio.google.com/app/billing',
  },
  {
    id: 'elevenlabs',
    nombre: 'ElevenLabs',
    modelo: 'suscripcion',
    recargoPct: 0,
    minimoUsd: null,
    venceMeses: 12,
    notaKey: 'admin.cashNoteElevenlabs',
    url: 'https://elevenlabs.io/app/subscription',
  },
  {
    id: 'firecrawl',
    nombre: 'Firecrawl',
    modelo: 'suscripcion',
    recargoPct: 0,
    minimoUsd: null,
    venceMeses: 0,
    notaKey: 'admin.cashNoteFirecrawl',
    url: 'https://www.firecrawl.dev/app/usage',
  },
  {
    id: 'apify',
    nombre: 'Apify',
    modelo: 'suscripcion',
    recargoPct: 0,
    minimoUsd: null,
    venceMeses: 0,
    notaKey: 'admin.cashNoteApify',
    url: 'https://console.apify.com/billing',
  },
  {
    id: 'whatsapp',
    nombre: 'Meta / WhatsApp',
    modelo: 'prepago',
    recargoPct: 0,
    minimoUsd: null,
    venceMeses: null,
    notaKey: 'admin.cashNoteMeta',
    url: 'https://business.facebook.com/billing_hub/accounts',
  },
]

// ──────────────────────────────── El armado ────────────────────────────────────

export async function leerCaja(db: SupabaseClient): Promise<Caja> {
  const [estado, stripe, quemaDiaUsd, deudaUsd] = await Promise.all([
    leerProveedoresConCache(),
    leerSaldoDeStripe(),
    quemaDiariaUsd(db),
    saldoQueSeDebe(db),
  ])

  // Sólo los prepagos: lo fijo se paga con tarjeta y no se agota, y lo que no
  // se recarga no tiene autonomía que medir.
  const recargables = estado.proveedores.filter((p) => p.recargable)
  const proveedores = recargables.map((p) => ({
    id: p.id,
    nombre: p.nombre,
    // Sólo lo que está en dólares entra al total. Los 'chars' de ElevenLabs no
    // son plata, y Telnyx devuelve la moneda de SU cuenta: sumar un saldo en
    // euros como si fueran dólares inventa plata en el único número de la
    // pantalla que dice si alcanza. Lo que no suma se nombra en `sinMedir`.
    usd: (p.unidad ?? 'USD').toUpperCase() === 'USD' ? p.saldo : null,
    unidad: p.unidad,
    estado: p.estado,
    url: p.url,
  }))

  const enProveedoresUsd = proveedores.reduce((n, p) => n + (p.usd ?? 0), 0)
  const sinMedir = [
    ...proveedores.filter((p) => p.usd === null).map((p) => p.nombre),
    // Un bucket de Stripe en otra moneda no entra en «En Stripe» y por lo tanto
    // tampoco en la caja libre. Nombrarlo es la diferencia entre un total
    // incompleto y un total que miente.
    ...stripe.otrasMonedas.map((m) => `Stripe ${m}`),
  ]

  const enStripeUsd = (stripe.disponibleUsd ?? 0) + (stripe.pendienteUsd ?? 0)
  const cajaLibreUsd = enStripeUsd + enProveedoresUsd - deudaUsd

  const diasDeAutonomia =
    quemaDiaUsd > 0 && enProveedoresUsd > 0 ? enProveedoresUsd / quemaDiaUsd : null
  const faltaParaColchonUsd = Math.max(
    0,
    quemaDiaUsd * COLCHON_DIAS - enProveedoresUsd,
  )

  const sinPasos = {
    stripe,
    proveedores,
    enProveedoresUsd,
    sinMedir,
    deudaUsd,
    cajaLibreUsd,
    quemaDiaUsd,
    fijoMesUsd: estado.fijos.crmUsdMes,
    diasDeAutonomia,
    faltaParaColchonUsd,
    colchonDias: COLCHON_DIAS,
  }

  return {
    ...sinPasos,
    pasos: armarPasos(sinPasos),
    costes: COSTES,
    medidoAt: new Date().toISOString(),
  }
}
