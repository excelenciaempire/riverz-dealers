import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { limitByKey, rateLimitResponse, clientIp } from '@/lib/rate-limit'
import { registrarCliente } from '@/lib/mcp/oauth'

export const dynamic = 'force-dynamic'

/**
 * Registro dinámico de clientes (RFC 7591).
 *
 * Abierto a propósito: es lo que permite que un conector nuevo se conecte sin
 * que nadie de Riverz cree nada a mano. Registrarse no da acceso a nada —
 * devuelve un identificador para poder empezar el flujo, y el acceso lo concede
 * una persona en la pantalla de consentimiento.
 *
 * Lo único que hay que cuidar es que no llenen la tabla: de ahí el límite por
 * IP. Y las `redirect_uris` se validan acá porque son la pieza que, mal
 * puesta, manda un código de autorización a otro lado.
 */
const RATE = { limit: 10, windowMs: 60 * 60 * 1000 }

/**
 * Una redirección válida es HTTPS, o localhost por HTTP. Lo segundo no es una
 * concesión: los clientes de escritorio escuchan en localhost y no tienen forma
 * de tener un certificado.
 */
function redirectValida(u: string): boolean {
  try {
    const url = new URL(u)
    if (url.username || url.password || url.hash) return false
    if (url.protocol === 'https:') return true
    const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1'
    return url.protocol === 'http:' && local
  } catch {
    return false
  }
}

export async function POST(request: Request) {
  const rl = await limitByKey(`oauth-register:${clientIp(request)}`, RATE)
  if (!rl.success) return rateLimitResponse(rl)

  const body = (await request.json().catch(() => null)) as {
    client_name?: string
    redirect_uris?: unknown
  } | null

  const uris = Array.isArray(body?.redirect_uris)
    ? body.redirect_uris.filter((u): u is string => typeof u === 'string')
    : []
  if (!Array.isArray(body?.redirect_uris) || uris.length !== body.redirect_uris.length ||
    uris.length === 0 || uris.length > 5 || !uris.every(redirectValida) ||
    (body?.client_name != null && typeof body.client_name !== 'string')) {
    return NextResponse.json(
      {
        error: 'invalid_redirect_uri',
        error_description: 'Hace falta al menos una redirect_uri https (o http en localhost).',
      },
      { status: 400 },
    )
  }

  try {
    const cliente = await registrarCliente(supabaseAdmin(), {
      name: (body?.client_name || 'Cliente MCP').trim(),
      redirect_uris: uris.slice(0, 5),
    })
    return NextResponse.json(
      {
        client_id: cliente.client_id,
        client_name: cliente.name,
        redirect_uris: cliente.redirect_uris,
        // Cliente público: sin secreto, con PKCE.
        token_endpoint_auth_method: 'none',
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
      },
      { status: 201 },
    )
  } catch {
    return NextResponse.json({ error: 'server_error' }, { status: 500 })
  }
}
