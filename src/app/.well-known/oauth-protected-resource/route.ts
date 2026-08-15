import { NextResponse } from 'next/server'
import { issuer, resourceUrl, SCOPES } from '@/lib/mcp/oauth'

export const dynamic = 'force-dynamic'

/**
 * Dónde pedir permiso para hablar con el MCP (RFC 9728).
 *
 * Es el primer archivo que lee un conector: llama al MCP sin credencial, recibe
 * un 401 que apunta acá, y de acá saca a qué servidor de autorización tiene que
 * ir. Sin este documento, un cliente que descubre servidores solo no tiene por
 * dónde empezar y la única vía posible es pegar un token a mano.
 *
 * Público a propósito: describe cómo pedir permiso, no da ninguno.
 */
export async function GET() {
  return NextResponse.json(
    {
      resource: resourceUrl(),
      authorization_servers: [issuer()],
      scopes_supported: SCOPES,
      bearer_methods_supported: ['header'],
    },
    { headers: { 'Cache-Control': 'public, max-age=3600' } },
  )
}
