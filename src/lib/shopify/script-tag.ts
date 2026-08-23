import type { SupabaseClient } from '@supabase/supabase-js'
import { ShopifyAdminClient } from './admin-client'
import { decrypt } from '@/lib/whatsapp/encryption'
import { shopifyApiVersion } from './oauth'

/**
 * Poner el chat en la tienda sin que nadie toque código.
 *
 * Hasta acá instalarlo era copiar un snippet y pegarlo en `theme.liquid`. Ese
 * es el paso donde se cae la adopción: el comercio que conectó Shopify en dos
 * clics ahora tiene que abrir el editor de código de su tema, y la mitad no lo
 * hace. Los chats con los que competimos se instalan solos.
 *
 * Shopify lo permite con un ScriptTag: una etiqueta `<script src>` que la
 * tienda inyecta en todas las páginas de la vidriera. Sólo admite el `src`, no
 * atributos — por eso el cargador acepta la llave por la query (`?k=`).
 *
 * Es idempotente: se busca el nuestro antes de crear, así que apretar el botón
 * dos veces no deja dos widgets. Y como la llave viaja en el `src`, si el
 * comercio la rota hay que reemplazarlo, no sumar otro.
 */

const MARCA = '/widget/v1.js'

export interface ResultadoInstalacion {
  ok: boolean
  /** Ya estaba puesto antes de esta llamada. */
  yaEstaba?: boolean
  scriptTagId?: string
  error?: 'sin_tienda' | 'sin_permiso' | 'rechazo'
  message?: string
}

async function clienteDeLaTienda(
  db: SupabaseClient,
  workspaceId: string,
): Promise<{ client: ShopifyAdminClient; shopDomain: string } | null> {
  const { data } = await db
    .from('shopify_connections')
    .select('shop_domain, access_token')
    .eq('workspace_id', workspaceId)
    .eq('status', 'active')
    .eq('platform', 'shopify')
    .limit(1)
    .maybeSingle()
  const fila = data as { shop_domain?: string; access_token?: string } | null
  if (!fila?.shop_domain || !fila.access_token) return null
  return {
    shopDomain: fila.shop_domain,
    client: new ShopifyAdminClient(
      fila.shop_domain,
      decrypt(fila.access_token),
      shopifyApiVersion(),
    ),
  }
}

interface ScriptTag {
  id?: number
  src?: string
}

/** Instala (o deja como está) el cargador en la vidriera del comercio. */
export async function instalarWidget(
  db: SupabaseClient,
  workspaceId: string,
  widgetKey: string,
  base: string,
): Promise<ResultadoInstalacion> {
  const tienda = await clienteDeLaTienda(db, workspaceId)
  if (!tienda) {
    return { ok: false, error: 'sin_tienda', message: 'No hay una tienda Shopify conectada.' }
  }

  const src = `${base}${MARCA}?k=${encodeURIComponent(widgetKey)}`

  try {
    const existentes = await tienda.client.rest<{ script_tags?: ScriptTag[] }>(
      '/script_tags.json?limit=250',
    )
    const nuestros = (existentes.script_tags ?? []).filter((t) =>
      (t.src ?? '').includes(MARCA),
    )
    const igual = nuestros.find((t) => t.src === src)
    if (igual?.id) {
      return { ok: true, yaEstaba: true, scriptTagId: String(igual.id) }
    }

    // Los nuestros que apuntan a otra llave se borran: la llave viaja en el
    // `src`, así que dejarlos sumaría un segundo widget con la cuenta vieja.
    for (const viejo of nuestros) {
      if (viejo.id) {
        await tienda.client
          .rest(`/script_tags/${viejo.id}.json`, { method: 'DELETE' })
          .catch(() => {})
      }
    }

    const creado = await tienda.client.rest<{ script_tag?: ScriptTag }>('/script_tags.json', {
      method: 'POST',
      body: { script_tag: { event: 'onload', src, display_scope: 'online_store' } },
    })
    const id = creado.script_tag?.id
    if (!id) {
      return { ok: false, error: 'rechazo', message: 'Shopify no confirmó la instalación.' }
    }
    return { ok: true, scriptTagId: String(id) }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    // El caso con arreglo se nombra: la tienda se conectó antes de que el set
    // de permisos incluyera los ScriptTags y hay que reconectarla.
    if (/\b(401|403)\b/.test(msg)) {
      return {
        ok: false,
        error: 'sin_permiso',
        message: 'Falta permiso en Shopify. Reconectá la tienda y volvé a intentar.',
      }
    }
    return { ok: false, error: 'rechazo', message: msg.slice(0, 200) }
  }
}

/** Lo saca de la tienda. Apagar el chat tiene que sacarlo de la vidriera. */
export async function desinstalarWidget(
  db: SupabaseClient,
  workspaceId: string,
): Promise<ResultadoInstalacion> {
  const tienda = await clienteDeLaTienda(db, workspaceId)
  if (!tienda) return { ok: false, error: 'sin_tienda' }
  try {
    const existentes = await tienda.client.rest<{ script_tags?: ScriptTag[] }>(
      '/script_tags.json?limit=250',
    )
    for (const t of existentes.script_tags ?? []) {
      if (t.id && (t.src ?? '').includes(MARCA)) {
        await tienda.client.rest(`/script_tags/${t.id}.json`, { method: 'DELETE' })
      }
    }
    return { ok: true }
  } catch (e) {
    return { ok: false, error: 'rechazo', message: e instanceof Error ? e.message : undefined }
  }
}

/**
 * ¿Está puesto?
 *
 * Devuelve el MOTIVO cuando no se sabe, no un null mudo. La tienda que se
 * conectó antes de que existiera este permiso responde 403, y esconder el
 * bloque ahí dejaba al comercio sin enterarse de que la instalación
 * automática existe — justo el que más la necesita.
 */
export async function widgetInstalado(
  db: SupabaseClient,
  workspaceId: string,
): Promise<{ installed: boolean | null; reason?: 'sin_tienda' | 'sin_permiso' }> {
  const tienda = await clienteDeLaTienda(db, workspaceId)
  if (!tienda) return { installed: null, reason: 'sin_tienda' }
  try {
    const existentes = await tienda.client.rest<{ script_tags?: ScriptTag[] }>(
      '/script_tags.json?limit=250',
    )
    return {
      installed: (existentes.script_tags ?? []).some((t) => (t.src ?? '').includes(MARCA)),
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (/(401|403)/.test(msg)) return { installed: null, reason: 'sin_permiso' }
    return { installed: null }
  }
}
