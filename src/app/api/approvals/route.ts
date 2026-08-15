import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { resolveWorkspaceIdForUser } from '@/lib/workspaces/resolve'
import { serverError } from '@/lib/api/errors'

/**
 * GET /api/approvals — las decisiones que están esperando a esta cuenta.
 *
 * Hasta acá `approval_requests` no tenía pantalla en ningún lado: la pregunta
 * salía por WhatsApp y, si ese mensaje no llegaba (sin teléfono cargado, fuera
 * de la ventana de Meta, el número equivocado), la decisión quedaba escrita en
 * una tabla que nadie miraba nunca. El comentario de `ask.ts` prometía "la
 * decisión sigue esperando en el panel" — este es ese panel.
 *
 * El workspace sale de la SESIÓN y nunca del pedido. Se lee con la clave de
 * servicio porque las aprobaciones no tienen políticas de RLS para el comercio.
 */
export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const workspaceId = await resolveWorkspaceIdForUser(supabase, user.id)
  if (!workspaceId) return NextResponse.json({ approvals: [] })

  try {
    const { data, error } = await supabaseAdmin()
      .from('approval_requests')
      .select('id, kind, title, body, created_at, expires_at')
      .eq('workspace_id', workspaceId)
      .eq('status', 'pendiente')
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false })
      .limit(20)
    if (error) return serverError(error)
    return NextResponse.json({ approvals: data ?? [] })
  } catch (err) {
    return serverError(err)
  }
}
