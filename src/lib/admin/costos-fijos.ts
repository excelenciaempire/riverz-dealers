/**
 * Lo que se paga todos los meses aunque nadie use nada.
 *
 * El saldo de los proveedores contesta «¿me alcanza para hoy?». Esta es la otra
 * mitad: cuánto cuesta que la plataforma exista. Sin ella, la única forma de
 * saber cuánto sale mantener Riverz prendido era abrir cuatro tableros y sumar
 * a mano — y eso no se hace, así que nadie sabe el número.
 *
 * Se lee de las APIs que facturan de verdad, y no de una lista escrita a mano:
 * un servicio nuevo, un plan que cambia o algo que se suspende se reflejan
 * solos. Lo que ninguna API dice se lista igual, con su enlace y sin número
 * inventado.
 *
 * El texto viaja como CLAVE i18n, no como frase: esta pantalla se ve en español
 * y en inglés.
 */

export interface CostoFijo {
  id: string
  /** Nombre del servicio. No se traduce: es un nombre propio. */
  nombre: string
  /** Clave i18n de la explicación. */
  detalleKey: string
  /** El dato crudo que la clave interpola: un plan, un HTTP, una variable. */
  detalleExtra: string | null
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
  const caido = (detalleKey: string, detalleExtra: string | null): CostoFijo[] => [
    { id: 'render', nombre: 'Render', detalleKey, detalleExtra, usdMes: null, activo: true, url },
  ]
  if (!key) return caido('admin.fixedMissingEnv', 'RENDER_API_KEY')

  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  try {
    const res = await fetch('https://api.render.com/v1/services?limit=50', {
      headers: { authorization: `Bearer ${key}` },
      signal: ctrl.signal,
      cache: 'no-store',
    })
    if (!res.ok) return caido('admin.fixedNoAnswerHttp', String(res.status))
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
          detalleKey: suspendido ? 'admin.fixedRenderSuspended' : 'admin.fixedRenderPlan',
          detalleExtra: plan || service.type,
          usdMes: suspendido ? 0 : usd,
          activo: !suspendido,
          url,
        }
      })
      .sort((a, b) => (b.usdMes ?? 0) - (a.usdMes ?? 0))
  } catch {
    return caido('admin.fixedNoAnswer', null)
  } finally {
    clearTimeout(t)
  }
}

/**
 * El plan de Supabase, que sí se puede preguntar.
 *
 * La API de la organización devuelve el plan; el precio de lista de cada uno es
 * público y estable. Se pregunta en vez de escribirlo a mano porque el día que
 * el plan cambie, este número tiene que cambiar solo — un costo fijo escrito a
 * mano envejece en silencio.
 */
const SUPABASE_USD: Record<string, number | null> = {
  free: 0,
  pro: 25,
  team: 599,
  enterprise: null,
}

async function deSupabase(): Promise<CostoFijo> {
  const url = 'https://supabase.com/dashboard/org/_/billing'
  const base = {
    id: 'supabase',
    nombre: 'Supabase',
    detalleKey: 'admin.fixedSupabase',
    detalleExtra: null as string | null,
    activo: true,
    url,
  }
  const token = process.env.SUPABASE_ACCESS_TOKEN
  const ref = process.env.NEXT_PUBLIC_SUPABASE_URL?.match(/https:\/\/([^.]+)\./)?.[1]
  if (!token || !ref) {
    return {
      ...base,
      detalleKey: 'admin.fixedMissingEnv',
      detalleExtra: 'SUPABASE_ACCESS_TOKEN',
      usdMes: null,
    }
  }

  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  try {
    const cabeceras = {
      authorization: `Bearer ${token}`,
      // Cloudflare rechaza el User-Agent por defecto de fetch en este host.
      'user-agent': 'Mozilla/5.0',
    }
    const proy = await fetch(`https://api.supabase.com/v1/projects/${ref}`, {
      headers: cabeceras,
      signal: ctrl.signal,
      cache: 'no-store',
    })
    if (!proy.ok) return { ...base, usdMes: null }
    const org = (await proy.json()) as { organization_id?: string }
    if (!org.organization_id) return { ...base, usdMes: null }

    const res = await fetch(
      `https://api.supabase.com/v1/organizations/${org.organization_id}`,
      { headers: cabeceras, signal: ctrl.signal, cache: 'no-store' },
    )
    if (!res.ok) return { ...base, usdMes: null }
    const plan = ((await res.json()) as { plan?: string }).plan ?? ''
    return {
      ...base,
      detalleKey: plan ? 'admin.fixedSupabasePlan' : 'admin.fixedSupabase',
      detalleExtra: plan || null,
      usdMes: SUPABASE_USD[plan] ?? null,
    }
  } catch {
    return { ...base, usdMes: null }
  } finally {
    clearTimeout(t)
  }
}

/**
 * Los números de teléfono alquilados en Telnyx.
 *
 * Faltaban, y son el único fijo que CRECE sin que nadie lo decida: cada cuenta
 * se compra el suyo desde /voz, así que el mes que viene puede costar más que
 * este sin que se haya tocado nada. Un dólar por número es el piso de Telnyx —
 * los internacionales y los toll-free salen más, así que este total es un
 * mínimo, igual que el resto de la pantalla.
 */
async function deTelnyx(): Promise<CostoFijo> {
  const url = 'https://portal.telnyx.com/#/app/numbers/my-numbers'
  const base = {
    id: 'telnyx-numeros',
    nombre: 'Telnyx',
    detalleKey: 'admin.fixedPhoneNumbers',
    detalleExtra: null as string | null,
    activo: true,
    url,
  }
  const key = process.env.TELNYX_API_KEY
  if (!key) {
    return {
      ...base,
      detalleKey: 'admin.fixedMissingEnv',
      detalleExtra: 'TELNYX_API_KEY',
      usdMes: null,
    }
  }

  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  try {
    // `page[size]=1`: sólo interesa el total, que Telnyx devuelve en `meta`.
    const res = await fetch('https://api.telnyx.com/v2/phone_numbers?page[size]=1', {
      headers: { authorization: `Bearer ${key}` },
      signal: ctrl.signal,
      cache: 'no-store',
    })
    if (!res.ok) {
      return {
        ...base,
        detalleKey: 'admin.fixedNoAnswerHttp',
        detalleExtra: String(res.status),
        usdMes: null,
      }
    }
    const j = (await res.json()) as { meta?: { total_results?: number } }
    const total = Number(j?.meta?.total_results ?? 0)
    return { ...base, detalleExtra: String(total), usdMes: total }
  } catch {
    return { ...base, detalleKey: 'admin.fixedNoAnswer', usdMes: null }
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
      id: 'dominios',
      nombre: 'riverz.co · riverzai.com',
      detalleKey: 'admin.fixedDomains',
      detalleExtra: null,
      usdMes: null,
      activo: true,
      url: 'https://www.spaceship.com/application/domain-list/',
    },
    {
      id: 'meta',
      nombre: 'WhatsApp (Meta)',
      detalleKey: 'admin.fixedWhatsapp',
      detalleExtra: null,
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
  const [render, supabase, telnyx] = await Promise.all([
    deRender(),
    deSupabase(),
    deTelnyx(),
  ])
  const items = [...render, supabase, telnyx, ...sinApi()]
  return {
    items,
    totalUsdMes: items.reduce((n, i) => n + (i.activo ? (i.usdMes ?? 0) : 0), 0),
    sinMedir: items.filter((i) => i.usdMes === null).length,
  }
}
