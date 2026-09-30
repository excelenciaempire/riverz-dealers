/**
 * El catálogo, que es de donde el agente saca lo que sabe.
 *
 * Un producto acá no es una fila de inventario: es la fuente de conocimiento
 * que alimenta al agente. Todo lo que se escribe en la descripción, en las
 * notas y en las preguntas frecuentes se compila en `training_material` y se
 * inyecta verbatim en el prompt, así que sale por WhatsApp con las palabras del
 * comercio. Editar un producto no es editar una ficha: es cambiar lo que el
 * agente le contesta al próximo cliente que pregunte.
 *
 * Por eso `productos.editar` NO expone los veinte campos del PATCH del editor,
 * sino tres: descripción, notas y preguntas frecuentes. Los otros (galería,
 * fuentes, ofertas con sus precios, investigación estructurada) mueven cosas
 * que se ven en otras pantallas y hasta el precio que cotiza el agente —
 * `allowed_offers` deriva `price_min`/`price_max`. Menos superficie es menos
 * formas de romper un catálogo que ya está atendiendo clientes.
 *
 * La escritura no está acá: está en `@/lib/products/write`, que es el mismo
 * código que corre el editor. Si estuviera duplicada, la copia que se olvidara
 * de recompilar el material dejaría al agente citando la descripción vieja.
 */
import { gapKnowledgeInput } from '@/lib/ai/gap-knowledge'
import { gapCapabilityActor,prepareGapKnowledgeReview } from '@/lib/ai/gap-knowledge-actions'
import { escapeLike } from '@/lib/security/like'
import { isUuid } from '@/lib/products/slug'
import { agruparPorPrincipal, type FilaAgrupable } from '@/lib/products/agrupar'
import { actualizarProducto, type CambiosDeProducto } from '@/lib/products/write'
import type { Artefacto } from '@/lib/operator/artifacts'
import { cambio, corto, ficha, lista, plata, tabla, tieneCampos, tt } from './vistas'
import type { Capability, CapabilityContext } from './types'

/** Cuántos productos como mucho devuelve el catálogo de una vez. */
const TOPE_LISTA = 200

// ---------------------------------------------------------------------------

/**
 * De "el sérum" a una fila concreta.
 *
 * Quien pide un producto lo conoce por su nombre, no por su uuid: obligar al id
 * significaría listar el catálogo entero antes de cada edición. Se prueba id,
 * después handle y recién después el nombre — y si el nombre coincide con
 * varios, corta y los muestra. Elegir el primero de una lista ambigua sería
 * editarle al comercio un producto que no nombró.
 */
async function resolverProducto(
  ctx: CapabilityContext,
  referencia: unknown,
  columnas: string,
): Promise<Record<string, unknown>> {
  const ref = typeof referencia === 'string' ? referencia.trim() : ''
  if (!ref) throw new Error('Falta el producto: mandá su id, su handle o su nombre.')

  const { data: exacto } = await ctx.db
    .from('shopify_products')
    .select(columnas)
    .eq('workspace_id', ctx.workspaceId)
    .eq(isUuid(ref) ? 'id' : 'handle', ref)
    .limit(1)
    .maybeSingle()
  // `select()` con columnas dinámicas pierde el tipado de PostgREST.
  if (exacto) return exacto as unknown as Record<string, unknown>

  // Un uuid que no está es un uuid de otra cuenta o inventado: buscarlo por
  // nombre daría un producto distinto al pedido.
  if (isUuid(ref)) throw new Error('Ese producto no existe en esta cuenta.')

  const { data } = await ctx.db
    .from('shopify_products')
    .select(columnas)
    .eq('workspace_id', ctx.workspaceId)
    .ilike('title', `%${escapeLike(ref)}%`)
    .order('title')
    .limit(6)
  const filas = (data ?? []) as unknown as Array<Record<string, unknown>>

  if (filas.length === 0) throw new Error(`No hay ningún producto que se llame "${ref}".`)
  if (filas.length > 1) {
    const nombres = filas.map((f) => `«${f.title}» (${f.id})`).join(', ')
    throw new Error(`"${ref}" coincide con varios: ${nombres}. Elige uno por su id.`)
  }
  return filas[0]
}

