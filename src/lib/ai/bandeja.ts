import type { SupabaseClient } from '@supabase/supabase-js'
import { ensureTag } from '@/lib/contacts/tags'

/**
 * Lo que hace una persona en la bandeja mientras atiende: mirar la ficha de
 * quien escribe, ponerle una etiqueta y cerrar el caso cuando terminó.
 *
 * **Ninguna recibe un id.** El registro de capacidades del Operator ya tiene
 * `contactos.detalle`, `contactos.etiquetar` y `conversaciones.cerrar`, y sería
 * más corto pasárselas al agente tal cual. Pero esas herramientas están hechas
 * para el dueño de la cuenta: reciben el id del contacto, o un segmento entero,
 * o un juego de criterios. Este agente lee texto escrito por desconocidos, así
 * que un id como argumento es la ficha de otra clienta a un mensaje de
 * distancia, y un segmento como argumento es etiquetar a toda la base.
 *
 * Acá el contacto y la conversación salen del contexto que arma el servidor.
 * El modelo no puede nombrar otros porque no hay dónde escribirlos.
 */

export interface BandejaCtx {
  db: SupabaseClient
  workspaceId: string
  contactId: string
  conversationId?: string | null
  /** De qué productos puede hablar este agente. `null` = de todos. */
  permitidos?: Set<string> | null
}

/** La ficha de quien está escribiendo. */
export async function verContacto(ctx: BandejaCtx): Promise<string> {
  const { data } = await ctx.db
    .from('contacts')
    .select(
      'name, email, phone, channel, opted_out, shopify_customer_data, ai_segment, last_product, last_inbound_at, created_at',
    )
    .eq('workspace_id', ctx.workspaceId)
    .eq('id', ctx.contactId)
    .maybeSingle()
  if (!data) {
    return JSON.stringify({ ok: false, message: 'No encontré la ficha de esta persona.' })
  }

  const c = data as Record<string, unknown>
  // Lo que gastó y de dónde es vive en el volcado de la tienda, no en columnas
  // propias: `contacts` guarda la identidad y la tienda guarda la compra.
  const tienda = (c.shopify_customer_data ?? null) as {
    total_spent?: number | string
    orders_count?: number
    default_address?: { city?: string; province?: string; country?: string }
  } | null

  const { data: etiquetas } = await ctx.db
    .from('contact_tags')
    .select('tags(name)')
    .eq('contact_id', ctx.contactId)
    .limit(20)
  const nombres = ((etiquetas ?? []) as Array<{ tags?: { name?: string } | null }>)
    .map((e) => e.tags?.name)
    .filter(Boolean)

  const dir = tienda?.default_address ?? null
  return JSON.stringify({
    ok: true,
    nombre: c.name ?? null,
    correo: c.email ?? null,
    telefono: c.phone ?? null,
    canal: c.channel ?? null,
    ciudad: dir?.city ?? null,
    provincia: dir?.province ?? null,
    pais: dir?.country ?? null,
    pedidos: tienda?.orders_count ?? 0,
    gastado: tienda?.total_spent ?? null,
    // Que pidió la baja es lo único que cambia lo que el agente PUEDE hacer,
    // no sólo lo que sabe: a quien se dio de baja no se le escribe primero.
    dio_de_baja: c.opted_out === true,
    etiquetas: nombres,
    ultimo_producto: c.last_product ?? null,
    segmento: c.ai_segment ?? null,
    cliente_desde: c.created_at ?? null,
    message:
      'Es la ficha de quien está escribiendo. Úsala para personalizar, no la recites: nadie quiere que le lean sus propios datos.',
  })
}

