import type { SupabaseClient } from '@supabase/supabase-js'
import type { ChannelConnection } from '@/types'
import { getStoreByDomain } from '@/lib/commerce/connection'
import { ShopifyAdminClient } from '@/lib/shopify/admin-client'
import { TiendanubeClient } from '@/lib/commerce/providers/tiendanube'
import { WooCommerceClient } from '@/lib/commerce/providers/woocommerce'
import { getFreshMLToken } from '@/lib/channels/mercadolibre/adapter'
import { getLogger } from '@/lib/log/logger'

const log = getLogger('products.imagenes')

/**
 * Tope de la galería de un producto. Lo comparte `write.ts`: si acá entraran
 * más de las que el guardado acepta, el editor las mostraría y el siguiente
 * "Guardar cambios" borraría la mitad sin decir nada.
 */
export const MAX_IMAGENES = 12

/**
 * Traer TODAS las fotos que la publicación tiene en su plataforma.
 *
 * El sync del catálogo guarda una sola imagen (`image_url`) aunque la
 * plataforma devuelva ocho: la columna `images` sólo se llenaba con lo que el
 * comercio subía a mano. Así que el producto en Riverz se veía con una foto y
 * la tienda con la galería entera, y el agente no podía mandar más que esa.
 *
 * Acá se resuelve del lado del producto ya sincronizado: se piden las fotos a
 * cada plataforma donde vive el producto —las publicaciones unificadas
 * (`master_id`, migración 183) cuentan como la misma cosa— y se suman a lo que
 * ya había, sin pisar lo que el comercio subió.
 */

/** Una fila del catálogo, con lo justo para pedirle las fotos a su plataforma. */
interface FilaCatalogo {
  id: string
  platform: string | null
  shop_domain: string | null
  external_id: number | string | null
  handle: string | null
  image_url: string | null
  raw: unknown
}

/**
 * Las URLs de imagen del payload crudo de la plataforma.
 *
 * Cada tienda las nombra distinto pero todas las mandan completas en el
 * producto: Shopify/Tiendanube/WooCommerce en `images[].src`, Mercado Libre en
 * `pictures[]`. Es la única lectura que funciona incluso sin credencial viva.
 */
export function imagenesDeRaw(platform: string | null, raw: unknown): string[] {
  if (!raw || typeof raw !== 'object') return []
  const p = raw as Record<string, unknown>

  if (platform === 'mercadolibre') {
    const pics = Array.isArray(p.pictures) ? p.pictures : []
    return pics
      .map((x) => {
        const pic = (x ?? {}) as Record<string, unknown>
        return String(pic.secure_url ?? pic.url ?? '')
      })
      .filter(Boolean)
  }

  const imgs = Array.isArray(p.images) ? p.images : []
  const urls = imgs
    .map((x) => {
      const img = (x ?? {}) as Record<string, unknown>
      // Tiendanube y WooCommerce usan `src`; Shopify también. `url` es el
      // nombre que usan algunas respuestas de WooCommerce viejas.
      return String(img.src ?? img.url ?? '')
    })
    .filter(Boolean)
  // Shopify manda además la principal suelta en `image`.
  const principal = (p.image ?? null) as Record<string, unknown> | null
  const suelta = principal ? String(principal.src ?? '') : ''
  return suelta ? [suelta, ...urls] : urls
}

/**
 * Clave de comparación: la misma foto vuelve con otra query string en cada
 * sync (`?v=1712…` en Shopify, `?w=1024` en Tiendanube). Sin normalizar, cada
 * resincronización agregaría la galería entera de nuevo.
 */
function clave(url: string): string {
  const limpia = url.split('#')[0].split('?')[0].trim().toLowerCase()
  return limpia.replace(/^http:/, 'https:')
}