/** Los motivos de `write.ts`, contados en castellano. */
function explicar(motivo: string): string {
  if (motivo === 'faqs_no_es_lista') return 'Las preguntas frecuentes tienen que ser una lista.'
  if (motivo === 'faq_mal_formada')
    return 'Cada pregunta frecuente necesita su pregunta y su respuesta, las dos como texto.'
  if (motivo === 'no_existe') return 'Ese producto no existe en esta cuenta.'
  return 'No se pudo guardar el producto.'
}

type Faq = { q: string; a: string }

/**
 * Las preguntas llegan como {pregunta, respuesta} y se guardan como {q, a}.
 *
 * El schema habla en castellano porque es lo que lee el modelo; la columna
 * `custom_faqs` está en inglés desde la mig 027 y la comparte con el editor y
 * con las que genera la investigación. Traducir acá evita tener que migrar una
 * columna que ya tiene datos en las cuentas vivas.
 */
function leerFaqs(valor: unknown): Faq[] {
  if (!Array.isArray(valor)) {
    throw new Error('Las preguntas frecuentes tienen que ser una lista.')
  }
  return valor.map((f, i) => {
    const fila = f as { pregunta?: unknown; respuesta?: unknown } | null
    const q = typeof fila?.pregunta === 'string' ? fila.pregunta.trim() : ''
    const a = typeof fila?.respuesta === 'string' ? fila.respuesta.trim() : ''
    if (!q || !a) {
      throw new Error(
        `A la pregunta frecuente ${i + 1} le falta la pregunta o la respuesta.`,
      )
    }
    return { q, a }
  })
}

/** `undefined` = no lo toques. `null` = vacialo. */
function textoOpcional(valor: unknown): string | null | undefined {
  if (valor === undefined) return undefined
  if (valor === null) return null
  return String(valor)
}

function cuantasFaqs(valor: unknown): number {
  return Array.isArray(valor) ? valor.length : 0
}

// ---------------------------------------------------------------------------

async function listar(ctx: CapabilityContext, args: Record<string, unknown>) {
  const texto = typeof args.texto === 'string' ? args.texto.trim() : ''
  const limite = Math.min(Number(args.limite) || 50, TOPE_LISTA)

  let q = ctx.db
    .from('shopify_products')
    .select(
      'id, title, handle, product_type, price_min, price_max, currency, shop_domain, ai_research_status, custom_faqs, ai_generated_faqs, training_material, master_id, platform, url, ai_agent_products(agent_id)',
    )
    .eq('workspace_id', ctx.workspaceId)
    .order('title', { ascending: true })
    .limit(limite)
  if (texto) q = q.ilike('title', `%${escapeLike(texto)}%`)

  const { data, error } = await q
  if (error) throw new Error(error.message)

  // El mismo producto vendido en varios lados se lista UNA vez, como en la
  // pantalla de Productos. Sin esto el Operador leía cuatro serums —tres de
  // ellos sin conocimiento cargado— y le contaba al comercio que tiene cuatro
  // productos a medio llenar cuando tiene uno completo.
  const filas = agruparPorPrincipal(
    (data ?? []) as unknown as FilaAgrupable[],
  ) as unknown as Array<{
    id: string
    title: string | null
    handle: string | null
    product_type: string | null
    price_min: number | null
    price_max: number | null
    currency: string | null
    shop_domain: string | null
    ai_research_status: string | null
    custom_faqs: unknown
    ai_generated_faqs: unknown
    training_material: string | null
    ai_agent_products: { agent_id: string }[] | null
    listings?: Array<{ platform: string; price_min: number | string | null; currency: string | null }>
  }>

  return {
    productos: filas.map((p) => ({
      id: p.id,
      nombre: p.title,
      handle: p.handle,
      tipo: p.product_type,
      precio_min: p.price_min,
      precio_max: p.price_max,
      divisa: p.currency,
      // 'manual' = lo cargó el comercio a mano; cualquier otra cosa es el
      // dominio de la tienda que lo sincroniza, y ahí renombrar no sirve
      // porque la próxima sincronización lo pisa.
      origen: p.shop_domain,
      // El material NO viaja: son miles de caracteres por producto y para
      // elegir uno alcanza con saber si lo tiene. Está entero en
      // productos.detalle.
      tiene_material: !!p.training_material?.trim(),
      preguntas_frecuentes: cuantasFaqs(p.custom_faqs) + cuantasFaqs(p.ai_generated_faqs),
      investigacion: p.ai_research_status,
      agentes_asignados: (p.ai_agent_products ?? []).length,
      // Dónde más se vende y a cuánto. Sólo si está unificado: para un producto
      // de un solo canal repetiría el precio de arriba.
      canales:
        (p.listings?.length ?? 0) > 1
          ? p.listings!.map((l) => ({
              plataforma: l.platform,
              precio: l.price_min,
              divisa: l.currency,
            }))
          : undefined,
    })),
  }
}

