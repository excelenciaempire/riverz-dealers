import type { SupabaseClient } from '@supabase/supabase-js'
import { resolveStoreForLookup } from './order-lookup'

/**
 * Crear un pedido en una tienda que NO es Shopify.
 *
 * Tiendanube y WooCommerce podían conversar y no podían vender: crear el pedido
 * existía sólo para Shopify, así que dos de las cuatro plataformas llegaban
 * hasta "te paso el link" y ahí se terminaba. Sus credenciales ya venían con
 * permiso de escritura — el bloqueo era código.
 *
 * El pedido nace **pendiente de pago**, igual que el de Shopify: esto no cobra.
 * Cobrar es otra cosa y ya tiene su camino (`crear_link_de_pago`).
 *
 * Los nombres de campo no se adivinaron: se leyó un pedido de una tienda
 * Tiendanube viva y después se creó uno de prueba —y se canceló— para
 * confirmar cuáles acepta al escribir. No es lo mismo: los datos de contacto
 * se DEVUELVEN sueltos (`contact_name`) y se ACEPTAN anidados (`customer`), y
 * mandarlos como los devuelve deja el pedido a nombre de "No informado".
 */

export interface LineaDePedido {
  variant_id: string
  quantity: number
  /** Precio unitario. Si falta, la plataforma usa el suyo. */
  price?: number | null
}

export interface DatosDelCliente {
  name?: string | null
  email?: string | null
  phone?: string | null
  address?: {
    address1?: string | null
    address2?: string | null
    city?: string | null
    province?: string | null
    zip?: string | null
    country?: string | null
  } | null
}

export interface PedidoCreado {
  platform: 'tiendanube' | 'woocommerce'
  external_id: string
  order_number: string | null
  total: number | null
  currency: string | null
  /** A dónde mandar a la clienta para pagar, cuando la plataforma lo da. */
  pay_url: string | null
}

export interface PedidoError {
  error: 'sin_tienda' | 'plataforma_no_soportada' | 'sin_lineas' | 'rechazo'
  message: string
}

const UA = 'Riverz (soporte@riverz.co)'

/**
 * El país, como lo quiere la plataforma.
 *
 * Tiendanube y WooCommerce esperan el código ISO de dos letras y rechazan el
 * nombre: mandar "Colombia" devuelve `422 No country with code Colombia` y el
 * pedido no se crea. El agente escribe el nombre —es lo que le dijo la
 * clienta— así que traducirlo acá es la única forma de que la venta no se caiga
 * por cómo se escribió una palabra.
 *
 * La lista cubre los países donde operan estas plataformas y las formas en que
 * la gente los escribe. Lo que no reconoce se pasa tal cual: es preferible que
 * la tienda conteste su propio error a que inventemos un código equivocado.
 */
const PAISES: Record<string, string> = {
  argentina: 'AR',
  bolivia: 'BO',
  brasil: 'BR',
  brazil: 'BR',
  chile: 'CL',
  colombia: 'CO',
  'costa rica': 'CR',
  ecuador: 'EC',
  'el salvador': 'SV',
  espana: 'ES',
  guatemala: 'GT',
  honduras: 'HN',
  mexico: 'MX',
  nicaragua: 'NI',
  panama: 'PA',
  paraguay: 'PY',
  peru: 'PE',
  portugal: 'PT',
  'puerto rico': 'PR',
  'republica dominicana': 'DO',
  'estados unidos': 'US',
  'united states': 'US',
  usa: 'US',
  uruguay: 'UY',
  venezuela: 'VE',
}

export function codigoDePais(valor: string | null | undefined): string {
  const crudo = (valor ?? '').trim()
  if (!crudo) return ''
  // Ya viene como código.
  if (/^[A-Za-z]{2}$/.test(crudo)) return crudo.toUpperCase()
  const llave = crudo
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
  return PAISES[llave] ?? crudo
}

/**
 * Crea el pedido en la tienda del comercio, sea cual sea.
 *
 * Devuelve el error tipado en vez de lanzar: esto corre dentro del bucle de
 * herramientas del agente, y una excepción ahí corta la conversación.
 */
export async function crearPedidoEnLaTienda(
  db: SupabaseClient,
  args: {
    workspaceId: string
    lineas: LineaDePedido[]
    cliente: DatosDelCliente
    nota?: string | null
  },
): Promise<PedidoCreado | PedidoError> {
  const lineas = (args.lineas ?? [])
    .map((l) => ({
      variant_id: String(l.variant_id ?? '').trim(),
      quantity: Math.max(1, Math.floor(Number(l.quantity ?? 1)) || 1),
      price: l.price != null && Number.isFinite(Number(l.price)) ? Number(l.price) : null,
    }))
    .filter((l) => /^\d+$/.test(l.variant_id))
  if (lineas.length === 0) {
    return { error: 'sin_lineas', message: 'No hay productos para el pedido.' }
  }

  const tienda = await resolveStoreForLookup(db, args.workspaceId)
  if (!tienda) {
    return { error: 'sin_tienda', message: 'No hay una tienda conectada.' }
  }

  try {
    if (tienda.platform === 'tiendanube') {
      return await crearEnTiendanube(tienda, lineas, args)
    }
    if (tienda.platform === 'woocommerce') {
      return await crearEnWoo(tienda, lineas, args)
    }
    return {
      error: 'plataforma_no_soportada',
      message: `Crear pedidos no está disponible para ${tienda.platform}.`,
    }
  } catch (e) {
    return {
      error: 'rechazo',
      message: e instanceof Error ? e.message.slice(0, 250) : 'La tienda rechazó el pedido.',
    }
  }
}

type Tienda = NonNullable<Awaited<ReturnType<typeof resolveStoreForLookup>>>