/** Una etiqueta, sólo sobre quien escribe. */
export async function etiquetarContacto(
  ctx: BandejaCtx,
  input: { etiqueta?: string; quitar?: boolean },
): Promise<string> {
  const nombre = (input.etiqueta ?? '').trim().slice(0, 60)
  if (!nombre) {
    return JSON.stringify({ ok: false, message: 'Falta el nombre de la etiqueta.' })
  }

  if (input.quitar === true) {
    const { data } = await ctx.db
      .from('tags')
      .select('id')
      .eq('workspace_id', ctx.workspaceId)
      .eq('name', nombre)
      .limit(1)
      .maybeSingle()
    const tagId = (data as { id?: string } | null)?.id
    if (!tagId) {
      return JSON.stringify({ ok: true, quitada: false, message: 'Esa etiqueta no existía.' })
    }
    await ctx.db
      .from('contact_tags')
      .delete()
      .eq('tag_id', tagId)
      .eq('contact_id', ctx.contactId)
    return JSON.stringify({
      ok: true,
      quitada: true,
      message: `Le saqué la etiqueta "${nombre}". No hace falta que se lo cuentes.`,
    })
  }

  const tagId = await ensureTag(ctx.db, ctx.workspaceId, nombre)
  if (!tagId) {
    return JSON.stringify({ ok: false, message: 'No se pudo crear la etiqueta.' })
  }
  const { error } = await ctx.db
    .from('contact_tags')
    .insert({ contact_id: ctx.contactId, tag_id: tagId })
  // Ya la tenía: la clave compuesta rebota y eso es un éxito, no un fallo.
  if (error && error.code !== '23505') {
    return JSON.stringify({ ok: false, message: 'No se pudo etiquetar.' })
  }
  return JSON.stringify({
    ok: true,
    message: `Quedó etiquetada como "${nombre}". Es una nota interna: no se lo menciones a la clienta.`,
  })
}

/** Cerrar el caso cuando la consulta terminó. */
export async function cerrarConversacion(ctx: BandejaCtx): Promise<string> {
  if (!ctx.conversationId) {
    return JSON.stringify({ ok: false, message: 'No puedo cerrar esta conversación.' })
  }
  const { error } = await ctx.db
    .from('conversations')
    .update({ status: 'closed', closed_at: new Date().toISOString() })
    .eq('id', ctx.conversationId)
    .eq('workspace_id', ctx.workspaceId)
    // Un hilo que ya está esperando a una persona NO se cierra solo: el
    // escalamiento existe justamente porque alguien tiene que mirarlo, y
    // cerrarlo lo saca de la lista donde lo iba a encontrar.
    .is('needs_human_at', null)
  if (error) {
    return JSON.stringify({ ok: false, message: 'No se pudo cerrar.' })
  }
  return JSON.stringify({
    ok: true,
    message:
      'Cerré el caso. Despídete normalmente y no anuncies que "cerraste la conversación": para la clienta eso no significa nada.',
  })
}

/** La ficha de un producto del catálogo, por nombre. */
export async function verProducto(
  ctx: BandejaCtx,
  input: { producto?: string },
): Promise<string> {
  const q = (input.producto ?? '').trim().slice(0, 120)
  if (q.length < 2) {
    return JSON.stringify({ ok: false, message: 'Dime qué producto quieres mirar.' })
  }
  const { searchProducts } = await import('@/lib/products/search')
  const [hit] = await searchProducts(ctx.db, {
    workspaceId: ctx.workspaceId,
    query: q,
    limit: 1,
    // Las mismas dos reglas que `buscar_producto`: sólo lo que este agente
    // tiene asignado, y el producto entero en vez de una de sus publicaciones.
    permitidos: ctx.permitidos ?? null,
    agrupar: true,
  })
  if (!hit) {
    return JSON.stringify({
      ok: false,
      message: `No encontré "${q}" en el catálogo. Prueba con buscar_producto para ver qué hay parecido.`,
    })
  }
  return JSON.stringify({
    ok: true,
    ...hit,
    message:
      'Es la ficha completa del producto. El precio que figura acá es el que se cobra: no lo redondees ni lo cotices de memoria.',
  })
}
