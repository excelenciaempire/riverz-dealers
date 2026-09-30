import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { csrfGuard } from '@/lib/csrf'
import { resolveWorkspaceIdForUser } from '@/lib/workspaces/resolve'
import { estadoDelMotor, ponerMotor } from '@/lib/workspaces/motor'
import { isPresentationWorkspace } from '@/lib/workspaces/presentation'

/**
 * El motor de la cuenta, del lado del comercio.
 *
 * GET  → si está apagado, por cuál de las dos razones, y qué se le montó
 * POST → lo enciende (o lo vuelve a apagar)
 *
 * Es el paso 4 de la instalación: la operación ya está armada y apagada, y
 * acá el comercio la mira y la aprueba de una. Sin esto tendría que ir agente
 * por agente y automatización por automatización, que es exactamente el
 * trabajo que la instalación venía a sacarle.
 *
 * Una cuenta suspendida por cobro puede encender su motor y seguir muda: son
 * dos frenos distintos y encender lo aprobado no puede saltear el otro. Por eso
 * la respuesta dice cuál de los dos está puesto — si no, el comercio aprieta,
 * no pasa nada y no entiende por qué.
 */
export const dynamic = 'force-dynamic'

async function contexto() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return null
  const admin = supabaseAdmin()
  const workspaceId = await resolveWorkspaceIdForUser(admin, user.id)
  if (!workspaceId) return null
  return { admin, workspaceId, userId: user.id }
}

export async function GET() {
  const ctx = await contexto()
  if (!ctx) return NextResponse.json({ error: 'not_available' }, { status: 404 })

  const [motor, { data }] = await Promise.all([
    estadoDelMotor(ctx.admin, ctx.workspaceId),
    ctx.admin
      .from('operacion_setup')
      .select('applied, instalado_por, completed_at')
      .eq('workspace_id', ctx.workspaceId)
      .maybeSingle(),
  ])
  const setup = (data ?? {}) as {
    applied?: { que: string; ok: boolean }[] | null
    instalado_por?: string | null
    completed_at?: string | null
  }

  return NextResponse.json(
    {
      ...motor,
      ejecucion_bloqueada: isPresentationWorkspace(ctx.workspaceId),
      hechos: (setup.applied ?? []).filter((h) => h.ok),
      instalado_por: setup.instalado_por ?? null,
      instalado: Boolean(setup.completed_at),
    },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}

export async function POST(request: Request) {
  const block = await csrfGuard(request)
  if (block) return block
  const ctx = await contexto()
  if (!ctx) return NextResponse.json({ error: 'not_available' }, { status: 404 })

  const body = (await request.json().catch(() => null)) as {
    encendido?: boolean
  } | null
  const encendido = body?.encendido !== false

  try {
    await ponerMotor(ctx.admin, ctx.workspaceId, encendido, ctx.userId)
  } catch (e) {
    const motivo = e instanceof Error ? e.message : 'falló'
    return NextResponse.json({ error: motivo }, { status: 500 })
  }

  return NextResponse.json(await estadoDelMotor(ctx.admin, ctx.workspaceId))
}
