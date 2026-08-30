/**
 * Pedidos y dinero.
 *
 * Leer los pedidos sale de la tabla espejo local, que es lo que se sincroniza
 * desde Shopify, Tiendanube, WooCommerce y Mercado Libre. No consulta al
 * proveedor: para "¿el pedido 1234 está pago?" en tiempo real está la
 * herramienta del agente (`lookup_order`), que sí va a la tienda.
 *
 * Escribir es otra cosa. Armar un link de pago, crear el pedido y dar por
 * cobrada una transferencia ya existían, pero sólo dentro del bot que atiende
 * clientes: el comercio no podía pedirle a Riverz "armale el link a Ana" sin
 * esperar a que Ana escribiera. Estas tres capacidades exponen exactamente las
 * mismas funciones —`createCheckoutLink`, `crearPedidoConEspejo`,
 * `informarPago`— con la conversación reemplazada por un contacto. Una segunda
 * implementación del cobro sería una segunda economía: el bundle de la tienda
 * aplicado de otra forma, el pedido creado sin espejo, la transferencia dada
 * por buena con otro criterio.
 *
 * Las tres mueven dinero, así que ninguna se ejecuta sin que una persona lea
 * antes el `preview` con el monto y el nombre.
 *
 * Sólo Shopify: las tres funciones que envuelven hablan con la Admin API de
 * Shopify. Un comercio de Tiendanube o WooCommerce las ve fallar con un motivo
 * claro en vez de con un pedido a medias.
 */
import { resolveShopifyContext } from '@/lib/ai/runner'
import type { ProductMatch } from '@/lib/ai/product-routing'
import { crearPedidoConEspejo } from '@/lib/orders/crear'
import {
  informarPago,
  montoCoincide,
  pendingOrderFor,
} from '@/lib/payments/reported-payment'
import { leerReglasDeCobro } from '@/lib/payments/reglas-de-cobro'
import { resolveWorkspaceCurrency } from '@/lib/products/currency'
import {
  createCheckoutLink,
  fmtMoney,
  type PaymentHint,
} from '@/lib/shopify/create-checkout'
import type {
  CreateOrderInput,
  ShippingAddressInput,
} from '@/lib/shopify/create-order'
import type { ShopifyToolContext } from '@/lib/ai/tools'
import type { Contact } from '@/types'
import type { Artefacto } from '@/lib/operator/artifacts'
import { since, windowDays } from './predicates'
import { cambio, corto, fecha, lista, plata, tabla, tt } from './vistas'
import type { Capability, CapabilityContext } from './types'

async function listar(ctx: CapabilityContext, args: Record<string, unknown>) {
  const d = windowDays(args.dias, 30)
  let q = ctx.db
    .from('orders')
    .select(
      'order_number, customer_name, customer_phone, total_price, currency, financial_status, fulfillment_status, shipping_status, tracking_number, tracking_url, channel, created_at',
    )
    .eq('workspace_id', ctx.workspaceId)
    .gte('created_at', since(d))
    .order('created_at', { ascending: false })
    .limit(100)
  if (args.estado_pago) q = q.eq('financial_status', String(args.estado_pago))

  const { data } = await q
  return { periodo_dias: d, pedidos: data ?? [] }
}

// ---------------------------------------------------------------------------

interface ContactoDeCompra {
  id: string
  nombre: string | null
  telefono: string | null
  email: string | null
  canal: string | null
}

interface ContextoDeCompra {
  contacto: ContactoDeCompra
  tienda: ShopifyToolContext
}

/** Cómo nombrar al cliente en un texto que va a leer una persona. */
function quien(c: ContactoDeCompra): string {
  return c.nombre || c.telefono || c.email || 'ese contacto'
}

/**
 * La tienda del comercio y el cliente concreto, listos para cotizar.
 *
 * Es la misma resolución que hace el runner antes de cada respuesta del bot
 * —credenciales, config de checkout y variante del producto detectado—, y por
 * eso se llama a `resolveShopifyContext` en vez de repetirla: ahí adentro está
 * el orden de precedencia de la variante (el producto que se pide, si no el
 * de la config) y el fallback de conexiones viejas sin `workspace_id`. Lo
 * único que cambia es de dónde sale el cliente: en el bot es quien está
 * escribiendo, acá es el contacto que nombró el comercio.
 */
