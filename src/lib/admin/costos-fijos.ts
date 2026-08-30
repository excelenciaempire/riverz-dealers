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
 * **Todo se agrupa por proyecto.** La misma cuenta de Render y la misma
 * organización de Supabase pagan cosas que no son el CRM: la suite de
 * riverzai.com, la contaduría, un radar. Sumados en un solo total, el panel
 * contestaba «Riverz cuesta 176» cuando el CRM cuesta 43 — y esa cifra es la
 * que decide si el precio de un plan cierra. Cada fila declara a qué proyecto
 * se le carga, y el CRM va aparte de todo lo demás.
 *
 * El texto viaja como CLAVE i18n, no como frase: esta pantalla se ve en español
 * y en inglés.
 */

/** El CRM: el producto que se vende. Va aparte de todo lo demás. */
export const PROYECTO_CRM = 'crm'
/** Lo que factura la cuenta entera y no se le puede cargar a un proyecto. */
export const PROYECTO_COMPARTIDO = 'compartido'

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
  /** A qué proyecto se le carga. Es la clave del grupo. */
  proyecto: string
}

export interface ProyectoFijo {
  id: string
  /** Nombre para mostrar cuando sale de una API (un repo, una base). */
  nombre: string
  /** Clave i18n, para los dos grupos que no tienen nombre propio. */
  nombreKey: string | null
  /** El CRM va primero y aparte: es el producto que se vende. */
  esCrm: boolean
  usdMes: number
  sinMedir: number
  items: CostoFijo[]
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

/** Disco persistente de Render, por GB al mes. */
const RENDER_DISCO_USD_GB = 0.25

const TIMEOUT_MS = 8000

/** Un mes de facturación, en horas: es como cotizan Render y Supabase. */
const HORAS_MES = 730

function conTimeout(): { signal: AbortSignal; done: () => void } {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  return { signal: ctrl.signal, done: () => clearTimeout(t) }
}

interface ServicioRender {
  id: string
  name: string
  type: string
  repo?: string
  suspended?: string
  serviceDetails?: { plan?: string; instanceType?: string }
}

interface DiscoRender {
  id: string
  sizeGB: number
  serviceId: string
}

/**
 * De qué proyecto es un servicio de Render: de su repo.
 *
 * No hay lista escrita a mano. El repo es el dato que ya distingue al CRM de
 * todo lo demás, y un servicio nuevo cae solo en el grupo correcto.
 */
function proyectoDeRepo(repo: string | undefined): string {
  const nombre = (repo ?? '').replace(/\.git$/, '').split('/').filter(Boolean).pop() ?? ''
  if (!nombre) return PROYECTO_COMPARTIDO
  return nombre === 'riverz-crm' ? PROYECTO_CRM : nombre
}

/** Los servicios de Render, con lo que cuesta cada uno y su disco. */
async function deRender(): Promise<CostoFijo[]> {
  const key = process.env.RENDER_API_KEY
  const url = 'https://dashboard.render.com/billing'
  const caido = (detalleKey: string, detalleExtra: string | null): CostoFijo[] => [
    {
      id: 'render',
      nombre: 'Render',
      detalleKey,
      detalleExtra,
      usdMes: null,
      activo: true,
      url,
      proyecto: PROYECTO_COMPARTIDO,
    },
  ]
  if (!key) return caido('admin.fixedMissingEnv', 'RENDER_API_KEY')

  const { signal, done } = conTimeout()
  try {
    const headers = { authorization: `Bearer ${key}` }
    // Los discos van en su propia llamada: se cobran aparte del plan y sin
    // ellos el total de Render queda corto sin que nada lo diga.
    const [res, resDiscos] = await Promise.all([
      fetch('https://api.render.com/v1/services?limit=50', { headers, signal, cache: 'no-store' }),
      fetch('https://api.render.com/v1/disks?limit=100', {
        headers,
        signal,
        cache: 'no-store',
      }).catch(() => null),
    ])
    if (!res.ok) return caido('admin.fixedNoAnswerHttp', String(res.status))

    const discos = new Map<string, number>()
    if (resDiscos?.ok) {
      const filas = (await resDiscos.json()) as { disk: DiscoRender }[]
      for (const { disk } of filas) {
        discos.set(disk.serviceId, (discos.get(disk.serviceId) ?? 0) + (disk.sizeGB ?? 0))
      }
    }

    const filas = (await res.json()) as { service: ServicioRender }[]
    return filas
      .map(({ service }) => {
        const plan = (service.serviceDetails?.plan ?? '').toLowerCase()
        const suspendido = service.suspended === 'suspended'
        // Un sitio estático no cuesta nada; el resto sale del plan.
        const base =
          service.type === 'static_site'
            ? 0
            : service.type === 'cron_job'
              ? 1
              : (PLAN_USD[plan] ?? null)
        const gb = discos.get(service.id) ?? 0
        const usd = base === null ? null : base + gb * RENDER_DISCO_USD_GB
        return {
          id: `render-${service.id}`,
          nombre: service.name,
          detalleKey: suspendido
            ? 'admin.fixedRenderSuspended'
            : gb > 0
              ? 'admin.fixedRenderPlanDisk'
              : 'admin.fixedRenderPlan',
          detalleExtra:
            gb > 0 && !suspendido
              ? `${plan || service.type} · ${gb} GB`
              : plan || service.type,
          usdMes: suspendido ? 0 : usd,
          activo: !suspendido,
          url,
          proyecto: proyectoDeRepo(service.repo),
        }
      })
      .sort((a, b) => (b.usdMes ?? 0) - (a.usdMes ?? 0))
  } catch {
    return caido('admin.fixedNoAnswer', null)
  } finally {
    done()
  }
}

/**
 * Lo que cuesta cada tamaño de instancia de Supabase, por hora.
 *
 * Es la misma lista que devuelve `/projects/{ref}/billing/addons`. Se deja acá
 * porque el precio por tamaño es público y estable, y pedirlo obligaría a una
 * llamada más por cada carga de una pantalla que ya consulta once APIs.
 */
const COMPUTE_USD_HORA: Record<string, number> = {
  micro: 0.01344,
  small: 0.0206,
  medium: 0.0822,
  large: 0.1517,
  xlarge: 0.2877,
}

const SUPABASE_USD: Record<string, number | null> = {
  free: 0,
  pro: 25,
  team: 599,
  enterprise: null,
}

/** Crédito de compute incluido en el plan. Alcanza para una Micro. */
const SUPABASE_CREDITO_USD: Record<string, number> = { pro: 10, team: 10 }

interface ProyectoSupabase {
  name: string
  ref: string
  databases?: { infra_compute_size?: string }[]
}

/**
 * Supabase: el plan de la organización MÁS el compute de cada proyecto.
 *
 * Antes acá había una sola fila con el precio de lista del plan. Eso mentía por
 * la mitad: el Pro son 25 USD, pero la factura de agosto de 2026 fue 48,51 —
 * cada proyecto paga su propia instancia (Micro 10, Small 15) y el plan sólo
 * regala 10 de crédito. Con tres proyectos en la misma organización, lo que no
 * se veía era más que lo que se veía.
 */
async function deSupabase(): Promise<CostoFijo[]> {
  const url = 'https://supabase.com/dashboard/org/_/billing'
  const base = {
    id: 'supabase',
    nombre: 'Supabase',
    detalleKey: 'admin.fixedSupabase',
    detalleExtra: null as string | null,
    activo: true,
    url,
    proyecto: PROYECTO_COMPARTIDO,
  }
  const token = process.env.SUPABASE_ACCESS_TOKEN
  const ref = process.env.NEXT_PUBLIC_SUPABASE_URL?.match(/https:\/\/([^.]+)\./)?.[1]
  if (!token || !ref) {
    return [
      {
        ...base,
        detalleKey: 'admin.fixedMissingEnv',
        detalleExtra: 'SUPABASE_ACCESS_TOKEN',
        usdMes: null,
      },
    ]
  }

  const { signal, done } = conTimeout()
  try {
    const cabeceras = {
      authorization: `Bearer ${token}`,
      // Cloudflare rechaza el User-Agent por defecto de fetch en este host.
      'user-agent': 'Mozilla/5.0',
    }
    const pedir = async (ruta: string) => {
      const r = await fetch(`https://api.supabase.com/v1${ruta}`, {
        headers: cabeceras,
        signal,
        cache: 'no-store',
      })
      return r.ok ? r.json() : null
    }

    const proy = (await pedir(`/projects/${ref}`)) as { organization_id?: string } | null
    const orgId = proy?.organization_id
    if (!orgId) return [{ ...base, usdMes: null }]

    const [org, lista] = (await Promise.all([
      pedir(`/organizations/${orgId}`),
      pedir(`/organizations/${orgId}/projects`),
    ])) as [{ plan?: string } | null, { projects?: ProyectoSupabase[] } | null]

    const plan = org?.plan ?? ''
    const credito = SUPABASE_CREDITO_USD[plan] ?? 0
    const planUsd = SUPABASE_USD[plan] ?? null

    // El plan y su crédito son de la cuenta entera: no se le pueden cargar a un
    // proyecto sin inventar un reparto. Van a «compartido», ya netos.
    const filas: CostoFijo[] = [
      {
        ...base,
        detalleKey: plan ? 'admin.fixedSupabasePlanNet' : 'admin.fixedSupabase',
        detalleExtra: plan || null,
        usdMes: planUsd === null ? null : planUsd - credito,
      },
    ]

    for (const p of lista?.projects ?? []) {
      const tam = (p.databases?.[0]?.infra_compute_size ?? '').toLowerCase()
      // `nano` es el tamaño gratis. En un plan pago Supabase lo factura como
      // Micro —la factura de agosto lo dice: «unified-inbox (Micro Compute)»—
      // aunque la API siga reportando el hardware viejo hasta un reinicio.
      const facturado = tam === 'nano' ? 'micro' : tam
      const tarifa = plan === 'free' ? 0 : (COMPUTE_USD_HORA[facturado] ?? null)
      filas.push({
        id: `supabase-${p.ref}`,
        nombre: p.name,
        detalleKey: 'admin.fixedSupabaseCompute',
        detalleExtra: facturado || '—',
        usdMes: tarifa === null ? null : Math.round(tarifa * HORAS_MES * 100) / 100,
        activo: true,
        url: `https://supabase.com/dashboard/project/${p.ref}/settings/compute-and-disk`,
        proyecto: p.ref === ref ? PROYECTO_CRM : p.name,
      })
    }
    return filas
  } catch {
    return [{ ...base, usdMes: null }]
  } finally {
    done()
  }
}

/**
 * Los números de teléfono alquilados en Telnyx.
 *
 * Son el único fijo que CRECE sin que nadie lo decida: cada cuenta se compra el
 * suyo desde /voz, así que el mes que viene puede costar más que este sin que
 * se haya tocado nada. Un dólar por número es el piso de Telnyx — los
 * internacionales y los toll-free salen más, así que este total es un mínimo,
 * igual que el resto de la pantalla.
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
    // Los números son del CRM: los compran los comercios para las llamadas.
    proyecto: PROYECTO_CRM,
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

  const { signal, done } = conTimeout()
  try {
    // `page[size]=1`: sólo interesa el total, que Telnyx devuelve en `meta`.
    const res = await fetch('https://api.telnyx.com/v2/phone_numbers?page[size]=1', {
      headers: { authorization: `Bearer ${key}` },
      signal,
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
    done()
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
      id: 'dominio-crm',
      nombre: 'riverz.co',
      detalleKey: 'admin.fixedDomains',
      detalleExtra: null,
      usdMes: null,
      activo: true,
      url: 'https://www.spaceship.com/application/domain-list/',
      proyecto: PROYECTO_CRM,
    },
    {
      id: 'dominio-editorial',
      nombre: 'riverzai.com',
      detalleKey: 'admin.fixedDomains',
      detalleExtra: null,
      usdMes: null,
      activo: true,
      url: 'https://www.spaceship.com/application/domain-list/',
      proyecto: 'riverz',
    },
    {
      id: 'meta',
      nombre: 'WhatsApp (Meta)',
      detalleKey: 'admin.fixedWhatsapp',
      detalleExtra: null,
      usdMes: null,
      activo: true,
      url: 'https://business.facebook.com/billing_hub/accounts',
      proyecto: PROYECTO_CRM,
    },
  ]
}

export interface Fijos {
  items: CostoFijo[]
  /** Agrupado por proyecto. El CRM primero, después el resto por costo. */
  proyectos: ProyectoFijo[]
  /** Lo que cuesta sólo el CRM: el producto que se vende. */
  crmUsdMes: number
  /** Todo lo demás que factura la misma cuenta. */
  otrosUsdMes: number
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
  // Una base de Supabase y los servicios que la usan son el mismo proyecto,
  // pero cada API los nombra distinto: Render por su repo, Supabase por el
  // nombre de la base. Cuando coinciden —la base `contaduria` y el servicio
  // `contaduria`— se juntan; si no, la base queda como su propio grupo, que es
  // preferible a inventar un reparto. Renombrar la base en Supabase para que
  // coincida con el repo es lo que las une.
  const grupoDeServicio = new Map(render.map((r) => [r.nombre.toLowerCase(), r.proyecto]))
  const items = [...render, ...supabase, telnyx, ...sinApi()].map((i) => {
    if (i.proyecto === PROYECTO_CRM || i.proyecto === PROYECTO_COMPARTIDO) return i
    const g = grupoDeServicio.get(i.proyecto.toLowerCase())
    return g && g !== i.proyecto ? { ...i, proyecto: g } : i
  })

