/**
 * Qué hay construido en esta cuenta.
 *
 * El equipo tiene que entender la cuenta antes de tocarla, y "entender" acá
 * significa una cosa concreta: **nunca tener que adivinar qué existe**. Sin
 * esto, el subagente de automatizaciones propone crear la de carrito abandonado
 * que ya está creada, y el de plantillas escribe una nueva cuando había una
 * aprobada esperando — que además cuesta una semana de revisión de Meta.
 *
 * El mapa dice QUÉ EXISTE, no CÓMO ESTÁ. Es la diferencia entre mil doscientos
 * tokens y veinticinco mil: `plantillas.estado` sola son unos siete mil y
 * `pedidos.listar` unos diez mil, y meterlos crudos en cada llamada de cada
 * subagente multiplica ese costo por cada uno. Todo el detalle sigue estando a
 * una lectura de distancia, y esas lecturas ya son capacidades.
 *
 * Va DESPUÉS del corte de caché en el prompt del sistema: el prefijo (las
 * herramientas, las instrucciones, el roster) es idéntico entre comercios y
 * entre turnos, así que se cachea para toda la plataforma. El mapa cambia por
 * cuenta, así que si fuera antes del corte no acertaría nunca.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { collectWorkspaceIssues, type Issue } from '@/lib/health/issues'

/** Cuántos nombres se listan por dominio antes de cortar con "+N más". */
const TOPES = {
  plantillas: 40,
  etiquetas: 40,
  segmentos: 20,
  automatizaciones: 30,
  agentes: 20,
} as const

/** Cuánto vive el mapa antes de volver a pedirlo. */
const CACHE_MS = 60_000

export interface MapaCuenta {
  /** Qué hay y cuánto de eso está prendido. */
  dominios: { id: string; hay: number; activos?: number }[]
  /** Lo que está roto o frenado ahora mismo. */
  problemas: Issue[]
  canales: { canal: string; estado: string }[]
  /** Sólo nombres: son lo que el equipo necesita para no inventar. */
  nombres: {
    plantillas: string[]
    etiquetas: string[]
    segmentos: string[]
    automatizaciones: string[]
    agentes: string[]
  }
  generadoEn: string
}

const cache = new Map<string, { en: number; mapa: MapaCuenta }>()

/** Se llama cuando algo del equipo cambió la cuenta: el mapa quedó viejo. */
export function invalidarMapa(workspaceId: string): void {
  cache.delete(workspaceId)
}

/**
 * Arma el mapa. Catorce consultas baratas en paralelo.
 *
 * Los conteos van con `head: true`, que pide el número y no trae ni una fila:
 * de otro modo contar los pedidos de una cuenta grande sería traer los pedidos.
 */
