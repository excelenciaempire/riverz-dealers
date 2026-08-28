/**
 * Lo que se paga todos los meses aunque nadie use nada.
 *
 * El saldo de los proveedores contesta "¿me alcanza para hoy?". Esta es la otra
 * mitad: cuánto cuesta que la plataforma exista. Sin ella, la única forma de
 * saber cuánto sale mantener Riverz prendido era abrir cuatro tableros y sumar
 * a mano — y eso no se hace, así que nadie sabe el número.
 *
 * Se lee de la API de Render, que es la que factura de verdad, y no de una
 * lista escrita a mano: un servicio nuevo, un plan que cambia o algo que se
 * suspende se reflejan solos. Lo que ninguna API dice se lista igual, con su
 * enlace y sin número inventado.
 */

export interface CostoFijo {
  id: string
  nombre: string
  detalle: string
  /** USD por mes. Null cuando no se puede saber. */
  usdMes: number | null
  /** Suspendido o apagado: aparece, y no suma. */
  activo: boolean
  url: string
}

/**
 * Lo que cobra Render por plan, en USD al mes.
 *
 * Los cron jobs se cobran prorrateados por segundo con un mínimo de 1 USD al
 * mes, así que 1 es el piso real de cualquiera que exista.
 */
const PLAN_USD: Record<string, number> = {
  free: 0,
  starter: 7,
  standard: 25,
  pro: 85,
  pro_plus: 175,
  pro_max: 225,
  pro_ultra: 450,
}

const TIMEOUT_MS = 8000

interface ServicioRender {
  id: string
  name: string
  type: string
  suspended?: string
  serviceDetails?: { plan?: string; instanceType?: string }
}

/** Los servicios de Render, con lo que cuesta cada uno. */
async function deRender(): Promise<CostoFijo[]> {
  const key = process.env.RENDER_API_KEY
  const url = 'https://dashboard.render.com/billing'
  if (!key) {
    return [
      {
        id: 'render',
        nombre: 'Render',
        detalle: 'Falta RENDER_API_KEY',
        usdMes: null,
        activo: true,
        url,
      },
    ]
  }

  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  try {
    const res = await fetch('https://api.render.com/v1/services?limit=50', {
      headers: { authorization: `Bearer ${key}` },
      signal: ctrl.signal,
      cache: 'no-store',
    })
    if (!res.ok) {
      return [
        {
          id: 'render',
          nombre: 'Render',
          detalle: `No respondió (HTTP ${res.status})`,
          usdMes: null,
          activo: true,
          url,
        },
      ]
    }
    const filas = (await res.json()) as { service: ServicioRender }[]
    return filas
      .map(({ service }) => {
        const plan = (service.serviceDetails?.plan ?? '').toLowerCase()
        const suspendido = service.suspended === 'suspended'
        // Un sitio estático no cuesta nada; el resto sale del plan.
        const usd =
          service.type === 'static_site'
            ? 0
            : service.type === 'cron_job'
              ? 1
              : (PLAN_USD[plan] ?? null)
        return {
          id: `render-${service.id}`,
          nombre: service.name,
          detalle: suspendido
            ? `Render · ${plan || service.type} · suspendido`
            : `Render · ${plan || service.type}`,
          usdMes: suspendido ? 0 : usd,
          activo: !suspendido,
          url,
        }
      })
      .sort((a, b) => (b.usdMes ?? 0) - (a.usdMes ?? 0))
  } catch {
    return [
      {
        id: 'render',
        nombre: 'Render',
        detalle: 'No respondió',
        usdMes: null,
        activo: true,
        url,
      },
    ]
  } finally {
    clearTimeout(t)
  }
}

/**
 * Lo que se paga y ninguna API dice.
 *
 * Se listan igual, sin número: un fijo que no aparece en la pantalla es un fijo
 * que nadie revisa, y son justo los que se renuevan solos.
 */
function sinApi(): CostoFijo[] {
  return [
    {
      id: 'supabase',
      nombre: 'Supabase',
      detalle: 'La base de datos de todos los comercios',
      usdMes: null,
      activo: true,
      url: 'https://supabase.com/dashboard/org/_/billing',
    },
    {
      id: 'dominios',
      nombre: 'Dominios',
      detalle: 'riverz.co y riverzai.com — se pagan por año',
      usdMes: null,
      activo: true,
      url: 'https://www.spaceship.com/application/domain-list/',
    },
    {
      id: 'meta',
      nombre: 'WhatsApp (Meta)',
      detalle: 'Por mensaje de plantilla; la atención dentro de 24 h no cuesta',
      usdMes: null,
      activo: true,
      url: 'https://business.facebook.com/billing_hub/accounts',
    },
  ]
}

export interface Fijos {
  items: CostoFijo[]
  /** La suma de lo que sí se pudo medir. */
  totalUsdMes: number
  /** Cuántos no se pudieron medir: el total es un piso, no la verdad. */
  sinMedir: number
}

export async function leerCostosFijos(): Promise<Fijos> {
  const items = [...(await deRender()), ...sinApi()]
  return {
    items,
    totalUsdMes: items.reduce((n, i) => n + (i.activo ? (i.usdMes ?? 0) : 0), 0),
    sinMedir: items.filter((i) => i.usdMes === null).length,
  }
}