async function contextoDeCompra(
  ctx: CapabilityContext,
  args: Record<string, unknown>,
): Promise<ContextoDeCompra> {
  const contactId = String(args.contacto_id ?? '').trim()
  if (!contactId) throw new Error('falta el contacto')

  const { data } = await ctx.db
    .from('contacts')
    .select('id, name, phone, email, channel')
    .eq('id', contactId)
    .eq('workspace_id', ctx.workspaceId)
    .maybeSingle()
  const fila = data as {
    id: string
    name: string | null
    phone: string | null
    email: string | null
    channel: string | null
  } | null
  if (!fila) throw new Error('ese contacto no existe en esta cuenta')

  const contacto: ContactoDeCompra = {
    id: fila.id,
    nombre: fila.name,
    telefono: fila.phone,
    email: fila.email,
    canal: fila.channel,
  }

  // El producto llega por su id en Riverz. `resolveShopifyContext` espera la
  // forma con la que el runner reporta el producto DETECTADO en un mensaje;
  // acá no hay detección que hacer, el comercio lo eligió, así que va con la
  // confianza más alta.
  const productoId =
    typeof args.producto_id === 'string' ? args.producto_id.trim() : ''
  const match: ProductMatch | null = productoId
    ? { product_id: productoId, score: 1, confidence: 'high', via: 'title_exact' }
    : null

  const tienda = await resolveShopifyContext(
    ctx.db,
    ctx.workspaceId,
    {
      id: contacto.id,
      workspace_id: ctx.workspaceId,
      name: contacto.nombre ?? undefined,
      phone: contacto.telefono ?? undefined,
      email: contacto.email ?? undefined,
    } as Contact,
    match,
  )
  if (!tienda) {
    throw new Error(
      'esta cuenta no tiene una tienda Shopify conectada, que es de donde salen los precios y el pedido',
    )
  }

  return {
    contacto,
    tienda: {
      ...tienda,
      // El runner la resuelve por su lado y la deja fuera del contexto; sin
      // esto los totales se cotizarían con el 'ARS' que trae por defecto
      // `createShopifyOrder`, que para una tienda colombiana es otro número.
      currency: await resolveWorkspaceCurrency(ctx.db, ctx.workspaceId),
    },
  }
}

function comoPaga(args: Record<string, unknown>): PaymentHint | undefined {
  return args.pago === 'transfer' || args.pago === 'card_or_mp'
    ? (args.pago as PaymentHint)
    : undefined
}

/**
 * Qué le va a costar, con los precios de HOY.
 *
 * `createCheckoutLink` sólo lee (el precio de la variante, el stock, el
 * dominio de la tienda) y resuelve la oferta con la misma config con la que
 * después se crea el pedido, así que sirve de cotizador para las dos
 * capacidades — incluida la de crear, que no puede cotizarse ejecutándose.
 */
async function cotizar(
  { tienda }: ContextoDeCompra,
  args: Record<string, unknown>,
) {
  return createCheckoutLink(
    {
      offer: typeof args.oferta === 'string' ? args.oferta : undefined,
      quantity: typeof args.cantidad === 'number' ? args.cantidad : undefined,
      payment_hint: comoPaga(args),
    },
    {
      shopDomain: tienda.shopDomain,
      accessToken: tienda.accessToken,
      apiVersion: tienda.apiVersion,
      pinnedVariantId: tienda.pinnedVariantId ?? null,
      storefrontDomain: tienda.storefrontDomain ?? null,
      config: tienda.config ?? null,
      currency: tienda.currency ?? null,
    },
  )
}

async function checkout(ctx: CapabilityContext, args: Record<string, unknown>) {
  const contexto = await contextoDeCompra(ctx, args)
  const link = await cotizar(contexto, args)
  if ('error' in link) throw new Error(link.message)

  return {
    contacto: quien(contexto.contacto),
    link: link.checkout_url,
    que_lleva: link.offer_label,
    total: link.total_label,
    pago: link.payment_label,
    // El link no sale solo: alguien tiene que mandárselo. Decirlo evita que el
    // comercio crea que el cliente ya lo recibió.
    nota: 'El link queda armado. Envíaselo por el canal donde estén hablando.',
  }
}

async function crear(ctx: CapabilityContext, args: Record<string, unknown>) {
  const { contacto, tienda } = await contextoDeCompra(ctx, args)

  const nombre =
    (typeof args.nombre === 'string' && args.nombre.trim()) ||
    contacto.nombre ||
    ''
  if (!nombre) {
    throw new Error(
      'falta el nombre para el pedido: ese contacto no tiene uno cargado',
    )
  }

  const entrada: CreateOrderInput = {
    offer: typeof args.oferta === 'string' ? args.oferta : undefined,
    quantity: typeof args.cantidad === 'number' ? args.cantidad : undefined,
    payment_hint: comoPaga(args),
    customer_name: nombre,
    customer_phone: contacto.telefono ?? undefined,
    customer_email: contacto.email ?? undefined,
    shipping_address:
      typeof args.direccion === 'object' && args.direccion !== null
        ? (args.direccion as ShippingAddressInput)
        : undefined,
    note: typeof args.nota === 'string' ? args.nota : undefined,
  }

  const pedido = await crearPedidoConEspejo(
    entrada,
    {
      shopDomain: tienda.shopDomain,
      accessToken: tienda.accessToken,
      apiVersion: tienda.apiVersion,
      pinnedVariantId: tienda.pinnedVariantId ?? null,
      customerPhone: contacto.telefono ?? null,
      customerEmail: contacto.email ?? null,
      config: tienda.config ?? null,
      currency: tienda.currency ?? null,
    },
    {
      workspaceId: ctx.workspaceId,
      contactId: contacto.id,
      channel: contacto.canal,
      // No es 'ai': lo aprobó una persona mirando el preview. La diferencia se
      // lee después en `orders.created_by` cuando alguien pregunta quién armó
      // este pedido.
      createdBy: 'manual',
      db: ctx.db,
    },
  )
  if ('error' in pedido) throw new Error(pedido.message)

  return {
    pedido: pedido.order_number,
    contacto: quien(contacto),
    // Sin total no se escribe "$0": el pedido existe igual y un cero inventado
    // es lo que después se le repite al cliente.
    total:
      pedido.total_price != null
        ? fmtMoney(pedido.total_price, pedido.currency)
        : null,
    seguimiento: pedido.order_status_url,
    estado_pago: 'pendiente',
  }
}