export async function cargarMapa(
  db: SupabaseClient,
  workspaceId: string,
): Promise<MapaCuenta> {
  const guardado = cache.get(workspaceId)
  if (guardado && Date.now() - guardado.en < CACHE_MS) return guardado.mapa

  const cuenta = async (tabla: string, extra?: (q: Contable) => Contable) => {
    let q = db.from(tabla).select('id', { count: 'exact', head: true }).eq('workspace_id', workspaceId)
    if (extra) q = extra(q as unknown as Contable) as never
    const { count } = await (q as unknown as Promise<{ count: number | null }>)
    return count ?? 0
  }

  const nombresDe = async (
    tabla: string,
    columna: string,
    tope: number,
    extra?: (q: Nombrable) => Nombrable,
  ) => {
    let q = db
      .from(tabla)
      .select(columna)
      .eq('workspace_id', workspaceId)
      .limit(tope + 1)
    if (extra) q = extra(q as unknown as Nombrable) as never
    const { data } = await (q as unknown as Promise<{ data: Record<string, string>[] | null }>)
    return (data ?? []).map((r) => r[columna]).filter(Boolean)
  }

  const [
    problemas,
    canales,
    autos,
    autosActivas,
    flujos,
    plantillas,
    campanas,
    productos,
    contactos,
    agentes,
    agentesActivos,
    nombresPlantillas,
    nombresEtiquetas,
    nombresSegmentos,
    nombresAutos,
    nombresAgentes,
  ] = await Promise.all([
    collectWorkspaceIssues(db, workspaceId).catch(() => [] as Issue[]),
    (async () => {
      try {
        const { data } = await db
          .from('channel_connections')
          .select('channel, status')
          .eq('workspace_id', workspaceId)
        return (data ?? []) as { channel: string; status: string }[]
      } catch {
        // Un mapa sin canales sigue sirviendo; sin mapa, el turno se cae.
        return []
      }
    })(),
    cuenta('automations'),
    cuenta('automations', (q) => q.eq('is_active', true)),
    cuenta('flows'),
    cuenta('message_templates'),
    cuenta('broadcasts'),
    cuenta('shopify_products'),
    cuenta('contacts'),
    cuenta('ai_agents'),
    cuenta('ai_agents', (q) => q.eq('is_active', true)),
    nombresDe('message_templates', 'name', TOPES.plantillas, (q) =>
      q.eq('status', 'Approved'),
    ),
    nombresDe('tags', 'name', TOPES.etiquetas),
    nombresDe('contact_segments', 'name', TOPES.segmentos),
    nombresDe('automations', 'name', TOPES.automatizaciones),
    nombresDe('ai_agents', 'name', TOPES.agentes),
  ])

  const mapa: MapaCuenta = {
    problemas,
    canales: canales.map((c) => ({ canal: c.channel, estado: c.status })),
    dominios: [
      { id: 'automatizaciones', hay: autos, activos: autosActivas },
      { id: 'flujos', hay: flujos },
      { id: 'plantillas', hay: plantillas },
      { id: 'campanas', hay: campanas },
      { id: 'productos', hay: productos },
      { id: 'contactos', hay: contactos },
      { id: 'agentes', hay: agentes, activos: agentesActivos },
    ],
    nombres: {
      plantillas: nombresPlantillas,
      etiquetas: nombresEtiquetas,
      segmentos: nombresSegmentos,
      automatizaciones: nombresAutos,
      agentes: nombresAgentes,
    },
    generadoEn: new Date().toISOString(),
  }

  cache.set(workspaceId, { en: Date.now(), mapa })
  return mapa
}

/**
 * El mapa como lo lee el modelo.
 *
 * En prosa corta y no en JSON: un objeto anidado gasta la mitad de sus tokens
 * en llaves y comillas, y el modelo lee igual de bien una lista.
 */
export function mapaComoTexto(m: MapaCuenta): string {
  const l: string[] = ['LO QUE HAY EN ESTA CUENTA']

  const conectados = m.canales.filter((c) => c.estado === 'connected').map((c) => c.canal)
  const rotos = m.canales.filter((c) => c.estado !== 'connected')
  l.push(`Canales conectados: ${conectados.join(', ') || 'ninguno'}`)
  if (rotos.length > 0) {
    l.push(`Canales con problema: ${rotos.map((c) => `${c.canal} (${c.estado})`).join(', ')}`)
  }

  for (const d of m.dominios) {
    const activos = d.activos === undefined ? '' : ` (${d.activos} ${d.activos === 1 ? 'activa' : 'activas'})`
    l.push(`${d.id}: ${d.hay}${activos}`)
  }

  const lista = (titulo: string, xs: string[], tope: number) => {
    if (xs.length === 0) return
    const muestra = xs.slice(0, tope)
    const resto = xs.length > tope ? ` +${xs.length - tope} más` : ''
    l.push(`${titulo}: ${muestra.join(', ')}${resto}`)
  }

  lista('Plantillas aprobadas', m.nombres.plantillas, TOPES.plantillas)
  lista('Etiquetas', m.nombres.etiquetas, TOPES.etiquetas)
  lista('Segmentos', m.nombres.segmentos, TOPES.segmentos)
  lista('Automatizaciones', m.nombres.automatizaciones, TOPES.automatizaciones)
  lista('Agentes', m.nombres.agentes, TOPES.agentes)

  if (m.problemas.length > 0) {
    l.push('NECESITA ATENCIÓN:')
    for (const p of m.problemas) l.push(`- [${p.severity}] ${p.detail}`)
  }

  l.push(
    'Esto es sólo qué existe. Para saber cómo está algo, usá la herramienta de lectura que corresponda.',
  )
  return l.join('\n')
}

// Los dos tipos de abajo existen sólo para que las consultas encadenadas no
// obliguen a repetir el genérico de PostgREST, que es enorme y no aporta nada
// acá: lo único que importa es que `eq` devuelva algo encadenable.
type Contable = { eq: (col: string, v: unknown) => Contable }
type Nombrable = { eq: (col: string, v: unknown) => Nombrable }
