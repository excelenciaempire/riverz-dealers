/**
 * A quién le hablamos.
 *
 * Es la capa que le faltaba a todo lo demás. Las campañas, las automatizaciones
 * y los agentes ya sabían MANDAR; lo que no había forma de pedir era "a quién":
 * la pantalla de Contactos consulta Supabase directo desde el navegador, así que
 * nada fuera de esa pantalla podía buscar gente, etiquetarla ni guardar un
 * criterio. Pedirle al chat "etiquetá a los que compraron dos veces" no fallaba
 * por el modelo — fallaba porque no existía dónde.
 *
 * Las reglas son las MISMAS que usa la pantalla de Segmentos (`SegmentRule`),
 * resueltas por el mismo `resolveSegment`. Un segmento guardado desde el chat y
 * uno guardado a mano son la misma fila y dan la misma gente: si acá hubiera un
 * dialecto propio, el mismo criterio daría dos listas distintas según quién lo
 * escribió.
 */
import { resolveSegment } from '@/lib/segments/resolve'
import type { SegmentMatchMode, SegmentRule } from '@/lib/segments/types'
import { applyTags, ensureTag } from '@/lib/contacts/tags'
import type { Artefacto } from '@/lib/operator/artifacts'
import type { Capability, CapabilityContext } from './types'

/** Cuántos contactos como mucho devuelve una búsqueda. */
const TOPE_BUSQUEDA = 50

/**
 * Etiquetar de a muchos deja de ser inofensivo.
 *
 * Poner una etiqueta no le llega a nadie: no manda mensajes, no sale a Meta y
 * se saca llamando de nuevo. Pero `tag_added` ES un disparador de
 * automatizaciones, así que la inocencia dura hasta que alguien conecte las dos
 * cosas — y ahí etiquetar cuatro mil contactos sería mandarles cuatro mil
 * mensajes sin que nadie lo haya pedido.
 *
 * Por eso la línea no es "etiquetar sí / etiquetar no" sino la escala: hasta
 * este número el comercio puede leer a quién le pasó y deshacerlo; más arriba
 * lo mira antes.
 */
const TOPE_INERTE = 25

// ---------------------------------------------------------------------------

/**
 * Las reglas se validan enteras o no se corre nada.
 *
 * `resolveSegment` saltea en silencio las reglas que no conoce, que es lo
 * correcto para una fila vieja guardada en la base. Acá no: si el modelo pide
 * "compradores recurrentes de Buenos Aires" y una de las dos reglas sale mal
 * escrita, saltearla devolvería TODOS los de Buenos Aires y nadie se enteraría.
 * Un error es mucho mejor que una lista de más.
 */
const TIPOS_VALIDOS = new Set([
  'tag',
  'channel',
  'created',
  'has_field',
  'text',
  'custom_field',
  'shopify',
  'offer',
  'units',
  'activity_date',
  'spend',
  'orders',
  'location',
])

interface ReglaEntrante {
  type?: unknown
  /** Sólo en reglas `tag`: el NOMBRE, que es lo que sabe quien pide. */
  tag?: unknown
  tagId?: unknown
  [k: string]: unknown
}

function leerReglas(valor: unknown): ReglaEntrante[] {
  if (!Array.isArray(valor)) {
    throw new Error('Faltan las reglas: mandá una lista con al menos un criterio.')
  }
  const reglas = valor as ReglaEntrante[]
  const raras = reglas
    .map((r) => (typeof r?.type === 'string' ? r.type : '(sin tipo)'))
    .filter((t) => !TIPOS_VALIDOS.has(t))
  if (raras.length > 0) {
    throw new Error(
      `No entiendo estos criterios: ${raras.join(', ')}. Los que valen son: ${[
        ...TIPOS_VALIDOS,
      ].join(', ')}.`,
    )
  }
  return reglas
}

/**
 * Cambia los nombres de etiqueta por ids reales.
 *
 * Quien escribe una regla conoce la etiqueta por su nombre ("comprador"), no
 * por su uuid. Y acá NO se crea la que falta, a diferencia de lo que pasa al
 * guardar una automatización: crear "comrador" porque venía mal escrita daría
 * un segmento vacío que parece un criterio legítimo con cero gente. Preferimos
 * decir cuáles existen.
 */
async function resolverIdsDeEtiqueta(
  ctx: CapabilityContext,
  reglas: ReglaEntrante[],
): Promise<SegmentRule[]> {
  const necesita = reglas.some((r) => r.type === 'tag' && typeof r.tag === 'string')
  if (!necesita) return reglas as unknown as SegmentRule[]

  const { data } = await ctx.db
    .from('tags')
    .select('id, name')
    .eq('workspace_id', ctx.workspaceId)
  const etiquetas = (data ?? []) as { id: string; name: string }[]
  const porNombre = new Map(etiquetas.map((t) => [t.name.trim().toLowerCase(), t.id]))

  return reglas.map((r) => {
    if (r.type !== 'tag' || typeof r.tag !== 'string') return r as unknown as SegmentRule
    const id = porNombre.get(r.tag.trim().toLowerCase())
    if (!id) {
      throw new Error(
        `No existe la etiqueta "${r.tag}". Las que hay: ${
          etiquetas.map((t) => t.name).join(', ') || '(ninguna)'
        }.`,
      )
    }
    const resto = { ...r }
    delete resto.tag
    return { ...resto, tagId: id } as unknown as SegmentRule
  })
}

/**
 * El camino de vuelta: ids por nombres.
 *
 * Un segmento guardado tiene `tagId` adentro, que es un uuid, y devolverlo tal
 * cual no sirve de nada: no se puede leer y no se puede volver a mandar en un
 * criterio escrito a mano. Sale en la MISMA forma que entra en
 * `segmentos.editar`, así que leer un segmento, cambiarle una regla y volver a
 * guardarlo es copiar y pegar.
 *
 * Una etiqueta borrada deja la regla huérfana: ahí se devuelve el `tagId` como
 * vino y `tag: null` en vez de inventarle un nombre. Inventarlo haría que el
 * siguiente guardado fallara buscando una etiqueta que no existe, y así al
 * menos se ve cuál es la regla rota.
 */