async function registrarPago(ctx: CapabilityContext, args: Record<string, unknown>) {
  const contactId = String(args.contacto_id ?? '').trim()
  if (!contactId) throw new Error('falta el contacto')

  const { resultado, pedido } = await informarPago({
    db: ctx.db,
    workspaceId: ctx.workspaceId,
    contactId,
    amount: typeof args.monto === 'number' ? args.monto : null,
    note: typeof args.nota === 'string' ? args.nota : null,
  })

  if (resultado.kind === 'sin_pedido') {
    return { ok: false, motivo: 'esa persona no tiene ningún pedido pendiente de pago' }
  }
  if (resultado.kind === 'error') {
    throw new Error(resultado.error)
  }
  if (resultado.kind === 'cobrado') {
    return { ok: true, estado: 'pagado', cobrado: resultado.amount }
  }
  return {
    ok: true,
    estado: 'en_verificacion',
    pedido: pedido?.orderNumber ?? null,
    motivo: resultado.reason,
    nota: 'Dejamos de mandarle recordatorios y le preguntamos al dueño de la cuenta por WhatsApp si lo damos por cobrado.',
  }
}

// ---------------------------------------------------------------------------

/** Lo que define QUÉ se compra. Igual en el link de pago y en el pedido. */
const ESQUEMA_COMPRA = {
  contacto_id: {
    type: 'string',
    description: 'El cliente, de contactos.listar o contactos.buscar.',
  },
  producto_id: {
    type: 'string',
    description:
      'Producto del catálogo sincronizado. Sin esto se usa el producto por defecto de la tienda.',
  },
  cantidad: { type: 'number', description: 'Unidades. Por defecto 1.' },
  oferta: {
    type: 'string',
    description:
      'Clave de la oferta, para las tiendas que venden por combos fijos (2+1, 3+1). Obligatoria si la tienda tiene combos configurados; si no, usá cantidad.',
  },
  pago: {
    type: 'string',
    enum: ['card_or_mp', 'transfer'],
    description:
      'Cómo va a pagar. "transfer" aplica el descuento por transferencia si la tienda lo tiene configurado.',
  },
} as const

// ---------------------------------------------------------------------------
// LA PLATA QUE NO ENTRÓ.
//
// Dos listas que existían hace meses y a las que el chat no llegaba: los
// carritos que alguien dejó a medias y los pagos que Mercado Pago rechazó.
// Son la venta más barata que tiene un comercio —ya eligieron, ya pusieron la
// tarjeta— y la pregunta "¿a quién le falta poco?" no tenía respuesta.
// ---------------------------------------------------------------------------

/** Cuántas filas devuelve como mucho una de estas listas. */
const TOPE_RECUPERACION = 50

/** Por qué lo rechazó el banco, dicho para una persona. */
const POR_QUE: Record<string, string> = {
  retry: 'un dato mal cargado: se arregla reintentando',
  funds: 'sin fondos suficientes',
  bank: 'lo frenó el banco',
  risk: 'sospecha de fraude — a esta gente NO se le escribe',
  other: 'otro motivo',
}

async function carritos(ctx: CapabilityContext, args: Record<string, unknown>) {
  const limite = Math.min(Number(args.limite) || 20, TOPE_RECUPERACION)
  let q = ctx.db
    .from('shopify_checkouts')
    .select(
      'id, checkout_id, customer_name, customer_email, customer_phone, total_price, currency, line_items, abandoned_checkout_url, status, completed_at, created_at, recovery_dispatched_at, recovery_attempts, recovery_last_error, platform',
    )
    .eq('workspace_id', ctx.workspaceId)
    .order('created_at', { ascending: false })
    .limit(limite)
  // Por defecto sólo los que siguen sin comprar: un carrito completado ya es
  // un pedido y vive en `pedidos.listar`.
  if (args.incluir_completados !== true) q = q.is('completed_at', null)

  const { data, error } = await q
  if (error) throw new Error(error.message)

  return {
    carritos: ((data ?? []) as unknown as Array<{
      id: string
      checkout_id: string | null
      customer_name: string | null
      customer_email: string | null
      customer_phone: string | null
      total_price: number | string | null
      currency: string | null
      line_items: unknown
      abandoned_checkout_url: string | null
      status: string | null
      completed_at: string | null
      created_at: string
      recovery_dispatched_at: string | null
      recovery_attempts: number | null
      recovery_last_error: string | null
      platform: string | null
    }>).map((c) => ({
      carrito_id: c.id,
      cliente: c.customer_name ?? c.customer_email ?? c.customer_phone ?? 'sin nombre',
      telefono: c.customer_phone,
      email: c.customer_email,
      monto: c.total_price,
      moneda: c.currency,
      que_llevaba: c.line_items,
      cuando: c.created_at,
      tienda: c.platform,
      // El enlace para terminar la compra: es lo que se le manda.
      enlace: c.abandoned_checkout_url,
      // Si ya se le escribió, cuántas veces, y si el envío falló.
      se_le_escribio: c.recovery_dispatched_at,
      intentos: c.recovery_attempts ?? 0,
      ultimo_error: c.recovery_last_error,
      // Comprado = dejó de ser un carrito abandonado.
      comprado_el: c.completed_at,
    })),
  }
}