  const porId = new Map<string, ProyectoFijo>()
  for (const i of items) {
    let g = porId.get(i.proyecto)
    if (!g) {
      g = {
        id: i.proyecto,
        nombre: i.proyecto,
        nombreKey:
          i.proyecto === PROYECTO_CRM
            ? 'admin.fixedProjectCrm'
            : i.proyecto === PROYECTO_COMPARTIDO
              ? 'admin.fixedProjectShared'
              : null,
        esCrm: i.proyecto === PROYECTO_CRM,
        usdMes: 0,
        sinMedir: 0,
        items: [],
      }
      porId.set(i.proyecto, g)
    }
    g.items.push(i)
    if (i.activo) g.usdMes += i.usdMes ?? 0
    if (i.usdMes === null) g.sinMedir += 1
  }

  const proyectos = [...porId.values()]
    .map((g) => ({ ...g, usdMes: Math.round(g.usdMes * 100) / 100 }))
    // El CRM arriba de todo; el resto por lo que cuesta.
    .sort((a, b) => (a.esCrm ? -1 : b.esCrm ? 1 : b.usdMes - a.usdMes))

  const crmUsdMes = proyectos.find((p) => p.esCrm)?.usdMes ?? 0
  const totalUsdMes = Math.round(proyectos.reduce((n, p) => n + p.usdMes, 0) * 100) / 100