async function detalle(ctx: CapabilityContext, args: Record<string, unknown>) {
  const fila = (await resolverProducto(
    ctx,
    args.producto,
    'id, title, handle, description, product_type, vendor, tags, price_min, price_max, currency, url, shop_domain, custom_notes, custom_faqs, ai_generated_faqs, say_guidelines, never_say, escalation_triggers, allowed_offers, health_sensitive, ai_research_status, training_material',
  )) as Record<string, unknown>

  const propias = (fila.custom_faqs ?? []) as Faq[]
  const deIa = (fila.ai_generated_faqs ?? []) as Faq[]

  return {
    id: fila.id,
    nombre: fila.title,
    handle: fila.handle,
    descripcion: fila.description,
    tipo: fila.product_type,
    marca: fila.vendor,
    etiquetas: fila.tags,
    precio_min: fila.price_min,
    precio_max: fila.price_max,
    divisa: fila.currency,
    url: fila.url,
    origen: fila.shop_domain,
    notas: fila.custom_notes,
    // Separadas a propósito: las del comercio se editan desde acá y las de la
    // investigación se regeneran solas. Mezcladas, el modelo reescribiría como
    // propias unas que la próxima investigación va a pisar.
    preguntas_frecuentes: propias,
    preguntas_frecuentes_de_la_investigacion: deIa,
    que_decir: fila.say_guidelines,
    que_no_decir: fila.never_say,
    cuando_escalar: fila.escalation_triggers,
    ofertas: fila.allowed_offers,
    tema_de_salud: fila.health_sensitive,
    investigacion: fila.ai_research_status,
    // Lo que el agente recibe literal en su prompt.
    material: fila.training_material,
  }
}

async function editar(ctx: CapabilityContext, args: Record<string, unknown>) {
  const actual = await resolverProducto(
    ctx,
    args.producto,
    'id, title, description, custom_notes, custom_faqs',
  )

  const cambios: CambiosDeProducto = {}
  const descripcion = textoOpcional(args.descripcion)
  if (descripcion !== undefined) cambios.description = descripcion
  const notas = textoOpcional(args.notas)
  if (notas !== undefined) cambios.custom_notes = notas
  if (args.preguntas_frecuentes !== undefined) {
    cambios.custom_faqs = leerFaqs(args.preguntas_frecuentes)
  }

  if (Object.keys(cambios).length === 0) {
    throw new Error('No mandaste nada para cambiar: descripción, notas o preguntas frecuentes.')
  }

  const res = await actualizarProducto(ctx.db, {
    id: actual.id as string,
    cambios,
    locale: ctx.locale ?? 'es',
    // El cliente es de servicio y no tiene recorte propio: sin esto, el id de
    // otra cuenta se editaría igual.
    workspaceId: ctx.workspaceId,
  })
  if (!res.ok) throw new Error(explicar(res.motivo))

  const producto = res.producto
  return {
    id: producto.id,
    nombre: producto.title,
    cambiado: Object.keys(cambios),
    preguntas_frecuentes: cuantasFaqs(producto.custom_faqs),
    nota: 'El agente ya cita esto: sale así en la próxima respuesta.',
  }
}

