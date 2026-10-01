import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { resolveWorkspaceIdForUser } from '@/lib/workspaces/resolve'
import { csrfGuard } from '@/lib/csrf'
import {
  buscarCliente,
  emitirCodigo,
  redirectPermitido,
  scopeConcedido,
  scopeInterno,
  validScope,
  resourceUrl,
} from '@/lib/mcp/oauth'
import { userAccess } from '@/lib/mcp/access'

export const dynamic = 'force-dynamic'

/**
 * El "sí" de la persona.
 *
 * La pantalla es `/oauth/autorizar`; esto es lo que se ejecuta cuando aprieta
 * Autorizar. Devuelve la URL a la que hay que volver, con el código adentro —
 * y no un redirect directo — porque quien la llama es la propia pantalla por
 * fetch, y así puede mostrar un error legible en vez de rebotar al cliente.
 *
 * La cuenta sale de la SESIÓN. El cliente no puede pedir un workspace: nombrar
 * cuentas ajenas es exactamente lo que este diseño evita.
 */
export async function POST(request: Request) {
  const block = await csrfGuard(request)
  if (block) return block

  // OAuth exports access outside Riverz: never authorize an impersonated owner.
  const supabase = await createClient({ actor: true })
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const workspaceId = await resolveWorkspaceIdForUser(supabase, user.id)
  if (!workspaceId) return NextResponse.json({ error: 'no_workspace' }, { status: 400 })

  const body = (await request.json().catch(() => null)) as {
    client_id?: string
    redirect_uri?: string
    scope?: string
    state?: string
    code_challenge?: string
    code_challenge_method?: string
    resource?: string
  } | null

  if (!body?.client_id || !body.redirect_uri || !body.code_challenge) {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 })
  }
  // Sólo S256. `plain` deja el verifier a la vista de quien intercepte la ida.
  if (body.code_challenge_method !== 'S256' || !/^[A-Za-z0-9_-]{43}$/.test(body.code_challenge)) {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 })
  }

  const db = supabaseAdmin()
  if (body.resource && body.resource !== resourceUrl()) return NextResponse.json({ error: 'invalid_target' }, { status: 400 })
  if (!validScope(body.scope ?? '')) return NextResponse.json({ error: 'invalid_scope' }, { status: 400 })
  const access = await userAccess(db, user.id, workspaceId)
  if (!access) return NextResponse.json({ error: 'access_denied' }, { status: 403 })
  const cliente = await buscarCliente(db, body.client_id)
  if (!cliente) return NextResponse.json({ error: 'invalid_client' }, { status: 400 })
  if (!redirectPermitido(cliente.redirect_uris, body.redirect_uri)) {
    return NextResponse.json({ error: 'invalid_redirect_uri' }, { status: 400 })
  }

  // Se concede como mucho lo que se pidió, traducido a nuestro vocabulario. Si
  // pidió escritura y la persona eligió sólo lectura, gana la persona.
  const concedido = scopeConcedido(access.admin ? scopeInterno(body.scope) : 'lectura') +
    ((body.scope ?? '').split(/\s+/).includes('offline_access') ? ' offline_access' : '')

  try {
    const code = await emitirCodigo(db, {
      clientId: body.client_id,
      workspaceId,
      userId: user.id,
      scope: concedido,
      redirectUri: body.redirect_uri,
      codeChallenge: body.code_challenge,
    })

    const url = new URL(body.redirect_uri)
    url.searchParams.set('code', code)
    if (body.state) url.searchParams.set('state', body.state)
    return NextResponse.json({ redirect_to: url.toString() })
  } catch {
    return NextResponse.json({ error: 'server_error' }, { status: 500 })
  }
}
