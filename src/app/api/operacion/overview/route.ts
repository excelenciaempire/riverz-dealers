import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { resolveWorkspaceIdForUser } from '@/lib/workspaces/resolve'
import { getFeatureFlags, isRiverz2 } from '@/lib/admin/feature-flags'
import { getCapability } from '@/lib/capabilities/registry'
import type { CapabilityContext } from '@/lib/capabilities/types'
import { getLocale } from '@/lib/i18n/server'

/**
 * Lo único de la operación que la pantalla no puede calcular sola.
 *
 * Devolvía seis bloques —estado, pendientes, agentes, plantillas, campañas— que
 * alimentaban tarjetas de volumen ("automatizaciones activas", "canales
 * conectados") que Inicio ya no muestra: son configuración, no resultado. Seis
 * consultas por carga de pantalla para cifras que nadie mira.
 *
 * Queda la única que sigue en pantalla: cuántos mensajes escribió la IA. Está
 * en `ai_replies`, que el navegador no lee, así que hace falta el viaje.
 *
 * No calcula nada propio: usa la capacidad. Si esta vista tuviera su consulta,
 * volveríamos a tener dos verdades sobre la misma cuenta.
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

  // Cae a null por su cuenta: es una tarjeta de más, no puede dejar el panel
  // entero en blanco.
  let metricas = null
  try {
    metricas = await getCapability('metricas.resumen').run(ctx, { dias })
  } catch (e) {
    console.error('[operacion/overview] metricas.resumen:', e)
  }

  return NextResponse.json(
    { metricas },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