// ---------------------------------------------------------------------------

/**
 * CARGAR LA RESPUESTA QUE FALTABA.
 *
 * `bandeja.huecos` dice lo que la IA no supo contestar. Sin esto, esa lista era
 * un reproche: se leía "no supo decir si sirve para piel sensible", había que
 * buscar el producto, abrirlo, encontrar el campo y pegarlo a mano. La mitad de
 * las veces nadie lo hacía y la misma pregunta volvía a la semana.
 *
 * Va a las preguntas frecuentes del producto y no a una tabla nueva: ahí ya vive
 * lo que el comercio agrega a mano y `buildTrainingMaterial` lo compila para el
 * prompt. Un segundo lugar sería un segundo lugar donde buscar lo mismo.
 */
async function responderHueco(ctx: CapabilityContext, args: Record<string, unknown>) {
  const productId = String(args.producto_id ?? '').trim()
  const pregunta = String(args.pregunta ?? '').trim()
  const respuesta = String(args.respuesta ?? '').trim()
  if (!productId) throw new Error('Falta el id del producto.')
  if (!pregunta) throw new Error('Falta la pregunta.')
  if (!respuesta) throw new Error('Falta la respuesta.')
  if (pregunta.length>500 || respuesta.length>2000) throw new Error('invalid_gap_context')

  const clave=typeof args.hueco_clave==='string' ? args.hueco_clave.trim() : ''
  if (clave) {
    const input=gapKnowledgeInput({ action:'preview',key:clave,product_id:productId,question:pregunta,answer:respuesta })
    if (!input || input.action!=='preview') throw new Error('invalid_gap_context')
    const userId=gapCapabilityActor(ctx)
    const reviewed=await prepareGapKnowledgeReview({ ...ctx,userId,locale:ctx.locale ?? 'es' },input)
    if (reviewed.error) throw new Error(reviewed.error.message)
    const receipt=reviewed.data as { id:string }
    if (!receipt?.id) throw new Error('gap_changed')
    const confirmed=await ctx.db.rpc('confirm_gap_knowledge_review',{ p_workspace_id:ctx.workspaceId,p_actor_id:userId,p_review_id:receipt.id })
    if (confirmed.error || !confirmed.data?.ok) throw new Error(confirmed.error?.message ?? 'gap_changed')
    return { producto:productId,pregunta,respuesta,hueco_cerrado:true,knowledge_receipt_id:receipt.id }
  }

  const { data: producto } = await ctx.db
    .from('shopify_products')
    .select('id, title, custom_faqs')
    .eq('id', productId)
    .eq('workspace_id', ctx.workspaceId)
    .maybeSingle()
  if (!producto) throw new Error('Ese producto no existe en esta cuenta.')

  const previas = Array.isArray((producto as { custom_faqs?: unknown }).custom_faqs)
    ? ((producto as { custom_faqs: Array<{ q?: string; a?: string }> }).custom_faqs ?? [])
    : []
  // La misma pregunta cargada dos veces se reemplaza, no se duplica: si no, el
  // material del prompt junta respuestas contradictorias y el agente elige mal.
  const sinRepetir = previas
    .map((f) => ({ q: String(f?.q ?? '').trim(), a: String(f?.a ?? '').trim() }))
    .filter((f) => f.q && f.a && f.q.toLowerCase() !== pregunta.toLowerCase())

  const res = await actualizarProducto(ctx.db, {
    id: productId,
    cambios: { custom_faqs: [...sinRepetir, { q: pregunta, a: respuesta }] },
    locale: ctx.locale ?? 'es',
    workspaceId: ctx.workspaceId,
  })
  if (!res.ok) throw new Error(res.motivo ?? 'no se pudo guardar')


  return {
    producto: (producto as { title?: string }).title ?? productId,
    pregunta,
    respuesta,
    hueco_cerrado: false,
  }
}