async function pagosRechazados(ctx: CapabilityContext, args: Record<string, unknown>) {
  const limite = Math.min(Number(args.limite) || 20, TOPE_RECUPERACION)
  let q = ctx.db
    .from('mp_rejected_payments')
    .select(
      'id, payer_name, email, phone, amount, currency, installments, attempts, status_detail, reason_bucket, payment_method, recovery_url, rejected_at, contacted_at, dispatched_at, skip_reason, last_error, recovered_at, recovered_amount, paid_at',
    )
    .eq('workspace_id', ctx.workspaceId)
    .order('rejected_at', { ascending: false })
    .limit(limite)
  // Por defecto los que siguen sin pagar: el recuperado ya es una venta.
  if (args.incluir_recuperados !== true) q = q.is('recovered_at', null)

  const { data, error } = await q
  if (error) throw new Error(error.message)

  return {
    pagos: ((data ?? []) as unknown as Array<{
      id: string
      payer_name: string | null
      email: string | null
      phone: string | null
      amount: number | null
      currency: string | null
      installments: number | null
      attempts: number | null
      status_detail: string | null
      reason_bucket: string | null
      payment_method: string | null
      recovery_url: string | null
      rejected_at: string
      contacted_at: string | null
      skip_reason: string | null
      last_error: string | null
      recovered_at: string | null
      recovered_amount: number | null
      paid_at: string | null
    }>).map((p) => ({
      pago_id: p.id,
      cliente: p.payer_name ?? p.email ?? p.phone ?? 'sin nombre',
      telefono: p.phone,
      email: p.email,
      monto: p.amount,
      moneda: p.currency,
      cuotas: p.installments,
      intentos: p.attempts,
      cuando: p.rejected_at,
      medio: p.payment_method,
      por_que: POR_QUE[p.reason_bucket ?? 'other'] ?? p.reason_bucket,
      motivo_crudo: p.status_detail,
      enlace_para_reintentar: p.recovery_url,
      se_le_escribio: p.contacted_at,
      // Por qué NO se le escribió: casi siempre es sospecha de fraude o que no
      // dejó teléfono. Es la mitad de la respuesta a "¿por qué no se recupera?".
      no_se_le_escribio_porque: p.skip_reason,
      ultimo_error: p.last_error,
      recuperado_el: p.recovered_at,
      recuperado_monto: p.recovered_amount,
    })),
  }
}

/**
 * QUÉ LLEGÓ, Y A QUIÉN SE LE PREGUNTÓ CÓMO LE FUE.
 *
 * `pedidos.listar` dice el estado de envío que trae el pedido. Esta tabla dice
 * otra cosa: CUÁNDO se entregó de verdad y si Riverz ya le escribió para pedirle
 * la opinión. Es el único lugar donde vive el post-venta, y era el último hueco
 * de datos que quedaba sin mirar.
 */
async function entregas(ctx: CapabilityContext, args: Record<string, unknown>) {
  const limite = Math.min(Number(args.limite) || 30, 100)

  // El recorte por cuenta va por las tiendas del workspace: esta tabla se
  // indexa por dominio de tienda y no por workspace_id, así que sin este paso
  // una llamada devolvería los pedidos de otro comercio.
  const { data: conexiones } = await ctx.db
    .from('shopify_connections')
    .select('shop_domain')
    .eq('workspace_id', ctx.workspaceId)
  const dominios = ((conexiones ?? []) as Array<{ shop_domain: string }>).map(
    (c) => c.shop_domain,
  )
  if (dominios.length === 0) {
    return { entregas: [], nota: 'Esta cuenta no tiene ninguna tienda de Shopify conectada.' }
  }

  let q = ctx.db
    .from('shopify_order_fulfillment_state')
    .select(
      'order_id, shop_domain, fulfillment_status, shipment_status, financial_status, cancelled, delivered_at, feedback_dispatched_at, updated_at, contacts(name, phone)',
    )
    .in('shop_domain', dominios)
    .order('updated_at', { ascending: false })
    .limit(limite)
  if (args.solo_entregados === true) q = q.not('delivered_at', 'is', null)

  const { data, error } = await q
  if (error) throw new Error(error.message)

  return {
    entregas: ((data ?? []) as unknown as Array<{
      // Shopify lo manda como número, no como texto.
      order_id: number | string
      shop_domain: string
      fulfillment_status: string | null
      shipment_status: string | null
      financial_status: string | null
      cancelled: boolean | null
      delivered_at: string | null
      feedback_dispatched_at: string | null
      updated_at: string | null
      contacts: { name: string | null; phone: string | null } | null
    }>).map((e) => ({
      pedido: e.order_id,
      tienda: e.shop_domain,
      cliente: e.contacts?.name ?? e.contacts?.phone ?? null,
      estado_de_envio: e.fulfillment_status,
      estado_del_paquete: e.shipment_status,
      estado_del_pago: e.financial_status,
      cancelado: e.cancelled === true,
      // Cuándo llegó de verdad, que es distinto de cuándo se despachó.
      entregado_el: e.delivered_at,
      // Si ya se le preguntó cómo le fue. Sin esto, el post-venta es una caja
      // negra: no se sabe a quién se le escribió ni a quién falta.
      le_pedimos_opinion_el: e.feedback_dispatched_at,
      actualizado: e.updated_at,
    })),
  }
}


