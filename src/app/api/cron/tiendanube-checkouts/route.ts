import { NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { assertCronAuth } from '@/lib/auth/cron'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { withCronRun } from '@/lib/cron/heartbeat'
import { getStoreByDomain, markStoreExpired } from '@/lib/commerce/connection'
import {
  TiendanubeClient,
  normalizeTiendanubeCheckout,
} from '@/lib/commerce/providers/tiendanube'
import { ingestCheckout } from '@/lib/commerce/ingest'
import { StoreUnauthorizedError } from '@/lib/commerce/types'
import { getLogger } from '@/lib/log/logger'

const log = getLogger('cron.tiendanube-checkouts')

/**
 * Descubrimiento de carritos abandonados de Tiendanube.
 *
 * Tiendanube NO emite webhook de carrito abandonado: expone
 * `GET /checkouts` y ahí aparecen los carritos de clientes que llegaron
 * al segundo paso del checkout, hasta 6 horas después del abandono. Por
 * eso esto es polling y no push.
 *
 * Este cron solo DESCUBRE y persiste en `shopify_checkouts`. Quién
 * recupera y cuándo sigue siendo `/api/cron/shopify-cart-recovery`, que
 * escanea esa tabla sin filtrar por plataforma y ya tiene la ventana de
 * 2 horas, el antispam por teléfono y el reintento acotado. Separar
 * descubrimiento de envío evita duplicar esa lógica por plataforma.
 *
 * Marca de agua: el endpoint acepta `since_id` pero NO `created_at_min`,
 * así que en vez de filtrar por fecha arrancamos desde el mayor id que ya
 * tenemos guardado de esa tienda. Es autoreparable —si se pierde un
 * carrito, la próxima corrida igual avanza— y evita repaginar los 30 días
 * de historial que la plataforma retiene.
 */
async function cronHandler(request: Request) {
  try {
    assertCronAuth(request, 'AUTOMATION_CRON_SECRET')
  } catch (r) {
    if (r instanceof Response) return r
    throw r
  }

  const admin = supabaseAdmin()

  const { data: connections } = await admin
    .from('shopify_connections')
    .select('shop_domain')
    .eq('platform', 'tiendanube')
    .eq('status', 'active')

  const rows = (connections ?? []) as { shop_domain: string }[]
  if (rows.length === 0) return NextResponse.json({ stores: 0, discovered: 0 })

  let discovered = 0
  let failed = 0

  for (const { shop_domain: shopDomain } of rows) {
    try {
      discovered += await pollStore(admin, shopDomain)
    } catch (err) {
      failed++
      if (err instanceof StoreUnauthorizedError) {
        await markStoreExpired(
          admin,
          'tiendanube',
          shopDomain,
          'Credencial revocada en Tiendanube — reconectar desde Ajustes',
        )
        continue
      }
      // Una tienda caída no puede frenar a las demás.
      log.captureException(err, { shopDomain })
    }
  }

  return NextResponse.json({ stores: rows.length, discovered, failed })
}

async function pollStore(
  admin: SupabaseClient,
  shopDomain: string,
): Promise<number> {
  const store = await getStoreByDomain(admin, 'tiendanube', shopDomain)
  if (!store?.externalStoreId) return 0

  const sinceId = await highWaterMark(admin, shopDomain)

  const client = new TiendanubeClient(
    store.externalStoreId,
    store.accessToken,
    shopDomain,
  )
  const raw = await client.paginate<unknown>(
    `/checkouts?since_id=${sinceId}`,
    // Tope bajo a propósito: esto corre cada hora y con `since_id` solo
    // trae lo nuevo. Un tope alto solo importaría en la primera corrida
    // de una tienda con mucho historial, y ahí preferimos ir de a poco
    // antes que agotar el límite de 2 req/s de la plataforma.
    { perPage: 100, maxPages: 5 },
  )

  let persisted = 0
  for (const item of raw) {
    const checkout = normalizeTiendanubeCheckout(item, {})
    // Los ya completados se guardan igual (con completed_at) para que el
    // cron de recuperación los descarte, en vez de ignorarlos acá y que
    // reaparezcan en cada corrida.
    if (!checkout) continue
    const { persisted: ok } = await ingestCheckout(admin, {
      platform: 'tiendanube',
      workspaceId: store.workspaceId,
      shopDomain,
      checkout,
    })
    if (ok) persisted++
  }
  return persisted
}

/**
 * El mayor `checkout_id` ya guardado para esta tienda, que sirve como
 * cursor porque los ids de Tiendanube son enteros crecientes.
 *
 * Ordenamos por `created_at`, no por `checkout_id`: la columna es TEXT y
 * ordenarla daría el orden alfabético ("9" > "10"), que devolvería un
 * cursor menor al real y volvería a traer carritos ya vistos en cada
 * corrida. Como el id crece con el tiempo, el carrito más reciente es el
 * de mayor id.
 *
 * Devuelve 0 en la primera corrida (trae todo lo que entre en el tope).
 */
async function highWaterMark(
  admin: SupabaseClient,
  shopDomain: string,
): Promise<number> {
  const { data } = await admin
    .from('shopify_checkouts')
    .select('checkout_id')
    .eq('platform', 'tiendanube')
    .eq('shop_domain', shopDomain)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  const id = Number((data as { checkout_id?: string } | null)?.checkout_id)
  return Number.isFinite(id) && id > 0 ? id : 0
}

export const GET = withCronRun('tiendanube-checkouts', cronHandler)