/**
 * Los productos, dibujados.
 *
 * En la lista, lo que se busca es cuál elegir: nombre, precio y —la columna que
 * nadie más tiene— si tiene material cargado, que es lo que decide si el agente
 * puede hablar de él o va a improvisar.
 */
function vistaProductos(ctx: CapabilityContext, r: unknown): Artefacto {
  const filas = lista<{
    nombre?: string | null
    tipo?: string | null
    precio_min?: number | null
    precio_max?: number | null
    divisa?: string | null
    tiene_material?: boolean
    preguntas_frecuentes?: number
  }>(r, 'productos')
  return tabla({
    titulo: tt(ctx, 'operation.subProductos'),
    columnas: [
      { clave: 'nombre', titulo: tt(ctx, 'operation.vColProducto') },
      { clave: 'tipo', titulo: tt(ctx, 'operation.vColTipo') },
      { clave: 'material', titulo: tt(ctx, 'operation.vColMaterial') },
      { clave: 'precio', titulo: tt(ctx, 'operation.vColPrecio'), alineado: 'der' },
    ],
    filas: filas.map((p) => ({
      nombre: corto(p.nombre, 32),
      tipo: corto(p.tipo, 18),
      // Sin material el agente improvisa, así que la respuesta útil acá es sí o
      // no y no un número de caracteres que nadie sabe interpretar.
      material: p.tiene_material
        ? tt(ctx, 'operation.vSi')
        : tt(ctx, 'operation.vNo'),
      precio: rango(ctx, p.precio_min, p.precio_max, p.divisa),
    })),
    vacio: tt(ctx, 'operation.vSinProductos'),
  })
}

/** «$1.200» o «$1.200 – $1.800», según haya una variante o varias. */
function rango(
  ctx: CapabilityContext,
  min: unknown,
  max: unknown,
  divisa?: string | null,
): string {
  const a = plata(ctx, min, divisa)
  const b = plata(ctx, max, divisa)
  return a === b ? a : `${a} – ${b}`
}

function vistaProducto(ctx: CapabilityContext, r: Awaited<ReturnType<typeof detalle>>): Artefacto | null {
  if (!tieneCampos(r, 'id')) return null
  const t = (k: string) => tt(ctx, `operation.${k}`)
  const chips: string[] = []
  if (r.tema_de_salud) chips.push(t('vTemaDeSalud'))
  if (r.investigacion) chips.push(String(r.investigacion))

  return ficha({
    titulo: String(r.nombre ?? t('vSinNombre')),
    subtitulo: [r.marca, r.tipo].filter(Boolean).map(String).join(' · ') || undefined,
    chips,
    campos: [
      { etiqueta: t('vColPrecio'), valor: rango(ctx, r.precio_min, r.precio_max, r.divisa as string) },
      { etiqueta: t('vColOrigen'), valor: String(r.origen ?? '') },
      {
        etiqueta: t('vColPreguntas'),
        valor: String(
          lista(r, 'preguntas_frecuentes').length +
            lista(r, 'preguntas_frecuentes_de_la_investigacion').length,
        ),
      },
      { etiqueta: t('vColQueDecir'), valor: corto(r.que_decir, 80) },
      { etiqueta: t('vColQueNoDecir'), valor: corto(r.que_no_decir, 80) },
    ],
    // Sin material el agente improvisa: es lo primero que hay que saber de un
    // producto y no se ve en ningún otro campo.
    nota: r.material ? undefined : t('vSinMaterial'),
  })
}

/**
 * Lo que se va a cambiar del producto, campo por campo.
 *
 * `artifact` y no `vista`: esto se aprueba, así que se dibuja desde los
 * ARGUMENTOS y tiene que verse antes de ejecutar. El «antes» lo pone
 * `artifactBefore`, que sí puede consultar la base.
 */