/**
 * Los pedidos, dibujados.
 *
 * Dos formas, y la diferencia importa: una LISTA de pedidos es una tabla —lo
 * que se busca ahí es encontrar uno—, y UN pedido es un recibo —lo que se mira
 * ahí es si los artículos y la plata están bien antes de aprobarlo—. Meter el
 * segundo en la forma del primero era pedir que se apruebe un cobro leyendo una
 * fila.
 */
function vistaPedidos(ctx: CapabilityContext, r: Awaited<ReturnType<typeof listar>>): Artefacto {
  const filas = lista<{
    order_number: string | null
    customer_name: string | null
    total_price: number | string | null
    currency: string | null
    financial_status: string | null
    shipping_status: string | null
    created_at: string
  }>(r, 'pedidos')
  return tabla({
    titulo: tt(ctx, 'operation.vTitPedidos'),
    columnas: [
      { clave: 'numero', titulo: tt(ctx, 'operation.vColPedido') },
      { clave: 'cliente', titulo: tt(ctx, 'operation.vColCliente') },
      { clave: 'estado', titulo: tt(ctx, 'operation.vColEstado') },
      { clave: 'cuando', titulo: tt(ctx, 'operation.vColCuando') },
      { clave: 'total', titulo: tt(ctx, 'operation.vColTotal'), alineado: 'der' },
    ],
    filas: filas.map((p) => ({
      numero: p.order_number ?? '—',
      cliente: corto(p.customer_name, 24),
      estado: [p.financial_status, p.shipping_status].filter(Boolean).join(' · ') || '—',
      cuando: fecha(ctx, p.created_at),
      total: plata(ctx, p.total_price, p.currency),
    })),
    vacio: tt(ctx, 'operation.vSinPedidos'),
  })
}

/**
 * Lo que se va a comprar, antes y después.
 *
 * Antes de aprobar no hay precio: cotizar es una llamada a la tienda y esto se
 * calcula sin `await`. Así que se dibuja lo que SÍ se sabe —para quién, qué y
 * cuánto— y se dice que el precio sale de la tienda. Mostrar un total inventado
 * en la tarjeta que se aprueba sería exactamente lo que esta capa evita.
 *
 * Después, con el pedido hecho, ya hay número y total: ahí sí es un recibo.
 */
function vistaCompra(
  ctx: CapabilityContext,
  args: Record<string, unknown>,
  result: unknown,
  esLink: boolean,
): Artefacto {
  const r = (result ?? null) as {
    pedido?: string | null
    contacto?: string
    total?: string | null
    link?: string
    que_lleva?: string
    seguimiento?: string | null
    estado_pago?: string
  } | null

  const cantidad = typeof args.cantidad === 'number' ? args.cantidad : 1
  const oferta = typeof args.oferta === 'string' ? args.oferta : ''

  if (!r) {
    return cambio({
      titulo: tt(ctx, esLink ? 'operation.vTitLinkPago' : 'operation.vTitCrearPedido'),
      que: [oferta || tt(ctx, 'operation.vLoQuePidio'), cantidad > 1 ? `× ${cantidad}` : '']
        .filter(Boolean)
        .join(' '),
      aviso: tt(ctx, 'operation.vPrecioDeLaTienda'),
    })
  }

  return {
    kind: 'pedido',
    nombre: r.pedido ?? undefined,
    cliente: r.contacto,
    items: [{ que: r.que_lleva || oferta || '—', cantidad, precio: r.total ?? '—' }],
    total: r.total ?? '—',
    estado: r.estado_pago,
    enlace: r.link ?? r.seguimiento ?? undefined,
  }
}

/**
 * Los carritos abandonados.
 *
 * La columna que decide qué hacer no es el monto: es si ya se le escribió. Sin
 * ella la lista invita a escribirle de nuevo a alguien a quien Riverz ya le
 * mandó tres mensajes.
 */
function vistaCarritos(ctx: CapabilityContext, r: unknown): Artefacto {
  const filas = lista<{
    cliente: string
    monto: number | string | null
    moneda: string | null
    cuando: string
    se_le_escribio: string | null
    intentos: number
    comprado_el: string | null
  }>(r, 'carritos')
  return tabla({
    titulo: tt(ctx, 'operation.vTitCarritos'),
    columnas: [
      { clave: 'cliente', titulo: tt(ctx, 'operation.vColCliente') },
      { clave: 'cuando', titulo: tt(ctx, 'operation.vColCuando') },
      { clave: 'escrito', titulo: tt(ctx, 'operation.vColSeLeEscribio') },
      { clave: 'monto', titulo: tt(ctx, 'operation.vColTotal'), alineado: 'der' },
    ],
    filas: filas.map((c) => ({
      cliente: corto(c.cliente, 24),
      cuando: fecha(ctx, c.cuando),
      escrito: c.comprado_el
        ? tt(ctx, 'operation.vCompro')
        : c.se_le_escribio
          ? `${tt(ctx, 'operation.vSi')} · ${c.intentos}`
          : tt(ctx, 'operation.vNo'),
      monto: plata(ctx, c.monto, c.moneda),
    })),
    vacio: tt(ctx, 'operation.vSinCarritos'),
  })
}

