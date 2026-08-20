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
    const { data } = await ctx.db
      .from('contact_segments')
      .select('name, rules, match_mode')
      .eq('workspace_id', ctx.workspaceId)
      .eq('id', args.segmento_id)
      .maybeSingle()
    if (!data) throw new Error('Ese segmento no existe en esta cuenta.')
    const fila = data as { name: string; rules: SegmentRule[]; match_mode: SegmentMatchMode }
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

// ---------------------------------------------------------------------------

export const CONTACT_CAPABILITIES: Capability[] = [
  {
    key: 'contactos.listar',
    description:
      'Una LISTA de contactos, con cuántos pedidos hizo cada uno y cuánto gastó. Sin texto devuelve los últimos que entraron. Es para mirar de a varios; para la ficha completa de una persona (etiquetas, baja, último mensaje) está contactos.buscar.',
    descriptionEn:
      'A LIST of contacts with each one\'s order count and lifetime spend. With no text, the most recent ones. For browsing several; for one person\'s full record (tags, opt-out, last message) use contactos.buscar.',
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
      'Los segmentos guardados: nombre, cuántos criterios tiene cada uno y cuándo se tocó por última vez.',
    descriptionEn:
      'Saved segments: name, how many rules each has, and when it was last touched.',
    risk: 'lectura',
    schema: { type: 'object', properties: {} },
    run: listarSegmentos,
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
      return `Guardar el segmento "${args.nombre}" con ${n} ${
        n === 1 ? 'criterio' : 'criterios'
      }`
    },
    run: crearSegmento,
  },
]
