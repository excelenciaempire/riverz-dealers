import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'

/**
 * Los permisos que se guardan tienen que ser los del token que se está usando.
 *
 * Shopify emite cada renovación contra la configuración ACTUAL de la app, así
 * que un permiso que estaba en el otorgamiento original puede no venir en el
 * token siguiente. La renovación guardaba el token nuevo y dejaba la columna
 * `scope` con el valor viejo: la fila afirmaba `write_order_edits` mientras
 * `/admin/oauth/access_scopes.json` decía que no.
 *
 * Y eso no es cosmético: esa columna es con la que se decide si hay que pedirle
 * al comercio que reconecte. Una columna que miente sobre permisos manda a
 * buscar el problema a cualquier lado menos donde está. Medido el 2026-08-25
 * sobre la tienda demo, donde `update_order` funcionó una hora y después dejó
 * de funcionar sin que nadie tocara nada.
 */
describe('la renovación del token', () => {
  const vivo = readFileSync('src/lib/shopify/token-vivo.ts', 'utf8')

  it('guarda los permisos que vinieron con el token nuevo', () => {
    expect(vivo).toContain('parche.scope = nuevo.scope')
  })

  it('y sólo si Shopify los mandó', () => {
    // Pisar la columna con vacío sería peor: se perdería la única señal que hay
    // cuando la respuesta viene incompleta.
    expect(vivo).toMatch(/if \(nuevo\.scope\) parche\.scope = nuevo\.scope/)
  })

  it('el canje inicial ya guardaba lo OTORGADO, no lo pedido', () => {
    // Este lado estaba bien y conviene que siga estándolo: `exchanged.scope` es
    // lo que Shopify contestó, no `DEFAULT_SCOPES`.
    const callback = readFileSync('src/app/api/shopify/callback/route.ts', 'utf8')
    expect(callback).toContain('grantedScope = exchanged.scope')
  })
})
