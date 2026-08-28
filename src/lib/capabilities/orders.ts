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
import { since, windowDays } from './predicates'
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

export const ORDER_CAPABILITIES: Capability[] = [
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
      // Las dos ramas son muy distintas —una cobra en Shopify, la otra sólo
      // pregunta— y quien aprueba tiene que saber cuál le toca.
      if (monto != null && montoCoincide(pedido.total, monto)) {
        return `El comprobante de ${fmtMoney(monto, pedido.currency)} coincide: marcaría ${suyo} como PAGADO en la tienda y dejaría de mandarle recordatorios.`
      }
      const porque =
        monto == null
          ? 'sin monto en el comprobante'
          : `el comprobante dice ${fmtMoney(monto, pedido.currency)} y no coincide`
      return `Dejaría de mandarle recordatorios por ${suyo}, pero NO lo daría por cobrado (${porque}): te preguntaría por WhatsApp antes.`
    },
    run: registrarPago,
  },
]