  return {
    items,
    proyectos,
    crmUsdMes,
    otrosUsdMes: Math.round((totalUsdMes - crmUsdMes) * 100) / 100,
    totalUsdMes,
    sinMedir: items.filter((i) => i.usdMes === null).length,
  }
}

/**
 * La misma lectura, compartida por la ronda de proveedores y por la Caja.
 *
 * Sale a preguntarle a los tableros de Render, Supabase y Telnyx, así que dos
 * llamadores son dos rondas de consultas a terceros por un dato que cambia una
 * vez al mes. Es el mismo error que ya se resolvió una vez mudando la caché de
 * la ruta a la librería en `proveedores.ts`; no se repite.
 *
 * Cinco minutos y no cincuenta y cinco segundos: un plan de Render no cambia
 * mientras alguien mira la pantalla.
 */
const CACHE_TTL_MS = 5 * 60_000

let cache: { at: number; data: Fijos } | null = null
let enVuelo: Promise<Fijos> | null = null

export async function leerCostosFijosConCache(): Promise<Fijos> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.data
  if (enVuelo) return enVuelo

  enVuelo = leerCostosFijos()
    .then((data) => {
      cache = { at: Date.now(), data }
      return data
    })
    .finally(() => {
      enVuelo = null
    })

  return enVuelo
}
