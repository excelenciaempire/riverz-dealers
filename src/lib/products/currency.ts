import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Divisa del negocio: detección + resolución compartida entre la feature de
 * productos (creación manual, catálogo, editor) y el runner del agente, para
 * que "detectar la divisa y colocarla" y "que todos los agentes lo sepan"
 * usen exactamente la misma fuente de verdad.
 */

/** Último recurso cuando no hay ninguna señal (misma que el viejo default de
 *  creación manual, para no cambiar comportamiento donde no hay datos). */
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
  try {
    // 1) Override explícito de la config de checkout.
    const { data: cfg } = await db
      .from('workspace_checkout_config')
      .select('currency')
      .eq('workspace_id', workspaceId)
      .maybeSingle()
    const cfgCurrency = (cfg as { currency?: string | null } | null)?.currency
    if (cfgCurrency) return cfgCurrency.toUpperCase()

    // 2) Divisa detectada de la tienda Shopify conectada.
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