async function nombrarIdsDeEtiqueta(
  ctx: CapabilityContext,
  reglas: SegmentRule[],
): Promise<ReglaEntrante[]> {
  const entrantes = reglas as unknown as ReglaEntrante[]
  if (!entrantes.some((r) => r.type === 'tag' && typeof r.tagId === 'string')) {
    return entrantes
  }

  const { data } = await ctx.db
    .from('tags')
    .select('id, name')
    .eq('workspace_id', ctx.workspaceId)
  const porId = new Map(
    ((data ?? []) as { id: string; name: string }[]).map((t) => [t.id, t.name]),
  )

  return entrantes.map((r) => {
    if (r.type !== 'tag' || typeof r.tagId !== 'string') return r
    const nombre = porId.get(r.tagId) ?? null
    if (!nombre) return { ...r, tag: null }
    const resto = { ...r }
    delete resto.tagId
    return { ...resto, tag: nombre }
  })
}

interface FilaSegmento {
  id: string
  name: string
  description: string | null
  rules: SegmentRule[]
  match_mode: SegmentMatchMode
}

/**
 * El nombre del segmento, para el dibujo.
 *
 * `artifact` es síncrono a propósito —se calcula desde los argumentos, sin
 * tocar la base— pero el nombre vive en la base y los argumentos sólo traen el
 * id. Sin esto la tarjeta de una propuesta diría "Segmento" y quien aprueba no
 * sabría cuál está cambiando. Se llena en cualquier lectura de la fila, y el
 * `preview` hace una antes de que se dibuje nada; si igual no está, el dibujo
 * sale con el rótulo genérico y no se rompe.
 *
 * La clave lleva la cuenta adelante para que un proceso que atiende a varios
 * comercios no pueda mostrar el nombre de otro.
 */
const NOMBRES_DE_SEGMENTO = new Map<string, string>()

function recordarNombre(ctx: CapabilityContext, id: string, nombre: string) {
  // Es una ayuda de dibujo, no una caché de datos: cuando crece se tira entera.
  if (NOMBRES_DE_SEGMENTO.size > 200) NOMBRES_DE_SEGMENTO.clear()
  NOMBRES_DE_SEGMENTO.set(`${ctx.workspaceId}:${id}`, nombre)
}

async function leerSegmento(ctx: CapabilityContext, id: unknown): Promise<FilaSegmento> {
  const limpio = typeof id === 'string' ? id.trim() : ''
  if (!limpio) throw new Error('Falta el id del segmento.')
  const { data } = await ctx.db
    .from('contact_segments')
    .select('id, name, description, rules, match_mode')
    .eq('workspace_id', ctx.workspaceId)
    .eq('id', limpio)
    .maybeSingle()
  if (!data) throw new Error('Ese segmento no existe en esta cuenta.')
  const fila = data as FilaSegmento
  recordarNombre(ctx, fila.id, fila.name)
  return fila
}

/** El segmento como quedó guardado, con sus etiquetas ya nombradas. */
export async function artefactoGuardadoDeSegmento(
  ctx: CapabilityContext,
  segmentoId: string,
): Promise<Artefacto | null> {
  const fila = await leerSegmento(ctx, segmentoId).catch(() => null)
  if (!fila) return null
  return artefactoDeSegmento(
    fila.id,
    fila.name,
    await nombrarIdsDeEtiqueta(ctx, fila.rules ?? []),
  )
}

// ---------------------------------------------------------------------------

/** Cómo se lee cada operador cuando lo mira una persona. */
const OPERADORES: Record<string, string> = {
  has: 'tiene',
  not_has: 'no tiene',
  is: 'es',
  is_not: 'no es',
  eq: 'igual a',
  gte: 'al menos',
  lte: 'como mucho',
  between: 'entre',
  contains: 'contiene',
  equals: 'es igual a',
  not_equals: 'no es igual a',
  starts_with: 'empieza con',
  present: 'tiene',
  missing: 'no tiene',
  last_n_days: 'en los últimos',
  before: 'antes de',
  after: 'después de',
  is_customer: 'sí',
  is_not_customer: 'no',
  any: 'cualquiera',
}

const CAMPOS: Record<string, string> = {
  tag: 'etiqueta',
  channel: 'canal',
  created: 'alta',
  custom_field: 'campo propio',
  shopify: 'cliente de la tienda',
  offer: 'oferta',
  units: 'unidades',
  spend: 'gasto',
  orders: 'pedidos',
  email: 'email',
  phone: 'teléfono',
  company: 'empresa',
  name: 'nombre',
  country: 'país',
  city: 'ciudad',
  last_purchase: 'última compra',
  last_activity: 'última actividad',
  last_ai: 'última conversación con la IA',
}

/**
 * Una regla, en tres pedazos dibujables.
 *
 * El diff del artefacto empareja reglas por `campo|op|valor`, así que las dos
 * puntas —lo que hay guardado y lo que se pide— tienen que describirse con esta
 * misma función o cada regla aparecería una vez como quitada y otra como nueva.
 * Por eso el nombre de la etiqueta se compara en minúsculas: `resolverIdsDeEtiqueta`
 * ya empareja sin distinguir mayúsculas, y sin bajarlas acá pedir "Comprador"
 * sobre un segmento que decía "comprador" se vería como un cambio que no existe.
 */
function describirRegla(r: ReglaEntrante): { campo: string; op: string; valor: string } {
  const tipo = String(r.type ?? '')
  const op = String(r.op ?? '')
  const campoBase = typeof r.field === 'string' ? r.field : tipo
  const campo = CAMPOS[campoBase] ?? campoBase

  let valor = ''
  if (tipo === 'tag') {
    valor = String(r.tag ?? r.tagId ?? '')
      .trim()
      .toLowerCase()
  } else if (tipo === 'channel') {
    valor = String(r.channel ?? '')
  } else if (op === 'between') {
    valor = `${r.value} y ${r.value2}`
  } else if (op === 'last_n_days') {
    valor = `${r.value} días`
  } else if (r.value != null) {
    valor = String(r.value)
  }

  return { campo, op: OPERADORES[op] ?? op, valor }
}

function artefactoDeSegmento(
  id: string,
  nombre: string,
  reglas: ReglaEntrante[],
  alcance?: number,
): Artefacto {
  return {
    kind: 'segmento',
    nombre,
    alcance,
    reglas: reglas.map(describirRegla),
    base: { id, nombre },
  }
}

