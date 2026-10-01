import { NextResponse } from 'next/server'
import { issuer, SCOPES } from '@/lib/mcp/oauth'

export const dynamic = 'force-dynamic'

/**
 * Qué sabe hacer este servidor de autorización (RFC 8414).
 *
 * Lo que se declara acá es exactamente lo que se implementa, ni más ni menos.
 * En particular:
 *
 *   - sólo `code`, y sólo con PKCE `S256`. No hay flujo implícito ni `plain`:
 *     los clientes se registran solos, así que el `client_id` no prueba nada y
 *     el `code_verifier` es lo único que ata el canje a quien pidió el código.
 *   - `none` como método de autenticación de cliente: son clientes públicos.
 *     Inventarles un secreto sería teatro — vive en la máquina del usuario.
 */
export async function GET() {
  const base = issuer()
  return NextResponse.json(
    {
      issuer: base,
      authorization_endpoint: `${base}/oauth/autorizar`,
      token_endpoint: `${base}/api/oauth/token`,
      registration_endpoint: `${base}/api/oauth/register`,
      revocation_endpoint: `${base}/api/oauth/revoke`,
      revocation_endpoint_auth_methods_supported: ['none'],
      scopes_supported: SCOPES,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none'],
    },
    { headers: { 'Cache-Control': 'public, max-age=3600' } },
  )
}