// ── Tiendanube ───────────────────────────────────────────────────

async function crearEnTiendanube(
  tienda: Tienda,
  lineas: Array<{ variant_id: string; quantity: number; price: number | null }>,
  args: { cliente: DatosDelCliente; nota?: string | null },
): Promise<PedidoCreado | PedidoError> {
  const dir = args.cliente.address ?? null
  const cuerpo: Record<string, unknown> = {
    products: lineas.map((l) => ({
      variant_id: Number(l.variant_id),
      quantity: l.quantity,
      ...(l.price != null ? { price: l.price.toFixed(2) } : {}),
    })),
    // Los datos de la clienta van DENTRO de `customer`, aunque la API los
    // devuelva sueltos como `contact_name`/`contact_email` al leer el pedido.
    // Comprobado contra una tienda real: mandándolos sueltos, Tiendanube los
    // ignora y el pedido queda a nombre de "No informado" — o sea, una venta
    // sin saber de quién es.
    ...(args.cliente.name || args.cliente.email || args.cliente.phone
      ? {
          customer: {
            ...(args.cliente.name ? { name: args.cliente.name } : {}),
            ...(args.cliente.email ? { email: args.cliente.email } : {}),
            ...(args.cliente.phone ? { phone: args.cliente.phone } : {}),
          },
        }
      : {}),
    ...(dir?.address1
      ? {
          shipping_address: {
            address: [dir.address1, dir.address2].filter(Boolean).join(', '),
            city: dir.city ?? '',
            province: dir.province ?? '',
            zipcode: dir.zip ?? '',
            country: codigoDePais(dir.country),
            name: args.cliente.name ?? '',
            phone: args.cliente.phone ?? '',
          },
        }
      : {}),
    // Abierto y sin pagar: el pedido queda esperando el cobro, que es lo que
    // corresponde — esta función no cobra.
    status: 'open',
    payment_status: 'pending',
    gateway: 'offline',
    ...(args.nota ? { note: args.nota.slice(0, 500) } : {}),
    // Que el comercio vea de dónde salió sin tener que preguntarlo.
    owner_note: 'Creado por el asistente de Riverz',
  }

  const res = await fetch(`https://api.tiendanube.com/v1/${tienda.externalStoreId}/orders`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${tienda.accessToken}`,
      // La API vieja usaba esta cabecera; mandar las dos cubre ambas
      // generaciones, igual que hace `TiendanubeClient`.
      Authentication: `bearer ${tienda.accessToken}`,
      'User-Agent': UA,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(cuerpo),
  })

  if (!res.ok) {
    const texto = await res.text().catch(() => '')
    return {
      error: 'rechazo',
      message: `Tiendanube rechazó el pedido (${res.status}): ${texto.slice(0, 250)}`,
    }
  }

  const o = (await res.json()) as {
    id?: number
    number?: number
    total?: string
    currency?: string
    // Enlace al checkout del pedido: es a donde mandar a pagar.
    checkout_enabled?: boolean
    gateway_link?: string | null
  }
  return {
    platform: 'tiendanube',
    external_id: String(o.id ?? ''),
    order_number: o.number != null ? String(o.number) : null,
    total: o.total != null ? Number(o.total) : null,
    currency: o.currency ?? null,
    pay_url: o.gateway_link ?? null,
  }
}

// ── WooCommerce ──────────────────────────────────────────────────

async function crearEnWoo(
  tienda: Tienda,
  lineas: Array<{ variant_id: string; quantity: number; price: number | null }>,
  args: { cliente: DatosDelCliente; nota?: string | null },
): Promise<PedidoCreado | PedidoError> {
  if (!tienda.storeUrl || !tienda.apiSecret) {
    return { error: 'sin_tienda', message: 'Faltan credenciales de la tienda.' }
  }
  const dir = args.cliente.address ?? null
  const nombre = (args.cliente.name ?? '').trim().split(/\s+/)
  const facturacion = {
    first_name: nombre[0] ?? '',
    last_name: nombre.slice(1).join(' '),
    email: args.cliente.email ?? '',
    phone: args.cliente.phone ?? '',
    ...(dir?.address1
      ? {
          address_1: dir.address1,
          address_2: dir.address2 ?? '',
          city: dir.city ?? '',
          state: dir.province ?? '',
          postcode: dir.zip ?? '',
          country: codigoDePais(dir.country),
        }
      : {}),
  }

  const base = tienda.storeUrl.replace(/\/+$/, '')
  const auth = Buffer.from(`${tienda.accessToken}:${tienda.apiSecret}`).toString('base64')

  const res = await fetch(`${base}/wp-json/wc/v3/orders`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'User-Agent': UA,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      // `pending` = creado y esperando el pago, igual que en las otras dos.
      status: 'pending',
      line_items: lineas.map((l) => ({
        variation_id: Number(l.variant_id),
        quantity: l.quantity,
      })),
      billing: facturacion,
      shipping: facturacion,
      customer_note: args.nota?.slice(0, 500) ?? '',
    }),
  })

  if (!res.ok) {
    const texto = await res.text().catch(() => '')
    return {
      error: 'rechazo',
      message: `WooCommerce rechazó el pedido (${res.status}): ${texto.slice(0, 250)}`,
    }
  }

  const o = (await res.json()) as {
    id?: number
    number?: string
    total?: string
    currency?: string
    payment_url?: string
  }
  return {
    platform: 'woocommerce',
    external_id: String(o.id ?? ''),
    order_number: o.number ?? null,
    total: o.total != null ? Number(o.total) : null,
    currency: o.currency ?? null,
    // Woo entrega el link de pago del pedido: es lo que se le manda a la
    // clienta para que termine.
    pay_url: o.payment_url ?? null,
  }
}