/** El público de una llamada: por ids sueltos, por segmento guardado o por reglas. */
async function resolverPublico(
  ctx: CapabilityContext,
  args: Record<string, unknown>,
): Promise<{ ids: string[]; total: number; de: string }> {
  if (Array.isArray(args.contactos) && args.contactos.length > 0) {
    const ids = (args.contactos as unknown[]).filter(
      (x): x is string => typeof x === 'string',
    )
    return { ids, total: ids.length, de: `${ids.length} contactos elegidos` }
  }

  let reglas: SegmentRule[]
  let modo: SegmentMatchMode
  let de: string

  if (typeof args.segmento_id === 'string') {
    const fila = await leerSegmento(ctx, args.segmento_id)
    reglas = fila.rules ?? []
    modo = fila.match_mode ?? 'all'
    de = `el segmento "${fila.name}"`
  } else {
    reglas = await resolverIdsDeEtiqueta(ctx, leerReglas(args.reglas))
    modo = args.modo === 'any' ? 'any' : 'all'
    de = `${reglas.length} ${reglas.length === 1 ? 'criterio' : 'criterios'}`
  }

  const { contacts } = await resolveSegment(ctx.db, ctx.workspaceId, reglas, modo)
  return { ids: contacts.map((c) => c.id), total: contacts.length, de }
}

// ---------------------------------------------------------------------------

const ESQUEMA_PUBLICO = {
  contactos: {
    type: 'array',
    items: { type: 'string' },
    description: 'Ids concretos. Excluyente con segmento_id y reglas.',
  },
  segmento_id: { type: 'string', description: 'Un segmento ya guardado.' },
  reglas: {
    type: 'array',
    items: { type: 'object' },
    description:
      'Criterios, como los de la pantalla de Segmentos. Cada uno es un objeto con `type` y sus campos. ' +
      'tag: {type:"tag", op:"has"|"not_has", tag:"nombre de la etiqueta"}. ' +
      'channel: {type:"channel", op:"is"|"is_not", channel:"whatsapp"|"instagram"|…}. ' +
      'created: {type:"created", op:"last_n_days"|"before"|"after", value:"30" o "2026-01-31"}. ' +
      'shopify: {type:"shopify", op:"is_customer"|"is_not_customer"}. ' +
      'orders (cantidad de pedidos): {type:"orders", op:"eq"|"gte"|"lte"|"between", value:2, value2?:5}. ' +
      'spend (gasto total): {type:"spend", op:"gte"|"lte"|"between", value:10000, value2?:50000}. ' +
      'location: {type:"location", field:"country"|"city", op:"is"|"contains", value:"Argentina"}. ' +
      'activity_date: {type:"activity_date", field:"last_purchase"|"last_activity"|"last_ai", op:"last_n_days"|"before"|"after", value:"90"}. ' +
      'has_field: {type:"has_field", field:"email"|"phone"|"company"|"name", op:"present"|"missing"}. ' +
      'text: {type:"text", field:"name"|"email"|"phone"|"company", op:"contains"|"equals"|"starts_with", value:"…"}.',
  },
  modo: {
    type: 'string',
    enum: ['all', 'any'],
    description: 'all = cumplen todos los criterios (por defecto). any = alguno.',
  },
} as const

// ---------------------------------------------------------------------------

