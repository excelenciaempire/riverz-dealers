import type { SupabaseClient } from '@supabase/supabase-js'
import { isDealerDeployment } from '@/lib/dealers/config'
import { dealerInventoryCurrency } from '@/lib/dealers/currency'

/**
 * Divisa del negocio: detección + resolución compartida entre la feature de
 * productos (creación manual, catálogo, editor) y el runner del agente, para
 * que "detectar la divisa y colocarla" y "que todos los agentes lo sepan"
 * usen exactamente la misma fuente de verdad.
 */

/**
 * Último recurso cuando no hay NINGUNA señal.
 *
 * Es un default y no una respuesta: una tienda argentina cuyo catálogo todavía
 * no se sincronizó mostraba "39.990 COP" en cada producto, que es un precio que
 * no existe. Quien llama y puede mostrar el número sin moneda debería preferir
 * eso —ver `resolveWorkspaceCurrencyOrNull`— antes que etiquetar mal.
 */
export const DEFAULT_CURRENCY = 'COP'

/** Divisas ofrecidas en el editor. Compartida para que el <select> y la
 *  detección nunca discrepen. Cualquier divisa detectada fuera de esta lista
 *  se agrega dinámicamente en el UI (no se descarta). */
export const CURRENCY_OPTIONS = [
  'COP',
  'USD',
  'ARS',
  'MXN',
  'CLP',
  'PEN',
  'EUR',
  'BRL',
] as const

/**
 * Resuelve la divisa canónica del workspace con esta prioridad:
 *   1. workspace_checkout_config.currency — override explícito del merchant
 *      (Pilar = 'ARS'). SIEMPRE gana para no regresar economías configuradas.
 *   2. shopify_connections.currency — detectada de /shop.json al conectar/sincronizar.
 *   3. La divisa más común entre los productos del workspace.
 *   4. DEFAULT_CURRENCY.
 *
 * Debe llamarse con un cliente que pueda leer estas tablas para el workspace
 * (admin, o RLS del propio miembro). Nunca lanza — cae al default ante error.
 */
export async function resolveWorkspaceCurrency(
  db: SupabaseClient,
  workspaceId: string,
): Promise<string> {
  if (isDealerDeployment()) return (await dealerInventoryCurrency(db, workspaceId)) ?? 'USD'
  try {
    // 1) Override explícito de la config de checkout.
    const { data: cfg } = await db
      .from('workspace_checkout_config')
      .select('currency')
      .eq('workspace_id', workspaceId)
      .maybeSingle()
    const cfgCurrency = (cfg as { currency?: string | null } | null)?.currency
    if (cfgCurrency) return cfgCurrency.toUpperCase()

    // 2) Divisa detectada de la tienda conectada, sea de la plataforma que
    // sea. Filtrar por 'shopify' dejaba a un comercio de Tiendanube o
    // WooCommerce con la divisa por defecto aunque su tienda informara la
    // suya, y eso se ve en cada precio que cotiza el asistente.
    const { data: conn } = await db
      .from('shopify_connections')
      .select('currency')
      .eq('workspace_id', workspaceId)
      .eq('status', 'active')
      .not('currency', 'is', null)
      .order('installed_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    const connCurrency = (conn as { currency?: string | null } | null)?.currency
    if (connCurrency) return connCurrency.toUpperCase()

    // 3) Divisa más frecuente entre los productos del workspace.
    const { data: prods } = await db
      .from('shopify_products')
      .select('currency')
      .eq('workspace_id', workspaceId)
      .not('currency', 'is', null)
      .limit(500)
    const rows = (prods as { currency?: string | null }[] | null) ?? []
    if (rows.length > 0) {
      const counts = new Map<string, number>()
      for (const r of rows) {
        const c = r.currency?.toUpperCase()
        if (c) counts.set(c, (counts.get(c) ?? 0) + 1)
      }
      let best: string | null = null
      let bestN = 0
      for (const [c, n] of counts) {
        if (n > bestN) {
          best = c
          bestN = n
        }
      }
      if (best) return best
    }
  } catch {
    /* fail-open al default */
  }
  return DEFAULT_CURRENCY
}

/**
 * La misma resolución, pero sin inventar.
 *
 * Devuelve null cuando no hay ninguna señal, para que la pantalla muestre el
 * número pelado en vez de una moneda equivocada. Un precio sin moneda se puede
 * leer; un precio con la moneda de otro país es directamente falso, y es lo que
 * pasaba con toda tienda que no había sincronizado todavía.
 */
export async function resolveWorkspaceCurrencyOrNull(
  db: SupabaseClient,
  workspaceId: string,
): Promise<string | null> {
  if (isDealerDeployment()) return dealerInventoryCurrency(db, workspaceId)
  const c = await resolveWorkspaceCurrency(db, workspaceId)
  if (c !== DEFAULT_CURRENCY) return c
  // Coincide con el default: puede ser de verdad COP o puede ser que no haya
  // ninguna señal. Se comprueba si alguna fuente lo dijo explícitamente.
  const { data: cfg } = await db
    .from('workspace_checkout_config')
    .select('currency')
    .eq('workspace_id', workspaceId)
    .maybeSingle()
  if ((cfg as { currency?: string | null } | null)?.currency) return c
  const { data: conn } = await db
    .from('shopify_connections')
    .select('currency')
    .eq('workspace_id', workspaceId)
    .not('currency', 'is', null)
    .limit(1)
    .maybeSingle()
  return conn ? c : null
}
