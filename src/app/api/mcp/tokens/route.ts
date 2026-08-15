import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { resolveWorkspaceIdForUser } from '@/lib/workspaces/resolve'
import { csrfGuard } from '@/lib/csrf'
import { serverError } from '@/lib/api/errors'
import { generateToken, hashToken, tokenPrefix } from '@/lib/mcp/tokens'

/**
 * Las llaves de MCP de un comercio.
 *
 * Con una de estas, cualquiera puede conectar su propio agente a Riverz y
 * preguntarle por su operación — "¿por qué no le llegó el mensaje a este
 * cliente?"— sin que eso lo acerque ni un centímetro a otra cuenta: la llave
 * lleva el workspace adentro y el servidor no le cree al argumento.
 *
 * El workspace sale SIEMPRE de la sesión, nunca del pedido. Es la misma regla
 * que hace que esto sea seguro del otro lado.
 */

const MAX_TOKENS = 10

async function contexto() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return null
  const workspaceId = await resolveWorkspaceIdForUser(supabase, user.id)
  if (!workspaceId) return null
  return { userId: user.id, workspaceId }
}

/** Las llaves vivas, sin el hash y sin el valor: eso se vio una sola vez. */
export async function GET() {
  const ctx = await contexto()
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const { data, error } = await supabaseAdmin()
      .from('mcp_tokens')
      .select('id, name, prefix, created_at, last_used_at')
      .eq('workspace_id', ctx.workspaceId)
      .is('revoked_at', null)
      .order('created_at', { ascending: false })
    if (error) return serverError(error)
    return NextResponse.json({ tokens: data ?? [] })
  } catch (err) {
    return serverError(err)
  }
}

/** Crea una llave. Devuelve el valor UNA vez y nunca más. */
export async function POST(request: Request) {
  const block = await csrfGuard(request)
  if (block) return block

  const ctx = await contexto()
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = (await request.json().catch(() => null)) as { name?: string } | null
  const name = (body?.name ?? '').trim().slice(0, 60)
  if (!name) return NextResponse.json({ error: 'name_required' }, { status: 400 })

  const admin = supabaseAdmin()
  try {
    // Un techo por cuenta. No es una defensa contra nada: es que diez llaves
    // vivas ya son más de las que alguien puede decir dónde están, y a partir
    // de ahí revocar deja de ser una decisión informada.
    const { count } = await admin
      .from('mcp_tokens')
      .select('id', { count: 'exact', head: true })
      .eq('workspace_id', ctx.workspaceId)
      .is('revoked_at', null)
    if ((count ?? 0) >= MAX_TOKENS) {
      return NextResponse.json({ error: 'too_many' }, { status: 400 })
    }

    const token = generateToken()
    const { data, error } = await admin
      .from('mcp_tokens')
      .insert({
        workspace_id: ctx.workspaceId,
        name,
        token_hash: hashToken(token),
        prefix: tokenPrefix(token),
        created_by: ctx.userId,
      })
      .select('id, name, prefix, created_at')
      .single()
    if (error) return serverError(error)

    // La única vez que el valor sale de acá.
    return NextResponse.json({ ...(data as object), token })
  } catch (err) {
    return serverError(err)
  }
}

/**
 * Revoca una llave. No la borra: deja `revoked_at`, porque una llave que se usó
 * tiene que seguir explicando las filas que dejó en la auditoría.
 */
export async function DELETE(request: Request) {
  const block = await csrfGuard(request)
  if (block) return block

  const ctx = await contexto()
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const id = new URL(request.url).searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id_required' }, { status: 400 })

  try {
    const { data, error } = await supabaseAdmin()
      .from('mcp_tokens')
      .update({ revoked_at: new Date().toISOString() })
      .eq('id', id)
      // La barrera de cuenta: sin esto, un id suelto revocaría la llave de otro.
      .eq('workspace_id', ctx.workspaceId)
      .is('revoked_at', null)
      .select('id')
      .maybeSingle()
    if (error) return serverError(error)
    if (!data) return NextResponse.json({ error: 'not_found' }, { status: 404 })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return serverError(err)
  }
}
