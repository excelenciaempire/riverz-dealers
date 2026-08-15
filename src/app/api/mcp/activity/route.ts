import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { resolveWorkspaceIdForUser } from '@/lib/workspaces/resolve'
import { serverError } from '@/lib/api/errors'

/**
 * Qué hizo el agente sobre esta cuenta.
 *
 * Cada llamada al MCP ya se anotaba en `platform_audit_log` — lecturas
 * incluidas — y el comercio no la veía: sabía "última vez usada" y nada más.
 * Darle una llave a un programa y no poder ver qué hizo con ella es pedirle
 * confianza a cambio de nada.
 *
 * Sólo las filas de SU workspace, resuelto desde la sesión. Y sin `args`: ahí
 * pueden vivir el teléfono de un cliente o el texto que se le mandó, y ya se
 * muestra en la conversación, que es donde corresponde.
 */
export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const workspaceId = await resolveWorkspaceIdForUser(supabase, user.id)
  if (!workspaceId) return NextResponse.json({ activity: [] })

  try {
    const { data, error } = await supabaseAdmin()
      .from('platform_audit_log')
      .select('id, actor, tool, risk, ok, summary, created_at')
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: false })
      .limit(50)
    if (error) return serverError(error)
    return NextResponse.json({ activity: data ?? [] })
  } catch (err) {
    return serverError(err)
  }
}