/**
 * Los pagos rechazados.
 *
 * Dos columnas y ninguna es el monto: por qué lo rechazaron —el banco, la
 * tarjeta, el saldo— y por qué NO se le escribió. La segunda es la mitad de la
 * respuesta a "¿por qué no se recupera nada?": casi siempre es sospecha de
 * fraude o que la persona no dejó teléfono.
 */
function vistaPagosRechazados(ctx: CapabilityContext, r: unknown): Artefacto {
  const filas = lista<{
    cliente: string
    monto: number | string | null
    moneda: string | null
    cuando: string
    por_que: string | null
    se_le_escribio: string | null
    no_se_le_escribio_porque: string | null
    recuperado_el: string | null
  }>(r, 'pagos')
  return tabla({
    titulo: tt(ctx, 'operation.vTitPagosRechazados'),
    columnas: [
      { clave: 'cliente', titulo: tt(ctx, 'operation.vColCliente') },
      { clave: 'porque', titulo: tt(ctx, 'operation.vColPorQue') },
      { clave: 'escrito', titulo: tt(ctx, 'operation.vColSeLeEscribio') },
      { clave: 'monto', titulo: tt(ctx, 'operation.vColTotal'), alineado: 'der' },
    ],
    filas: filas.map((p) => ({
      cliente: corto(p.cliente, 22),
      porque: corto(p.por_que, 28),
      escrito: p.recuperado_el
        ? tt(ctx, 'operation.vRecuperado')
        : p.se_le_escribio
          ? tt(ctx, 'operation.vSi')
          : corto(p.no_se_le_escribio_porque, 26),
      monto: plata(ctx, p.monto, p.moneda),
    })),
    vacio: tt(ctx, 'operation.vSinPagosRechazados'),
  })
}

/**
 * Qué llegó, y a quién se le preguntó cómo le fue.
 *
 * El post-venta vive sólo acá. La columna que lo hace útil es la última: sin
 * ella no se sabe a quién se le escribió y a quién falta.
 */
function vistaEntregas(ctx: CapabilityContext, r: unknown): Artefacto {
  const filas = lista<{
    pedido: number | string
    cliente: string | null
    estado_del_paquete: string | null
    estado_de_envio: string | null
    entregado_el: string | null
    le_pedimos_opinion_el: string | null
  }>(r, 'entregas')
  return tabla({
    titulo: tt(ctx, 'operation.vTitEntregas'),
    columnas: [
      { clave: 'pedido', titulo: tt(ctx, 'operation.vColPedido') },
      { clave: 'cliente', titulo: tt(ctx, 'operation.vColCliente') },
      { clave: 'estado', titulo: tt(ctx, 'operation.vColEstado') },
      { clave: 'entregado', titulo: tt(ctx, 'operation.vColEntregado') },
      { clave: 'opinion', titulo: tt(ctx, 'operation.vColOpinion') },
    ],
    filas: filas.map((e) => ({
      pedido: corto(String(e.pedido), 16),
      cliente: corto(e.cliente, 20),
      estado: corto(e.estado_del_paquete ?? e.estado_de_envio, 20),
      entregado: e.entregado_el ? fecha(ctx, e.entregado_el) : '—',
      opinion: e.le_pedimos_opinion_el
        ? fecha(ctx, e.le_pedimos_opinion_el)
        : tt(ctx, 'operation.vNo'),
    })),
    vacio: tt(ctx, 'operation.vSinEntregas'),
  })
}

