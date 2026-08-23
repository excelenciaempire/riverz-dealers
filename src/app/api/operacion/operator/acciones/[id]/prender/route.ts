import { NextResponse } from 'next/server'

import { supabaseAdmin } from '@/lib/automations/admin-client'
import { getFeatureFlags, isRiverz2 } from '@/lib/admin/feature-flags'
import { csrfGuard } from '@/lib/csrf'
import type { CapabilityContext } from '@/lib/capabilities/types'
import { getLocale } from '@/lib/i18n/server'
import { proponer } from '@/lib/operator/escribir'
import { createClient } from '@/lib/supabase/server'
import { resolveWorkspaceIdForUser } from '@/lib/workspaces/resolve'

/**
 * «Quedó pausada. ¿La prendo?»
 *
 * Una automatización nace pausada SIEMPRE, y hasta ahora ahí se terminaba: se
 * armaba, se aprobaba, y quedaba dormida sin que nadie volviera a nombrarla. La
 * última milla —la que separa una automatización de una automatización que
 * funciona— había que caminarla a mano y en otra pantalla.
 *
 * Esto no la prende: deja la propuesta de prenderla, con su vista previa, para
 * que la persona la lea y decida. Es la misma fila de `operator_actions` que
 * cualquier otra, con los mismos dos botones. Y si TODAVÍA no se puede prender
 * —le falta la plantilla, le falta la etiqueta— `proponer` lanza y lo que
 * vuelve es el motivo escrito: información, en vez de un botón que no hace
 * nada.
 *
 * Sólo sobre lo que acaba de crearse en este hilo. No es un atajo para prender
 * cualquier automatización de la cuenta.
 */
export const runtime = 'nodejs'

/** Las que dejan una automatización nueva, dormida. */
const CREAN = ['automatizaciones.crear', 'automatizaciones.crear_desde_receta']

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const block = await csrfGuard(request)
  if (block) return block

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const admin = supabaseAdmin()
  const workspaceId = await resolveWorkspaceIdForUser(admin, user.id)
  if (!workspaceId) return NextResponse.json({ error: 'no_workspace' }, { status: 400 })
  if (!isRiverz2(await getFeatureFlags(admin, workspaceId))) {
    return NextResponse.json({ error: 'not_available' }, { status: 404 })
  }

  const { id } = await params
  const { data } = await admin
    .from('operator_actions')
    .select('capability_key, status, thread_id, result')
    .eq('id', id)
    .eq('workspace_id', workspaceId)
    .maybeSingle()
  const fila = data as {
    capability_key: string
    status: string
    thread_id: string | null
    result: { id?: string; name?: string } | null
  } | null

  if (!fila) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  // Sólo se ofrece sobre algo que de verdad quedó creado. Sobre una propuesta
  // sin aprobar no hay nada que prender.
  if (fila.status !== 'ejecutado' || !CREAN.includes(fila.capability_key)) {
    return NextResponse.json({ error: 'no_aplica' }, { status: 400 })
  }
  const automationId = typeof fila.result?.id === 'string' ? fila.result.id : null
  if (!automationId || !fila.thread_id) {
    return NextResponse.json({ error: 'no_aplica' }, { status: 400 })
  }

  const ctx: CapabilityContext = {
    db: admin,
    workspaceId,
    actor: { type: 'operator', id: user.id },
    locale: await getLocale(),
  }

  try {
    const p = await proponer(ctx, fila.thread_id, 'automatizaciones.activar', {
      automation_id: automationId,
      activa: true,
    })
    return NextResponse.json({
      puede: true,
      accion: {
        id: p.id,
        capability_key: 'automatizaciones.activar',
        args: { automation_id: automationId, activa: true },
        risk: 'reversible',
        status: 'propuesto',
        preview: p.preview,
      },
    })
  } catch (e) {
    // Le falta algo para poder prenderse. Se dice y no se propone: aprobar
    // algo que va a fallar es gastarle el click a una persona.
    return NextResponse.json({
      puede: false,
      motivo: e instanceof Error ? e.message : null,
    })
  }
}