async function buscar(ctx: CapabilityContext, args: Record<string, unknown>) {
  const texto = typeof args.texto === 'string' ? args.texto.trim() : ''
  const limite = Math.min(Number(args.limite) || 20, TOPE_BUSQUEDA)

  let q = ctx.db
    .from('contacts')
    .select('id, name, phone, email, channel, created_at, shopify_customer_data')
    .eq('workspace_id', ctx.workspaceId)
    .order('created_at', { ascending: false })
    .limit(limite)

  if (texto) {
    // Comillas dobles escapadas: un nombre con coma partiría el `or` de
    // PostgREST en filtros que no existen y la búsqueda fallaría entera.
    const t = texto.replace(/[",]/g, ' ')
    q = q.or(`name.ilike."%${t}%",phone.ilike."%${t}%",email.ilike."%${t}%"`)
  }

  const { data, error } = await q
  if (error) throw new Error(error.message)

  return {
    contactos: (data ?? []).map((c) => {
      const fila = c as {
        id: string
        name: string | null
        phone: string | null
        email: string | null
        channel: string | null
        created_at: string
        shopify_customer_data: { orders_count?: number; total_spent?: string } | null
      }
      return {
        id: fila.id,
        nombre: fila.name,
        telefono: fila.phone,
        email: fila.email,
        canal: fila.channel,
        desde: fila.created_at,
        pedidos: fila.shopify_customer_data?.orders_count ?? null,
        gastado: fila.shopify_customer_data?.total_spent ?? null,
      }
    }),
  }
}

async function listarEtiquetas(ctx: CapabilityContext) {
  const { data } = await ctx.db
    .from('tags')
    .select('id, name, color')
    .eq('workspace_id', ctx.workspaceId)
    .order('name')
  return { etiquetas: (data ?? []) as { id: string; name: string; color: string }[] }
}

async function listarSegmentos(ctx: CapabilityContext) {
  const { data } = await ctx.db
    .from('contact_segments')
    .select('id, name, description, rules, match_mode, updated_at')
    .eq('workspace_id', ctx.workspaceId)
    .order('updated_at', { ascending: false })
  return {
    segmentos: (data ?? []).map((s) => {
      const fila = s as {
        id: string
        name: string
        description: string | null
        rules: SegmentRule[]
        match_mode: string
        updated_at: string
      }
      return {
        id: fila.id,
        nombre: fila.name,
        descripcion: fila.description,
        criterios: (fila.rules ?? []).length,
        modo: fila.match_mode,
        actualizado: fila.updated_at,
      }
    }),
  }
}

async function reglasDeSegmento(ctx: CapabilityContext, args: Record<string, unknown>) {
  const fila = await leerSegmento(ctx, args.segmento_id)
  return {
    id: fila.id,
    nombre: fila.name,
    descripcion: fila.description,
    modo: fila.match_mode,
    reglas: await nombrarIdsDeEtiqueta(ctx, fila.rules ?? []),
  }
}

/**
 * La ficha de UNA persona, por id.
 *
 * `contactos.buscar` ya contesta "¿quién es este?" a partir de un teléfono o un
 * nombre, pero busca por texto: pasarle un uuid no encuentra nada. Y el id es
 * justamente lo único que devuelven `contactos.listar` y `segmentos.calcular`,
 * así que mirar a alguien que salió de una lista era imposible sin volver a
 * escribir su nombre a mano.
 */
async function detalle(ctx: CapabilityContext, args: Record<string, unknown>) {
  const id = typeof args.contacto_id === 'string' ? args.contacto_id.trim() : ''
  if (!id) throw new Error('Falta el id del contacto.')

  const { data } = await ctx.db
    .from('contacts')
    .select(
      'id, name, phone, email, company, channel, created_at, opted_out, opted_out_reason, last_inbound_at, last_product, last_offer_chosen, is_shopify_customer, shopify_customer_data',
    )
    .eq('workspace_id', ctx.workspaceId)
    .eq('id', id)
    .maybeSingle()
  if (!data) throw new Error('Ese contacto no existe en esta cuenta.')

  const c = data as {
    id: string
    name: string | null
    phone: string | null
    email: string | null
    company: string | null
    channel: string | null
    created_at: string
    opted_out: boolean | null
    opted_out_reason: string | null
    last_inbound_at: string | null
    last_product: string | null
    last_offer_chosen: string | null
    is_shopify_customer: boolean | null
    shopify_customer_data: {
      orders_count?: number
      total_spent?: number | string
      currency?: string
      last_order_date?: string | null
      default_address?: { city?: string | null; country?: string | null }
    } | null
  }

  const { data: filas } = await ctx.db
    .from('contact_tags')
    .select('tags(name)')
    .eq('contact_id', c.id)
  const etiquetas = ((filas ?? []) as unknown as Array<{
    tags: { name: string } | { name: string }[] | null
  }>)
    .map((f) => (Array.isArray(f.tags) ? f.tags[0] : f.tags))
    .filter((t): t is { name: string } => Boolean(t))
    .map((t) => t.name)

  // Lo que la bandeja muestra en la columna de la derecha y el chat no veía:
  // las notas que dejó el equipo, quién es en Instagram, qué compró de verdad
  // (no lo que dice Shopify de memoria) y los campos que inventó el comercio.
  const [notas, ig, compras, personalizados] = await Promise.all([
    ctx.db
      .from('contact_notes')
      .select('note_text, created_at')
      .eq('contact_id', c.id)
      .order('created_at', { ascending: false })
      .limit(10),
    ctx.db
      .from('contact_ig_profile')
      .select('follower_count, is_verified, follows_business, persona_hint')
      .eq('contact_id', c.id)
      .maybeSingle(),
    ctx.db
      .from('contact_purchases')
      .select('order_number, placed_at, total, currency, financial_status, fulfillment_status, platform')
      .eq('contact_id', c.id)
      .order('placed_at', { ascending: false })
      .limit(10),
    ctx.db
      .from('contact_custom_values')
      .select('value, custom_fields(field_name)')
      .eq('contact_id', c.id),
  ])

  const perfilIg = ig.data as {
    follower_count: number | null
    is_verified: boolean | null
    follows_business: boolean | null
    persona_hint: string | null
  } | null

  const campos: Record<string, string> = {}
  for (const f of (personalizados.data ?? []) as unknown as Array<{
    value: string | null
    custom_fields: { field_name: string } | { field_name: string }[] | null
  }>) {
    const campo = Array.isArray(f.custom_fields) ? f.custom_fields[0] : f.custom_fields
    if (campo?.field_name) campos[campo.field_name] = f.value ?? ''
  }

  const shop = c.shopify_customer_data
  const direccion = shop?.default_address
  return {
    id: c.id,
    nombre: c.name,
    telefono: c.phone,
    email: c.email,
    empresa: c.company,
    canal: c.channel,
    desde: c.created_at,
    etiquetas,
    // Lo primero que hay que mirar antes de escribirle: una baja explica que no
    // le llegue nada.
    dado_de_baja: c.opted_out === true,
    motivo_baja: c.opted_out_reason,
    ultimo_mensaje_suyo: c.last_inbound_at,
    cliente_de_la_tienda: c.is_shopify_customer === true,
    pedidos: shop?.orders_count ?? null,
    gastado: shop?.total_spent ?? null,
    moneda: shop?.currency ?? null,
    ultima_compra: shop?.last_order_date ?? null,
    ciudad: direccion?.city ?? null,
    pais: direccion?.country ?? null,
    ultimo_producto: c.last_product,
    ultima_oferta: c.last_offer_chosen,
    // Lo que escribió el equipo sobre esta persona. Es la memoria del negocio
    // y no estaba en ninguna respuesta.
    notas: (notas.data ?? []) as unknown[],
    instagram: perfilIg
      ? {
          seguidores: perfilIg.follower_count,
          verificada: perfilIg.is_verified === true,
          nos_sigue: perfilIg.follows_business === true,
          quien_es: perfilIg.persona_hint,
        }
      : null,
    // Las compras REALES traídas de la tienda, no el resumen que Shopify
    // guarda en el contacto.
    compras: (compras.data ?? []) as unknown[],
    campos: Object.keys(campos).length > 0 ? campos : null,
  }
}

async function anotar(ctx: CapabilityContext, args: Record<string, unknown>) {
  const id = String(args.contacto_id ?? '').trim()
  const texto = String(args.nota ?? '').trim()
  if (!id) throw new Error('Falta el id del contacto.')
  if (!texto) throw new Error('Falta la nota.')

  const { data: existe } = await ctx.db
    .from('contacts')
    .select('id, name')
    .eq('workspace_id', ctx.workspaceId)
    .eq('id', id)
    .maybeSingle()
  if (!existe) throw new Error('Ese contacto no existe en esta cuenta.')

  const { data, error } = await ctx.db
    .from('contact_notes')
    .insert({
      workspace_id: ctx.workspaceId,
      contact_id: id,
      note_text: texto,
      user_id: ctx.actor.type === 'operator' ? (ctx.actor.id ?? null) : null,
    })
    .select('id')
    .single()
  if (error) throw new Error(error.message)

  return {
    nota_id: (data as { id: string }).id,
    contacto: (existe as { name: string | null }).name,
    nota: texto,
  }
}

async function contar(ctx: CapabilityContext, args: Record<string, unknown>) {
  const { total, de } = await resolverPublico(ctx, args)
  return { cuantos: total, de }
}

async function etiquetar(ctx: CapabilityContext, args: Record<string, unknown>) {
  const nombre = typeof args.etiqueta === 'string' ? args.etiqueta.trim() : ''
  if (!nombre) throw new Error('Falta el nombre de la etiqueta.')
  const quitar = args.quitar === true

  const { ids, total, de } = await resolverPublico(ctx, args)
  if (ids.length === 0) return { etiqueta: nombre, alcanzados: 0, de }

  if (quitar) {
    const { data } = await ctx.db
      .from('tags')
      .select('id')
      .eq('workspace_id', ctx.workspaceId)
      .eq('name', nombre)
      .limit(1)
    const tagId = (data?.[0]?.id as string | undefined) ?? null
    if (!tagId) return { etiqueta: nombre, alcanzados: 0, de, nota: 'esa etiqueta no existe' }
    // De a pedazos: un `.in()` con miles de uuids revienta el largo de la URL
    // de PostgREST y borra sólo una parte, sin avisar.
    for (let i = 0; i < ids.length; i += 200) {
      await ctx.db
        .from('contact_tags')
        .delete()
        .eq('tag_id', tagId)
        .in('contact_id', ids.slice(i, i + 200))
    }
    return { etiqueta: nombre, quitada: true, alcanzados: total, de }
  }

  const tagId = await ensureTag(ctx.db, ctx.workspaceId, nombre)
  if (!tagId) throw new Error('No se pudo crear la etiqueta.')
  for (let i = 0; i < ids.length; i += 200) {
    await Promise.all(
      ids.slice(i, i + 200).map((id) => applyTags(ctx.db, id, [tagId])),
    )
  }
  return { etiqueta: nombre, alcanzados: total, de }
}

async function crearSegmento(ctx: CapabilityContext, args: Record<string, unknown>) {
  const nombre = typeof args.nombre === 'string' ? args.nombre.trim() : ''
  if (!nombre) throw new Error('Falta el nombre del segmento.')
  const reglas = await resolverIdsDeEtiqueta(ctx, leerReglas(args.reglas))
  const modo: SegmentMatchMode = args.modo === 'any' ? 'any' : 'all'

  // Se guarda con la cuenta ya hecha: un segmento que matchea cero gente casi
  // siempre es un criterio mal escrito, y verlo recién al lanzar la campaña es
  // tarde.
  const { contacts } = await resolveSegment(ctx.db, ctx.workspaceId, reglas, modo)

  const { data, error } = await ctx.db
    .from('contact_segments')
    .insert({
      workspace_id: ctx.workspaceId,
      name: nombre,
      description:
        typeof args.descripcion === 'string' ? args.descripcion.trim() || null : null,
      rules: reglas,
      match_mode: modo,
      created_by: ctx.actor.id ?? null,
    })
    .select('id')
    .single()
  if (error) throw new Error(error.message)

  return { id: (data as { id: string }).id, nombre, alcanza: contacts.length }
}

/**
 * Cambiarle los criterios a un segmento que ya existe.
 *
 * Las reglas se REEMPLAZAN enteras, no se suman: es lo mismo que hace la
 * pantalla al guardar, y sumar en silencio dejaría un criterio viejo que nadie
 * pidió achicando el público sin que se vea por qué. Para agregar una regla se
 * leen las que hay con `segmentos.reglas` y se manda la lista completa.
 */
async function editarSegmento(ctx: CapabilityContext, args: Record<string, unknown>) {
  const fila = await leerSegmento(ctx, args.segmento_id)
  const reglas = await resolverIdsDeEtiqueta(ctx, leerReglas(args.reglas))
  // Sin `modo` queda el que tenía. Caer a 'all' por defecto le cambiaría el OR
  // por un AND a un segmento que se armó con OR, sólo porque quien edita las
  // reglas no habló del tema.
  const modo: SegmentMatchMode =
    args.modo === 'any' ? 'any' : args.modo === 'all' ? 'all' : fila.match_mode

  const { contacts } = await resolveSegment(ctx.db, ctx.workspaceId, reglas, modo)

  const { error } = await ctx.db
    .from('contact_segments')
    .update({ rules: reglas, match_mode: modo })
    .eq('id', fila.id)
    .eq('workspace_id', ctx.workspaceId)
  if (error) throw new Error(error.message)

  return {
    id: fila.id,
    nombre: fila.name,
    criterios: reglas.length,
    modo,
    alcance: contacts.length,
  }
}

/** Una etiqueta de la cuenta, buscada por el nombre como lo escribe una persona. */
async function buscarEtiqueta(
  ctx: CapabilityContext,
  nombre: unknown,
): Promise<{ id: string; name: string }> {
  const buscado = typeof nombre === 'string' ? nombre.trim() : ''
  if (!buscado) throw new Error('Falta el nombre de la etiqueta.')

  const { data } = await ctx.db
    .from('tags')
    .select('id, name')
    .eq('workspace_id', ctx.workspaceId)
  const etiquetas = (data ?? []) as { id: string; name: string }[]

  const exacta = etiquetas.find((t) => t.name === buscado)
  if (exacta) return exacta

  // Ser tolerante con las mayúsculas ayuda a encontrarla; pero si hay dos que
  // se diferencian sólo en eso, elegir una sería borrar la que no era.
  const parecidas = etiquetas.filter(
    (t) => t.name.trim().toLowerCase() === buscado.toLowerCase(),
  )
  if (parecidas.length === 1) return parecidas[0]
  if (parecidas.length > 1) {
    throw new Error(
      `Hay ${parecidas.length} etiquetas con ese nombre y distintas mayúsculas. Escribí el nombre exacto: ${parecidas
        .map((t) => `"${t.name}"`)
        .join(', ')}.`,
    )
  }
  throw new Error(
    `No existe la etiqueta "${buscado}". Las que hay: ${
      etiquetas.map((t) => t.name).join(', ') || '(ninguna)'
    }.`,
  )
}

/**
 * Qué se queda sin esa etiqueta si se borra.
 *
 * Borrar una etiqueta no es borrar una palabra: `contact_tags` cae en cascada,
 * así que se va de todos los contactos de una sola vez, y lo que la nombraba
 * por id —un paso `add_tag`, un disparador `tag_added`, una condición
 * `tag_presence`, la regla de un segmento— queda apuntando a nada. Eso no falla
 * ruidosamente: la automatización sigue activa y deja de encontrar a nadie.
 */
async function usosDeEtiqueta(ctx: CapabilityContext, tagId: string) {
  type PasoConAutomatizacion = {
    automations: { id: string; name: string; deleted_at: string | null } | null
  }
  const pasosCon = (columna: string) =>
    ctx.db
      .from('automation_steps')
      .select('automations!inner(id, name, workspace_id, deleted_at)')
      .eq(columna, tagId)
      .eq('automations.workspace_id', ctx.workspaceId)

  const [contactos, pasos, condiciones, disparadores, segmentos] = await Promise.all([
    ctx.db
      .from('contact_tags')
      .select('id', { count: 'exact', head: true })
      .eq('tag_id', tagId),
    pasosCon('step_config->>tag_id'),
    pasosCon('step_config->>operand'),
    ctx.db
      .from('automations')
      .select('id, name, deleted_at')
      .eq('workspace_id', ctx.workspaceId)
      .eq('trigger_config->>tag_id', tagId),
    ctx.db
      .from('contact_segments')
      .select('name, rules')
      .eq('workspace_id', ctx.workspaceId),
  ])

  // La misma automatización puede nombrarla en el disparador y en dos pasos: se
  // cuenta una vez, que es como la ve el comercio.
  const automatizaciones = new Map<string, string>()
  const filasDePaso = [
    ...(pasos.data ?? []),
    ...(condiciones.data ?? []),
  ] as unknown as PasoConAutomatizacion[]
  for (const fila of filasDePaso) {
    const a = fila.automations
    if (a && !a.deleted_at) automatizaciones.set(a.id, a.name)
  }
  for (const a of (disparadores.data ?? []) as {
    id: string
    name: string
    deleted_at: string | null
  }[]) {
    if (!a.deleted_at) automatizaciones.set(a.id, a.name)
  }

  const conLaEtiqueta = ((segmentos.data ?? []) as { name: string; rules: SegmentRule[] }[])
    .filter((s) =>
      (s.rules ?? []).some((r) => (r as { tagId?: string }).tagId === tagId),
    )
    .map((s) => s.name)

  return {
    contactos: contactos.count ?? 0,
    automatizaciones: [...automatizaciones.values()],
    segmentos: conLaEtiqueta,
  }
}

async function crearEtiqueta(ctx: CapabilityContext, args: Record<string, unknown>) {
  const nombre = typeof args.nombre === 'string' ? args.nombre.trim() : ''
  if (!nombre) throw new Error('Falta el nombre de la etiqueta.')
  const color = typeof args.color === 'string' ? args.color.trim() : ''
  if (color && !/^#[0-9a-fA-F]{6}$/.test(color)) {
    throw new Error(`El color va en hexadecimal, como #10b981, y no "${color}".`)
  }

  // `ensureTag` busca antes de crear, así que no duplica nada; lo que se mira
  // acá es otra cosa: si ya existía hay que decirlo, porque contestar "la creé"
  // sobre una etiqueta que ya estaba es una respuesta falsa.
  const previa = await buscarEtiqueta(ctx, nombre).catch(() => null)
  const id = await ensureTag(ctx.db, ctx.workspaceId, nombre, {
    color: color || undefined,
  })
  if (!id) throw new Error('No se pudo crear la etiqueta.')

  return { id, etiqueta: nombre, ya_existia: previa !== null }
}

async function borrarEtiqueta(ctx: CapabilityContext, args: Record<string, unknown>) {
  const etiqueta = await buscarEtiqueta(ctx, args.etiqueta)
  // Se miran los usos ANTES del borrado: después de la cascada ya no hay forma
  // de saber a cuánta gente la tenía puesta.
  const usos = await usosDeEtiqueta(ctx, etiqueta.id)

  const { error } = await ctx.db
    .from('tags')
    .delete()
    .eq('id', etiqueta.id)
    .eq('workspace_id', ctx.workspaceId)
  if (error) throw new Error(error.message)

  return {
    etiqueta: etiqueta.name,
    borrada: true,
    contactos_afectados: usos.contactos,
    automatizaciones_afectadas: usos.automatizaciones,
    segmentos_afectados: usos.segmentos,
  }
}

// ---------------------------------------------------------------------------

export const CONTACT_CAPABILITIES: Capability[] = [
  {
    key: 'contactos.anotar',
    description:
      'Deja una nota sobre un contacto: lo que hay que saber la próxima vez que escriba. Es la memoria del negocio sobre esa persona y la lee cualquiera del equipo desde su ficha en la bandeja. No le llega al cliente.',
    descriptionEn:
      'Leaves a note on a contact: what to know the next time they write. It is the business memory about that person and anyone on the team reads it from their record in the inbox. The customer never sees it.',
    risk: 'reversible',
    // Es interna: no sale de la cuenta y no la ve ningún cliente.
    inerte: true,
    schema: {
      type: 'object',
      properties: {
        contacto_id: { type: 'string', description: 'El id que devuelve contactos.buscar.' },
        nota: { type: 'string' },
      },
      required: ['contacto_id', 'nota'],
    },
    async preview(ctx, args) {
      const { data } = await ctx.db
        .from('contacts')
        .select('name, phone')
        .eq('workspace_id', ctx.workspaceId)
        .eq('id', String(args.contacto_id ?? ''))
        .maybeSingle()
      const c = data as { name?: string | null; phone?: string | null } | null
      if (!c) throw new Error('Ese contacto no existe en esta cuenta.')
      return `Anotaría en la ficha de ${c.name ?? c.phone ?? 'ese contacto'}: "${String(args.nota ?? '')}". No le llega a la persona.`
    },
    run: anotar,
  },
  {
    key: 'contactos.listar',
    description:
      'Una LISTA de contactos, con cuántos pedidos hizo cada uno y cuánto gastó. Sin texto devuelve los últimos que entraron. Es para mirar de a varios; para la ficha completa de una persona están contactos.detalle (por id) y contactos.buscar (por teléfono, nombre o correo).',
    descriptionEn:
      "A LIST of contacts with each one's order count and lifetime spend. With no text, the most recent ones. For browsing several; for one person's full record use contactos.detalle (by id) or contactos.buscar (by phone, name or email).",
    risk: 'lectura',
    schema: {
      type: 'object',
      properties: {
        texto: { type: 'string', description: 'Nombre, teléfono o email, parcial.' },
        limite: { type: 'number', description: `Por defecto 20, máximo ${TOPE_BUSQUEDA}.` },
      },
    },
    run: buscar,
  },
  {
    key: 'contactos.detalle',
    description:
      'La ficha de UN contacto a partir de su id: etiquetas, canal, si pidió la baja, cuándo escribió por última vez, cuántos pedidos hizo, cuánto gastó y de dónde es. El id es el que devuelven contactos.listar y segmentos.calcular.',
    descriptionEn:
      "One contact's record from their id: tags, channel, whether they opted out, when they last wrote, how many orders they placed, lifetime spend and where they are from. The id is the one contactos.listar and segmentos.calcular return.",
    risk: 'lectura',
    schema: {
      type: 'object',
      properties: {
        contacto_id: { type: 'string', description: 'Id del contacto.' },
      },
      required: ['contacto_id'],
    },
    run: detalle,
  },
  {
    key: 'etiquetas.listar',
    description:
      'Las etiquetas que existen en la cuenta. Sirve para saber con qué nombres se puede segmentar antes de escribir un criterio.',
    descriptionEn:
      'The tags that exist in the account. Use it to learn which names segments can filter by before writing a rule.',
    risk: 'lectura',
    schema: { type: 'object', properties: {} },
    run: listarEtiquetas,
  },
  {
    key: 'segmentos.listar',
    description:
      'Los segmentos guardados: nombre, cuántos criterios tiene cada uno y cuándo se tocó por última vez. Para ver qué dice un segmento, segmentos.reglas.',
    descriptionEn:
      'Saved segments: name, how many rules each has, and when it was last touched. To see what a segment actually says, use segmentos.reglas.',
    risk: 'lectura',
    schema: { type: 'object', properties: {} },
    run: listarSegmentos,
  },
  {
    key: 'segmentos.reglas',
    description:
      'Los criterios de UN segmento, con el NOMBRE de cada etiqueta en vez de su id. Es lo que hay que leer antes de cambiar un segmento: vienen en la misma forma que espera segmentos.editar, así que agregar o sacar una regla es mandar esta lista con el cambio hecho.',
    descriptionEn:
      'The rules of ONE segment, with each tag NAME instead of its id. Read this before changing a segment: the rules come back in the exact shape segmentos.editar expects, so adding or removing one is sending this same list with the change applied.',
    risk: 'lectura',
    schema: {
      type: 'object',
      properties: {
        segmento_id: { type: 'string', description: 'Id del segmento, de segmentos.listar.' },
      },
      required: ['segmento_id'],
    },
    run: reglasDeSegmento,
  },
  {
    key: 'segmentos.calcular',
    description:
      'A cuánta gente alcanza un criterio, sin guardar nada. Es el paso previo obligado antes de lanzar una campaña: dice si el público es el que se esperaba o si el criterio quedó mal escrito.',
    descriptionEn:
      'How many people a rule set reaches, without saving anything. The mandatory step before launching a campaign: it says whether the audience is the expected one.',
    risk: 'lectura',
    schema: { type: 'object', properties: { ...ESQUEMA_PUBLICO } },
    run: contar,
  },
  {
    key: 'contactos.etiquetar',
    description:
      'Le pone (o le saca) una etiqueta a un conjunto de contactos: a ids concretos, a un segmento guardado o a los que cumplan unos criterios. La etiqueta se crea si no existe. Se deshace llamando de nuevo con quitar=true.',
    descriptionEn:
      'Adds (or removes) a tag on a set of contacts: explicit ids, a saved segment, or whoever matches a rule set. The tag is created if missing. Undo by calling again with quitar=true.',
    risk: 'reversible',
    // Ver TOPE_INERTE: a poca gente se hace y se muestra; a mucha se pregunta.
    inerte: (args) =>
      Array.isArray((args as { contactos?: unknown[] }).contactos) &&
      ((args as { contactos: unknown[] }).contactos.length ?? 0) <= TOPE_INERTE,
    schema: {
      type: 'object',
      properties: {
        etiqueta: { type: 'string', description: 'Nombre de la etiqueta.' },
        quitar: { type: 'boolean', description: 'true para sacarla en vez de ponerla.' },
        ...ESQUEMA_PUBLICO,
      },
      required: ['etiqueta'],
    },
    async preview(ctx, args) {
      const nombre = typeof args.etiqueta === 'string' ? args.etiqueta : '(sin nombre)'
      const verbo = args.quitar === true ? 'Sacar' : 'Poner'
      try {
        const { total, de } = await resolverPublico(ctx, args)
        return `${verbo} la etiqueta "${nombre}" a ${total} ${
          total === 1 ? 'contacto' : 'contactos'
        } (${de})`
      } catch (e) {
        return `${verbo} la etiqueta "${nombre}" — ${(e as Error).message}`
      }
    },
    run: etiquetar,
  },
  {
    key: 'segmentos.crear',
    description:
      'Guarda un criterio con nombre para poder reusarlo en campañas y automatizaciones. Devuelve a cuánta gente alcanza: si da cero, el criterio está mal escrito.',
    descriptionEn:
      'Saves a rule set under a name so campaigns and automations can reuse it. Returns how many people it reaches: zero means the rules are wrong.',
    risk: 'reversible',
    // Guardar un criterio no le llega a nadie ni prende nada: es una fila que
    // después alguien elige a mano al armar una campaña.
    inerte: true,
    schema: {
      type: 'object',
      properties: {
        nombre: { type: 'string' },
        descripcion: { type: 'string' },
        reglas: ESQUEMA_PUBLICO.reglas,
        modo: ESQUEMA_PUBLICO.modo,
      },
      required: ['nombre', 'reglas'],
    },
    async preview(_ctx, args) {
      const n = Array.isArray(args.reglas) ? args.reglas.length : 0
      // En condicional como todas las demás: la tarjeta las lista juntas y una
      // en infinitivo entre nueve en condicional se lee como otra cosa.
      return `Guardaría el segmento «${args.nombre}» con ${n} ${
        n === 1 ? 'criterio' : 'criterios'
      }.`
    },
    artifact(_ctx, args, result) {
      let reglas: ReglaEntrante[]
      try {
        reglas = leerReglas(args.reglas)
      } catch {
        return null
      }
      const hecho = result as { id?: string; alcance?: number } | undefined
      return artefactoDeSegmento(
        hecho?.id ?? '',
        String(args.nombre ?? 'Segmento'),
        reglas,
        hecho?.alcance,
      )
    },
    run: crearSegmento,
  },
  {
    key: 'segmentos.editar',
    description:
      'Reemplaza los criterios de un segmento que ya existe. Las reglas van COMPLETAS: lo que no se manda se pierde, así que primero leelas con segmentos.reglas y mandá la lista entera con el cambio. Si no se manda el modo, queda el que tenía. Devuelve a cuánta gente alcanza después del cambio.',
    descriptionEn:
      'Replaces the rules of an existing segment. Rules are sent WHOLE: whatever is left out is dropped, so read them first with segmentos.reglas and send the full list with the change applied. Without an explicit mode, the current one stays. Returns how many people it reaches after the change.',
    risk: 'reversible',
    // Un segmento es un criterio guardado: cambiarlo no manda un mensaje ni
    // prende nada. Recién importa cuando una campaña lo usa, y lanzarla es otra
    // decisión con su propio click.
    inerte: true,
    schema: {
      type: 'object',
      properties: {
        segmento_id: { type: 'string', description: 'Id del segmento, de segmentos.listar.' },
        reglas: ESQUEMA_PUBLICO.reglas,
        modo: {
          type: 'string',
          enum: ['all', 'any'],
          description: 'Si no se manda, queda el que ya tenía el segmento.',
        },
      },
      required: ['segmento_id', 'reglas'],
    },
    async preview(ctx, args) {
      const fila = await leerSegmento(ctx, args.segmento_id).catch(() => null)
      if (!fila) throw new Error('Ese segmento no existe en esta cuenta.')
      try {
        const reglas = await resolverIdsDeEtiqueta(ctx, leerReglas(args.reglas))
        const modo: SegmentMatchMode =
          args.modo === 'any' ? 'any' : args.modo === 'all' ? 'all' : fila.match_mode
        const { contacts } = await resolveSegment(ctx.db, ctx.workspaceId, reglas, modo)
        const antes = (fila.rules ?? []).length
        return `«${fila.name}» queda con ${reglas.length} ${
          reglas.length === 1 ? 'criterio' : 'criterios'
        } (tenía ${antes}) y pasa a alcanzar a ${contacts.length} ${
          contacts.length === 1 ? 'contacto' : 'contactos'
        }.`
      } catch (e) {
        return `«${fila.name}» — ${(e as Error).message}`
      }
    },
    // El dibujo sale de los argumentos, con los nombres de etiqueta tal como
    // llegaron; `artifactBefore` traduce los ids guardados a esos mismos
    // nombres para que el diff marque sólo lo que de verdad se movió.
    artifact(ctx, args, result) {
      let reglas: ReglaEntrante[]
      try {
        reglas = leerReglas(args.reglas)
      } catch {
        return null
      }
      const id = typeof args.segmento_id === 'string' ? args.segmento_id : ''
      const hecho = result as { nombre?: string; alcance?: number } | undefined
      const nombre =
        hecho?.nombre ?? NOMBRES_DE_SEGMENTO.get(`${ctx.workspaceId}:${id}`) ?? 'Segmento'
      return artefactoDeSegmento(id, nombre, reglas, hecho?.alcance)
    },
    async artifactBefore(ctx, args) {
      const fila = await leerSegmento(ctx, args.segmento_id).catch(() => null)
      if (!fila) return null
      return artefactoDeSegmento(
        fila.id,
        fila.name,
        await nombrarIdsDeEtiqueta(ctx, fila.rules ?? []),
      )
    },
    run: editarSegmento,
  },
  {
    key: 'etiquetas.crear',
    description:
      'Crea una etiqueta vacía, para poder usarla después en un criterio, en una automatización o al etiquetar contactos. Si ya existe no la duplica: devuelve la que hay.',
    descriptionEn:
      'Creates an empty tag so it can be used later in a rule, in an automation or when tagging contacts. If it already exists it is not duplicated: the existing one is returned.',
    risk: 'reversible',
    // Una etiqueta recién creada no tiene a nadie adentro, así que no dispara
    // nada ni cambia ningún público. Empieza a importar cuando se usa.
    inerte: true,
    schema: {
      type: 'object',
      properties: {
        nombre: { type: 'string', description: 'Nombre de la etiqueta.' },
        color: { type: 'string', description: 'Hexadecimal, como #10b981. Opcional.' },
      },
      required: ['nombre'],
    },
    async preview(ctx, args) {
      const nombre = typeof args.nombre === 'string' ? args.nombre.trim() : '(sin nombre)'
      const previa = await buscarEtiqueta(ctx, args.nombre).catch(() => null)
      return previa
        ? `La etiqueta «${previa.name}» ya existe: no se crea de nuevo.`
        : `Crear la etiqueta «${nombre}», sin contactos adentro.`
    },
    run: crearEtiqueta,
  },
  {
    key: 'etiquetas.borrar',
    description:
      'Borra una etiqueta de la cuenta. La saca de TODOS los contactos que la tenían y deja apuntando a nada a los segmentos y automatizaciones que la usaban, que siguen activos y dejan de encontrar a nadie. No se deshace: volver atrás es etiquetar de nuevo uno por uno.',
    descriptionEn:
      'Deletes a tag from the account. It is removed from EVERY contact that had it and leaves the segments and automations that used it pointing at nothing — they stay active and stop matching anyone. It cannot be undone: going back means tagging everyone again.',
    risk: 'irreversible',
    schema: {
      type: 'object',
      properties: {
        etiqueta: { type: 'string', description: 'Nombre de la etiqueta a borrar.' },
      },
      required: ['etiqueta'],
    },
    async preview(ctx, args) {
      const etiqueta = await buscarEtiqueta(ctx, args.etiqueta).catch((e: Error) => e)
      if (etiqueta instanceof Error) return etiqueta.message

      const usos = await usosDeEtiqueta(ctx, etiqueta.id)
      const partes = [
        `Borrar «${etiqueta.name}» se la saca a ${usos.contactos} ${
          usos.contactos === 1 ? 'contacto' : 'contactos'
        }.`,
      ]
      // Lo que la nombra es lo que hay que ir a arreglar después, así que va en
      // el preview con nombre y apellido y no como un número.
      if (usos.automatizaciones.length > 0) {
        partes.push(
          `${usos.automatizaciones.length === 1 ? 'La usa' : 'La usan'} ${
            usos.automatizaciones.length
          } ${
            usos.automatizaciones.length === 1 ? 'automatización' : 'automatizaciones'
          } (${usos.automatizaciones.join(', ')}), que dejan de encontrarla.`,
        )
      }
      if (usos.segmentos.length > 0) {
        partes.push(`También la usan estos segmentos: ${usos.segmentos.join(', ')}.`)
      }
      if (usos.automatizaciones.length === 0 && usos.segmentos.length === 0) {
        partes.push('Ninguna automatización ni segmento la usa.')
      }
      partes.push('No se puede deshacer.')
      return partes.join(' ')
    },
    run: borrarEtiqueta,
  },
]