/** Dar un pedido por cobrado: es plata que se marca como entrada. */
function vistaRegistrarPago(ctx: CapabilityContext, args: Record<string, unknown>): Artefacto {
  return cambio({
    titulo: tt(ctx, 'operation.vTitRegistrarPago'),
    que: tt(ctx, 'operation.vQueRegistrarPago'),
    alcance: args.monto != null ? String(args.monto) : undefined,
    aviso: tt(ctx, 'operation.vRegistrarPagoAviso'),
  })
}
export const ORDER_CAPABILITIES: Capability[] = [
  {
    key: 'pedidos.entregas',
    description:
      'Qué pedidos llegaron de verdad y a quién se le preguntó cómo le fue: el estado del paquete, cuándo se entregó y si Riverz ya le escribió pidiendo la opinión. Es distinto del estado de envío que trae el pedido — acá está el post-venta, que es donde se pierde la reseña que nadie pidió.',
    descriptionEn:
      'Which orders actually arrived and who was asked how it went: the shipment status, when it was delivered, and whether Riverz already messaged asking for their opinion. Different from the fulfillment status on the order — this is the post-purchase side, where the review nobody asked for gets lost.',
    risk: 'lectura',
    schema: {
      type: 'object',
      properties: {
        solo_entregados: { type: 'boolean' },
        limite: { type: 'number', description: 'Por defecto 30, máximo 100.' },
      },
    },
    run: entregas,
    vista: (ctx, _args, r) => vistaEntregas(ctx, r),
  },
  {
    key: 'pedidos.carritos',
    description:
      'Los carritos que alguien dejó a medias: quién es, cuánto llevaba, qué productos, el enlace para terminar la compra, y si ya se le escribió para recuperarlo (cuántas veces y si el envío falló). Es la venta más barata que hay: ya eligieron y no pagaron. Con incluir_completados=true trae también los que terminaron comprando.',
    descriptionEn:
      'The carts someone left half done: who they are, how much, which products, the link to finish the purchase, and whether they were already messaged to recover it (how many times and whether sending failed). It is the cheapest sale there is: they already chose and did not pay. With incluir_completados=true it also returns the ones that ended up buying.',
    risk: 'lectura',
    schema: {
      type: 'object',
      properties: {
        incluir_completados: { type: 'boolean' },
        limite: { type: 'number', description: `Por defecto 20, máximo ${TOPE_RECUPERACION}.` },
      },
    },
    run: carritos,
    vista: (ctx, _args, r) => vistaCarritos(ctx, r),
  },

  {
    key: 'pedidos.pagos_rechazados',
    description:
      'Los pagos que Mercado Pago rechazó: quién intentó pagar, cuánto, con qué medio, POR QUÉ se rechazó (dato mal cargado, sin fondos, lo frenó el banco, sospecha de fraude) y el enlace para reintentar. Dice también si ya se le escribió y, cuando no, por qué no — a los rechazos por fraude no se les escribe a propósito.',
    descriptionEn:
      'The payments Mercado Pago rejected: who tried to pay, how much, with what method, WHY it was rejected (bad data, no funds, the bank blocked it, suspected fraud) and the link to retry. It also says whether they were already messaged and, if not, why not — fraud rejections are deliberately never contacted.',
    risk: 'lectura',
    schema: {
      type: 'object',
      properties: {
        incluir_recuperados: { type: 'boolean' },
        limite: { type: 'number', description: `Por defecto 20, máximo ${TOPE_RECUPERACION}.` },
      },
    },
    run: pagosRechazados,
    vista: (ctx, _args, r) => vistaPagosRechazados(ctx, r),
  },
  {
    key: 'pedidos.listar',
    description:
      'Los pedidos de la cuenta con su estado de pago y de envío, incluido el seguimiento cuando existe. Sirve para contestarle a un cliente dónde está lo suyo.',
    descriptionEn:
      'The orders of the account with their payment and shipping status, including tracking when it exists. Useful for telling a customer where their package is.',
    risk: 'lectura',
    schema: {
      type: 'object',
      properties: {
        dias: { type: 'number', description: 'Ventana hacia atrás. Por defecto 30, máximo 90.' },
        estado_pago: {
          type: 'string',
          description: 'Filtrar por estado de pago, p. ej. "pending" o "paid".',
        },
      },
    },
    run: listar,
    vista: (ctx, _args, r) => vistaPedidos(ctx, r as Awaited<ReturnType<typeof listar>>),
  },

  {
    key: 'pedidos.checkout',
    description:
      'Arma el link de pago de la tienda para un cliente, con el producto y la cantidad (o el combo) que eligió. Cotiza el precio real de hoy y avisa si no hay stock. Devuelve el link: mandarlo sigue siendo decisión de una persona.',
    descriptionEn:
      "Builds the store's payment link for a customer, with the product and quantity (or bundle) they chose. Quotes today's real price and warns if stock is short. Returns the link: sending it is still a person's call.",
    risk: 'irreversible',
    schema: {
      type: 'object',
      properties: { ...ESQUEMA_COMPRA },
      required: ['contacto_id'],
    },
    async preview(ctx, args) {
      const contexto = await contextoDeCompra(ctx, args)
      const link = await cotizar(contexto, args)
      const nombre = quien(contexto.contacto)
      if ('error' in link) {
        throw new Error(`No se puede armar el link para ${nombre}: ${link.message}`)
      }
      const total = link.total_label ? ` por ${link.total_label}` : ''
      return `Armaría el link de pago de ${link.offer_label}${total} para ${nombre}. El link no se envía solo.`
    },
    run: checkout,
    artifact: (ctx, args, result) => vistaCompra(ctx, args, result, true),
  },

  {
    key: 'pedidos.crear',
    description:
      'Crea el pedido REAL en la tienda a nombre de un cliente. Descuenta stock y queda con el pago pendiente, para cobrar por transferencia o contra entrega. Úsalo cuando el cliente ya confirmó qué lleva y a dónde va; si sólo quiere pagar online, usa pedidos.checkout.',
    descriptionEn:
      'Creates the REAL order in the store under a customer name. It decrements stock and stays unpaid, to be collected by transfer or cash on delivery. Use it when the customer already confirmed what they take and where it ships; if they just want to pay online, use pedidos.checkout.',
    risk: 'irreversible',
    schema: {
      type: 'object',
      properties: {
        ...ESQUEMA_COMPRA,
        nombre: {
          type: 'string',
          description: 'Nombre y apellido para el pedido. Por defecto, el del contacto.',
        },
        direccion: {
          type: 'object',
          description: 'Dirección de envío. Necesaria para productos físicos.',
          properties: {
            address1: { type: 'string', description: 'Calle y número.' },
            address2: { type: 'string', description: 'Piso o departamento.' },
            city: { type: 'string' },
            province: { type: 'string', description: 'Provincia o estado.' },
            zip: { type: 'string', description: 'Código postal.' },
            country: { type: 'string' },
          },
        },
        nota: { type: 'string', description: 'Aclaración interna para el equipo.' },
      },
      required: ['contacto_id'],
    },
    async preview(ctx, args) {
      const contexto = await contextoDeCompra(ctx, args)
      const nombre =
        (typeof args.nombre === 'string' && args.nombre.trim()) ||
        quien(contexto.contacto)
      // Se cotiza con el mismo camino que el link de pago porque crear el
      // pedido para saber cuánto sale ya sería haberlo creado.
      const cotizacion = await cotizar(contexto, args)
      if ('error' in cotizacion) {
        throw new Error(`No se puede crear el pedido de ${nombre}: ${cotizacion.message}`)
      }
      const dir = args.direccion as ShippingAddressInput | undefined
      const envio = dir?.address1
        ? ` con envío a ${[dir.address1, dir.city, dir.province].filter(Boolean).join(', ')}`
        : ' SIN dirección de envío'
      const total = cotizacion.total_label ? ` por ${cotizacion.total_label}` : ''
      return `Crearía el pedido real de ${cotizacion.offer_label}${total} a nombre de ${nombre}${envio}. Descuenta stock y queda con el pago pendiente.`
    },
    run: crear,
    artifact: (ctx, args, result) => vistaCompra(ctx, args, result, false),
  },

  {
    key: 'pedidos.registrar_pago',
    description:
      'Registra que un cliente informó haber pagado su pedido pendiente (transferencia, depósito). Con el monto exacto del comprobante el pedido se marca pagado en la tienda; sin monto, o si no coincide, queda esperando que el dueño de la cuenta lo confirme. En los dos casos dejan de salir los recordatorios de pago.',
    descriptionEn:
      "Records that a customer reported paying their pending order (transfer, deposit). With the exact amount from the receipt the order is marked paid in the store; without it, or if it does not match, it waits for the account owner to confirm. Either way payment reminders stop.",
    risk: 'irreversible',
    schema: {
      type: 'object',
      properties: {
        contacto_id: {
          type: 'string',
          description: 'El cliente que dice haber pagado.',
        },
        monto: {
          type: 'number',
          description:
            'Lo que dice el comprobante. Sin separadores de miles. Si no se lee con certeza, omitilo: no lo inventes.',
        },
        nota: {
          type: 'string',
          description: 'Qué se vio, para que quien confirme entienda el caso.',
        },
      },
      required: ['contacto_id'],
    },
    async preview(ctx, args) {
      const contactId = String(args.contacto_id ?? '').trim()
      const pedido = await pendingOrderFor(ctx.db, ctx.workspaceId, contactId)
      if (!pedido) {
        throw new Error('Ese contacto no tiene ningún pedido pendiente de pago en esta cuenta.')
      }
      const suyo = `el pedido ${pedido.orderNumber ?? 's/n'} de ${fmtMoney(
        Number(pedido.total ?? 0),
        pedido.currency,
      )}`
      const monto = typeof args.monto === 'number' ? args.monto : null
      const reglas = await leerReglasDeCobro(ctx.db, ctx.workspaceId)
      // Desde acá no hay imagen ni número de operación: el Operador registra lo
      // que le contó una persona, no lo que leyó de un comprobante. Si la
      // cuenta exige alguna de las dos cosas, esto NUNCA cobra solo — y
      // prometerlo era la diferencia entre "ya está" y "te aviso en un rato".
      const puedeSinComprobante = !reglas.exigeComprobante && !reglas.exigeReferencia
      const coincide =
        monto != null && montoCoincide(pedido.total, monto, reglas.toleranciaPct)
      // Las dos ramas son muy distintas —una cobra en Shopify, la otra sólo
      // pregunta— y quien aprueba tiene que saber cuál le toca.
      if (coincide && puedeSinComprobante) {
        return `El comprobante de ${fmtMoney(monto!, pedido.currency)} coincide: marcaría ${suyo} como PAGADO en la tienda y dejaría de mandarle recordatorios.`
      }
      // El motivo más concreto primero: que el monto no cierre es más útil que
      // "falta el comprobante", porque es lo único que se puede corregir acá.
      const porque =
        monto == null
          ? 'sin monto en el comprobante'
          : !coincide
            ? `el comprobante dice ${fmtMoney(monto, pedido.currency)} y no coincide`
            : 'tu cuenta pide ver el comprobante antes de dar algo por cobrado'
      return `Dejaría de mandarle recordatorios por ${suyo}, pero NO lo daría por cobrado (${porque}): te preguntaría por WhatsApp antes.`
    },
    run: registrarPago,
    artifact: (ctx, args) => vistaRegistrarPago(ctx, args),
  },
]