function vistaEditarProducto(ctx: CapabilityContext, args: Record<string, unknown>): Artefacto {
  const t = (k: string) => tt(ctx, `operation.${k}`)
  const campos: { etiqueta: string; despues: string }[] = []
  if (typeof args.descripcion === 'string') {
    campos.push({ etiqueta: t('vColDescripcion'), despues: corto(args.descripcion, 300) })
  }
  if (typeof args.notas === 'string') {
    campos.push({ etiqueta: t('vColNotas'), despues: corto(args.notas, 300) })
  }
  const faqs = lista<{ pregunta?: string; question?: string }>(args.preguntas_frecuentes)
  if (faqs.length > 0) {
    campos.push({
      etiqueta: t('vColPreguntas'),
      despues: faqs.map((f) => corto(f.pregunta ?? f.question, 60)).join('\n'),
    })
  }
  return cambio({
    titulo: corto(args.producto, 40),
    que: t('vQueEditarProducto'),
    campos,
  })
}
export const PRODUCT_CAPABILITIES: Capability[] = [
  {
    key: 'productos.responder_hueco',
    description:
      'Carga la respuesta que la IA no supo dar. Queda en las preguntas frecuentes del producto, que es lo que el agente lee verbatim, así que la próxima vez la contesta él. Si se pasa la clave del hueco (la que devuelve bandeja.huecos), además lo marca resuelto. La misma pregunta cargada dos veces se reemplaza, no se duplica.',
    descriptionEn:
      'Loads the answer the AI could not give. It lands in the product FAQs, which the agent reads verbatim, so next time it answers on its own. If the gap key is passed (the one bandeja.huecos returns), it also marks it resolved. The same question loaded twice is replaced, not duplicated.',
    risk: 'reversible',
    schema: {
      type: 'object',
      properties: {
        producto_id: { type: 'string', description: 'El id que devuelve productos.listar.' },
        pregunta: { type: 'string' },
        respuesta: { type: 'string' },
        hueco_clave: {
          type: 'string',
          description: 'La clave del hueco, para marcarlo resuelto. Opcional.',
        },
      },
      required: ['producto_id', 'pregunta', 'respuesta'],
    },
    async preview(ctx, args) {
      const { data } = await ctx.db
        .from('shopify_products')
        .select('title')
        .eq('id', String(args.producto_id ?? ''))
        .eq('workspace_id', ctx.workspaceId)
        .maybeSingle()
      const titulo = (data as { title?: string } | null)?.title ?? 'ese producto'
      return `En ${titulo} guardaría: «${args.pregunta}» → «${args.respuesta}». El agente lo repite tal cual ante un cliente.`
    },
    run: responderHueco,
    // Va a las preguntas frecuentes del producto: desde la próxima respuesta,
    // el agente cita ESTO. Se muestra entero porque es lo que va a decir.
    artifact: (ctx, args) =>
      cambio({
        titulo: corto(args.pregunta, 60),
        que: tt(ctx, 'operation.vQueResponderHueco'),
        campos: [
          { etiqueta: tt(ctx, 'operation.vColRespuesta'), despues: String(args.respuesta ?? '') },
        ],
      }),
  },
  {
    key: 'productos.listar',
    description:
      'El catálogo de la cuenta: nombre, precio, divisa, cuántas preguntas frecuentes tiene cada producto, si ya tiene material de entrenamiento cargado (lo que el agente cita ante un cliente) y a cuántos agentes está asignado. Sin texto devuelve todo, ordenado por nombre.',
    descriptionEn:
      "The account's catalog: name, price, currency, how many FAQs each product has, whether it already has training material (what the agent quotes to a customer) and how many agents it is assigned to. With no text, everything, sorted by name.",
    risk: 'lectura',
    schema: {
      type: 'object',
      properties: {
        texto: { type: 'string', description: 'Parte del nombre del producto.' },
        limite: { type: 'number', description: `Por defecto 50, máximo ${TOPE_LISTA}.` },
      },
    },
    run: listar,
    vista: (ctx, _args, r) => vistaProductos(ctx, r),
  },

  {
    key: 'productos.detalle',
    description:
      'Un producto completo: descripción, notas del comercio, sus preguntas frecuentes (las propias y las de la investigación, separadas), qué decir y qué no decir, cuándo escalar, las ofertas con sus precios, y el material de entrenamiento entero — el texto literal que el agente recibe en su prompt cuando habla de este producto.',
    descriptionEn:
      "One full product: description, merchant notes, its FAQs (own and research-generated, kept apart), what to say and what never to say, when to escalate, the offers with their prices, and the whole training material — the literal text the agent receives in its prompt when it talks about this product.",
    risk: 'lectura',
    schema: {
      type: 'object',
      properties: {
        producto: {
          type: 'string',
          description: 'Id, handle o nombre del producto. Si el nombre coincide con varios, los lista para que elijas.',
        },
      },
      required: ['producto'],
    },
    run: detalle,
    vista: (ctx, _args, r) => vistaProducto(ctx, r as Awaited<ReturnType<typeof detalle>>),
  },

  {
    key: 'productos.editar',
    description:
      'Cambia lo que el agente sabe de un producto: su descripción, las notas del comercio y sus preguntas frecuentes. Es lo que el agente va a repetir ante un cliente en su próxima respuesta, así que escribilo como quiere el comercio que se le hable a su gente. Se deshace llamando de nuevo con el texto anterior. Sólo estos tres campos: precios, ofertas, fotos y fuentes se tocan desde el editor.',
    descriptionEn:
      "Changes what the agent knows about a product: its description, the merchant's notes and its FAQs. This is what the agent will repeat to a customer on its next reply, so write it the way the merchant wants their people spoken to. Undone by calling again with the previous text. Only these three fields: prices, offers, photos and sources are edited from the product editor.",
    risk: 'reversible',
    schema: {
      type: 'object',
      properties: {
        producto: {
          type: 'string',
          description: 'Id, handle o nombre del producto.',
        },
        descripcion: {
          type: 'string',
          description: 'Qué es el producto. Reemplaza la actual entera; null la vacía.',
        },
        notas: {
          type: 'string',
          description:
            'Lo que el comercio quiere que el agente sepa y no está en la descripción: envíos, garantía, cómo se usa. Reemplaza las actuales enteras.',
        },
        preguntas_frecuentes: {
          type: 'array',
          description:
            'Reemplaza TODAS las preguntas frecuentes propias del producto. Para agregar una, mandá también las que ya estaban (salen de productos.detalle). No toca las que generó la investigación.',
          items: {
            type: 'object',
            properties: {
              pregunta: { type: 'string' },
              respuesta: { type: 'string' },
            },
            required: ['pregunta', 'respuesta'],
          },
        },
      },
      required: ['producto'],
    },
    async preview(ctx, args) {
      let actual: Record<string, unknown>
      try {
        actual = await resolverProducto(
          ctx,
          args.producto,
          'id, title, description, custom_notes, custom_faqs',
        )
      } catch (e) {
        throw e
      }

      // El diff se cuenta en lo que se ve, no en nombres de columna: quien
      // aprueba necesita saber si esto pisa algo que ya estaba escrito.
      const lineas: string[] = []
      if (args.descripcion !== undefined) {
        lineas.push(
          actual.description
            ? 'reemplazaría la descripción que ya tiene'
            : 'le pondría una descripción (hoy no tiene)',
        )
      }
      if (args.notas !== undefined) {
        lineas.push(
          actual.custom_notes
            ? 'reemplazaría las notas del comercio'
            : 'le agregaría notas del comercio',
        )
      }
      if (args.preguntas_frecuentes !== undefined) {
        const antes = cuantasFaqs(actual.custom_faqs)
        const ahora = cuantasFaqs(args.preguntas_frecuentes)
        lineas.push(`dejaría ${ahora} preguntas frecuentes (hoy hay ${antes})`)
      }
      if (lineas.length === 0) return `En «${actual.title}» no cambiaría nada.`

      return `En «${actual.title}» ${lineas.join(
        ', ',
      )}. Es lo que el agente le cita a un cliente desde su próxima respuesta.`
    },
    run: editar,
    artifact: (ctx, args) => vistaEditarProducto(ctx, args),
  },
]
