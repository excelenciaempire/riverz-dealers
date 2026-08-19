import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { resolveWorkspaceIdForUser } from '@/lib/workspaces/resolve'
import { getFeatureFlags, isRiverz2 } from '@/lib/admin/feature-flags'
import { getCapability } from '@/lib/capabilities/registry'
import type { CapabilityContext } from '@/lib/capabilities/types'
import { getLocale } from '@/lib/i18n/server'

/**
 * Lo que muestra el Centro de Operación IA.
 *
 * No calcula nada propio: compone tres capacidades. Es el primer consumidor de
 * la capa desde una pantalla, y es a propósito — si esta vista tuviera sus
 * consultas, volveríamos a tener dos verdades sobre la misma cuenta, que es
 * exactamente lo que se acaba de arreglar.
 */
export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = supabaseAdmin()
  const workspaceId = await resolveWorkspaceIdForUser(admin, user.id)
  if (!workspaceId) return NextResponse.json({ error: 'no_workspace' }, { status: 400 })

  // El mismo gate que la pantalla. Un endpoint que contesta igual no esconde
  // nada.
  const flags = await getFeatureFlags(admin, workspaceId)
  if (!isRiverz2(flags)) {
    return NextResponse.json({ error: 'not_enabled' }, { status: 404 })
  }

  const dias = Math.min(Number(new URL(request.url).searchParams.get('dias')) || 7, 90)
  const ctx: CapabilityContext = {
    db: admin,
    workspaceId,
    actor: { type: 'ui', id: user.id },
    locale: await getLocale(),
  }

  // Cada capacidad cae a null por su cuenta. El panel muestra seis cosas
  // distintas: que falle la lectura de plantillas no puede dejar en blanco las
  // métricas, los avisos y los pedidos.
  const intentar = async (key: string, args: Record<string, unknown> = {}) => {
    try {
      return await getCapability(key).run(ctx, args)
    } catch (e) {
      console.error(`[operacion/overview] ${key}:`, e)
      return null
    }
  }

  const [estado, metricas, pendientes, agentes, plantillas, campanas] =
    await Promise.all([
      intentar('operacion.estado'),
      intentar('metricas.resumen', { dias }),
      intentar('conversaciones.pendientes', { limite: 5 }),
      intentar('agentes.listar'),
      intentar('plantillas.estado'),
      intentar('campanas.estado', { dias }),
    ])

  return NextResponse.json(
    { estado, metricas, pendientes, agentes, plantillas, campanas },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
