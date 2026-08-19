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

  // El mismo gate que la página. Una pantalla escondida cuyo endpoint contesta
  // igual no está escondida.
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

  try {
    const [estado, metricas, pendientes, agentes] = await Promise.all([
      getCapability('operacion.estado').run(ctx, {}),
      getCapability('metricas.resumen').run(ctx, { dias }),
      getCapability('conversaciones.pendientes').run(ctx, { limite: 5 }),
      getCapability('agentes.listar').run(ctx, {}),
    ])
    return NextResponse.json(
      { estado, metricas, pendientes, agentes },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'failed' },
      { status: 500 },
    )
  }
}