/** Suma sin repetir y conservando el orden de llegada, dentro del tope. */
export function unirImagenes(actuales: string[], nuevas: string[]): string[] {
  const vistas = new Set(actuales.map(clave))
  // El recorte incluye lo que ya estaba: una galería que quedó larga de antes
  // se normaliza acá, en vez de encogerse sola en el próximo guardado.
  const out = actuales.slice(0, MAX_IMAGENES)
  for (const url of nuevas) {
    // El corte va ANTES de sumar: comprobarlo después dejaba entrar una de más.
    if (out.length >= MAX_IMAGENES) break
    if (!/^https?:\/\//i.test(url)) continue
    const k = clave(url)
    if (vistas.has(k)) continue
    vistas.add(k)
    out.push(url)
  }
  return out
}

/**
 * Le pide a la plataforma la publicación de nuevo. Si la credencial no está o
 * la llamada falla, devolvemos null y el llamador cae al `raw` guardado: una
 * galería del último sync es mejor que un error.
 */
async function imagenesEnVivo(
  admin: SupabaseClient,
  fila: FilaCatalogo,
  workspaceId: string | null,
): Promise<string[] | null> {
  const platform = fila.platform ?? 'shopify'
  const shopDomain = fila.shop_domain ?? ''
  if (!shopDomain) return null

  try {
    if (platform === 'mercadolibre') {
      // El id de Mercado Libre es alfanumérico ("MLA123…") y vive en `handle`.
      const itemId = String(fila.handle ?? '')
      if (!itemId) return null
      const sellerId = shopDomain.replace(/^mercadolibre:/, '')
      const { data } = await admin
        .from('channel_connections')
        .select('*')
        .eq('channel', 'mercadolibre')
        .eq('workspace_id', workspaceId ?? '')
        .order('created_at', { ascending: false })
      const conn = ((data ?? []) as ChannelConnection[]).find(
        (c) =>
          String((c.config as Record<string, unknown> | null)?.seller_id ?? '') ===
          sellerId,
      )
      if (!conn) return null
      const token = await getFreshMLToken(conn)
      const res = await fetch(`https://api.mercadolibre.com/items/${itemId}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) return null
      return imagenesDeRaw('mercadolibre', await res.json())
    }

    if (platform === 'shopify' || platform === 'tiendanube' || platform === 'woocommerce') {
      const store = await getStoreByDomain(admin, platform, shopDomain)
      if (!store) return null
      const externalId = String(fila.external_id ?? '')
      if (!externalId) return null

      if (platform === 'shopify') {
        const client = new ShopifyAdminClient(store.shopDomain, store.accessToken)
        const body = await client.rest<{ product?: unknown }>(
          `/products/${externalId}.json`,
        )
        return imagenesDeRaw('shopify', body.product)
      }
      if (platform === 'tiendanube') {
        if (!store.externalStoreId) return null
        const client = new TiendanubeClient(
          store.externalStoreId,
          store.accessToken,
          store.shopDomain,
        )
        return imagenesDeRaw('tiendanube', await client.get(`/products/${externalId}`))
      }
      if (!store.apiSecret) return null
      const client = new WooCommerceClient(
        store.shopDomain,
        store.accessToken,
        store.apiSecret,
      )
      return imagenesDeRaw('woocommerce', await client.get(`/products/${externalId}`))
    }
  } catch (err) {
    log.warn('no se pudieron pedir las fotos en vivo', {
      platform,
      shopDomain,
      error: err instanceof Error ? err.message : String(err),
    })
  }
  return null
}

export interface ResultadoImagenes {
  /** La galería final, ya guardada en el producto. */
  imagenes: string[]
  /** Cuántas fotos nuevas entraron. */
  agregadas: number
  /** Plataformas de las que se leyó (incluye las publicaciones unificadas). */
  plataformas: string[]
}

export type FalloImagenes = 'no_existe' | 'sin_plataforma'

/**
 * Rellena `images` con la galería completa de la plataforma (o plataformas, si
 * el producto está unificado) y la guarda.
 *
 * `db` es el cliente del usuario: la RLS de la migración 057 ya recorta a los
 * productos de su workspace, así que no hace falta pasar el workspace. `admin`
 * es el de servicio, y sólo se usa para leer credenciales de tienda: el grant
 * de columnas de la migración 126 le esconde el `access_token` al cliente de
 * cookie.
 */
export async function resincronizarImagenes(
  db: SupabaseClient,
  admin: SupabaseClient,
  args: { id: string },
): Promise<
  | { ok: true; resultado: ResultadoImagenes }
  | { ok: false; motivo: FalloImagenes }
> {
  const columnas =
    'id, platform, shop_domain, external_id, handle, image_url, images, master_id, workspace_id, raw'
  const { data: producto } = await db
    .from('shopify_products')
    .select(columnas)
    .eq('id', args.id)
    .maybeSingle()
  if (!producto) return { ok: false, motivo: 'no_existe' }

  const fila = producto as FilaCatalogo & {
    images: string[] | null
    master_id: string | null
    workspace_id: string | null
  }

  // El grupo entero: si esto es la misma remera publicada en Shopify y en
  // Mercado Libre, las fotos de las dos publicaciones son del mismo producto.
  const principalId = fila.master_id ?? fila.id
  const { data: hermanas } = await db
    .from('shopify_products')
    .select(columnas)
    .or(`id.eq.${principalId},master_id.eq.${principalId}`)

  const grupo = ((hermanas ?? []) as FilaCatalogo[]).filter((x) => x.id !== fila.id)
  // La publicación abierta va primero: su foto principal manda.
  const filas = [fila, ...grupo]

  const plataformas: string[] = []
  let nuevas: string[] = []
  for (const f of filas) {
    if (!f.shop_domain || f.shop_domain === 'manual') continue
    const enVivo = await imagenesEnVivo(admin, f, fila.workspace_id)
    const desdeLaPlataforma = enVivo ?? imagenesDeRaw(f.platform, f.raw)
    if (desdeLaPlataforma.length === 0) continue
    plataformas.push(f.platform ?? 'shopify')
    nuevas = [...nuevas, ...desdeLaPlataforma]
  }

  if (plataformas.length === 0) return { ok: false, motivo: 'sin_plataforma' }

  const actuales =
    Array.isArray(fila.images) && fila.images.length
      ? fila.images
      : fila.image_url
        ? [fila.image_url]
        : []
  const imagenes = unirImagenes(actuales, nuevas)
  // Cuántas son realmente nuevas, no cuánto creció la lista: si la galería
  // venía pasada del tope, la resta daba negativa.
  const previas = new Set(actuales.map(clave))
  const agregadas = imagenes.filter((u) => !previas.has(clave(u))).length

  if (agregadas > 0) {
    const { error } = await db
      .from('shopify_products')
      .update({ images: imagenes })
      .eq('id', fila.id)
    if (error) log.warn('no se pudo guardar la galería', { error: error.message })
  }

  return {
    ok: true,
    resultado: { imagenes, agregadas, plataformas: [...new Set(plataformas)] },
  }
}
