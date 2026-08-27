import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { csrfGuard } from '@/lib/csrf'
import { resolveWorkspaceIdForUser } from '@/lib/workspaces/resolve'
import { getFeatureFlags, isRiverz2 } from '@/lib/admin/feature-flags'
import { getCapability } from '@/lib/capabilities/registry'
import type { CapabilityContext } from '@/lib/capabilities/types'
import { PLAYBOOKS, planFor, playbook } from '@/lib/operator/playbooks'
import { roleTemplate } from '@/lib/ai/role-templates'
import { getLocale } from '@/lib/i18n/server'
import type { Locale } from '@/lib/i18n/config'
import { ponerMotor } from '@/lib/workspaces/motor'

/**
 * La activación guiada: dónde quedó y qué se va a crear.
 *
 * GET   → estado + el plan que corresponde a los objetivos elegidos
 * PATCH → guarda el avance (paso, objetivos, agente generado)
 *
 * El plan se calcula acá y no en el navegador: es lo que después se ejecuta,
 * así que mostrar una lista armada en el cliente sería mostrar una cosa y
 * hacer otra.
 */
export const dynamic = 'force-dynamic'

interface Ctx {
  admin: ReturnType<typeof supabaseAdmin>
  userId: string
  workspaceId: string
  locale: Locale
}

async function contexto(): Promise<Ctx | null> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return null
  const admin = supabaseAdmin()
  const workspaceId = await resolveWorkspaceIdForUser(admin, user.id)
  if (!workspaceId) return null
  const flags = await getFeatureFlags(admin, workspaceId)
  if (!isRiverz2(flags)) return null
  return { admin, userId: user.id, workspaceId, locale: await getLocale() }
}

async function estado(ctx: Ctx) {
  const { data } = await ctx.admin
    .from('operacion_setup')
    .select('step, playbooks, generated_agent_id, applied, completed_at')
    .eq('workspace_id', ctx.workspaceId)
    .maybeSingle()
  return (
    (data as {
      step: number
      playbooks: string[]
      generated_agent_id: string | null
      applied: unknown
      completed_at: string | null
    } | null) ?? {
      step: 1,
      playbooks: [],
      generated_agent_id: null,
      applied: null,
      completed_at: null,
    }
  )
}

export async function GET() {
  const ctx = await contexto()
  if (!ctx) return NextResponse.json({ error: 'not_available' }, { status: 404 })

  const s = await estado(ctx)
  return NextResponse.json(
    { ...s, catalogo: PLAYBOOKS, plan: planFor(s.playbooks ?? []) },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}

export async function PATCH(request: Request) {
  const block = await csrfGuard(request)
  if (block) return block
  const ctx = await contexto()
  if (!ctx) return NextResponse.json({ error: 'not_available' }, { status: 404 })

  const body = (await request.json().catch(() => null)) as {
    step?: number
    playbooks?: string[]
    generated_agent_id?: string | null
  } | null

  const patch: Record<string, unknown> = {
    workspace_id: ctx.workspaceId,
    updated_at: new Date().toISOString(),
  }
  if (typeof body?.step === 'number') patch.step = Math.max(1, Math.min(4, body.step))
  if (Array.isArray(body?.playbooks)) {
    // Sólo claves del catálogo: lo que llega del navegador termina decidiendo
    // qué se crea.
    patch.playbooks = body.playbooks.filter((k) => Boolean(playbook(k)))
  }
  if ('generated_agent_id' in (body ?? {})) {
    patch.generated_agent_id = body?.generated_agent_id ?? null
  }

  const { error } = await ctx.admin
    .from('operacion_setup')
    .upsert(patch, { onConflict: 'workspace_id' })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const s = await estado(ctx)
  return NextResponse.json({ ...s, plan: planFor(s.playbooks ?? []) })
}

/**
 * Aprobar el plan: crear lo que se mostró.
 *
 * El plan es determinista —sale de los playbooks, no de un modelo—, así que el
 * click en "Activar" ES la aprobación y no hace falta el ida y vuelta de
 * proponer. Igual queda cada paso registrado en `operator_actions`, en el mismo
 * lugar que todo lo demás que hace el Operator, porque la pregunta "¿qué me
 * creó la activación?" se contesta ahí.
 *
 * Todo nace PAUSADO: agentes y automatizaciones. Terminar el asistente no
 * puede ser lo mismo que empezar a escribirle a clientes.
 */
export async function POST(request: Request) {
  const block = await csrfGuard(request)
  if (block) return block
  const ctx = await contexto()
  if (!ctx) return NextResponse.json({ error: 'not_available' }, { status: 404 })

  const s = await estado(ctx)
  const plan = planFor(s.playbooks ?? [])
  if (plan.agentes.length === 0 && plan.recetas.length === 0) {
    return NextResponse.json({ error: 'sin_objetivos' }, { status: 400 })
  }

  const cap: CapabilityContext = {
    db: ctx.admin,
    workspaceId: ctx.workspaceId,
    actor: { type: 'operator', id: ctx.userId },
    locale: ctx.locale,
  }

  const hechos: { que: string; detalle: string; ok: boolean }[] = []

  async function ejecutar(key: string, args: Record<string, unknown>, que: string) {
    try {
      const out = await getCapability(key).run(cap, args)
      await ctx!.admin.from('operator_actions').insert({
        workspace_id: ctx!.workspaceId,
        capability_key: key,
        args,
        risk: 'reversible',
        status: 'ejecutado',
        preview: que,
        result: out ?? null,
        approved_by: ctx!.userId,
        executed_at: new Date().toISOString(),
      })
      hechos.push({ que, detalle: '', ok: true })
      return out
    } catch (e) {
      const motivo = e instanceof Error ? e.message : 'falló'
      await ctx!.admin.from('operator_actions').insert({
        workspace_id: ctx!.workspaceId,
        capability_key: key,
        args,
        risk: 'reversible',
        status: 'fallido',
        preview: que,
        result: { error: motivo },
        approved_by: ctx!.userId,
        executed_at: new Date().toISOString(),
      })
      hechos.push({ que, detalle: motivo, ok: false })
      return null
    }
  }

  // El agente generado desde la marca ya existe: no se crea otro para el
  // primer rol, se le pone ese rol. Si no, el comercio termina con dos.
  let base = s.generated_agent_id
  for (const a of plan.agentes) {
    if (base) {
      const preset = roleTemplate(a.rol as never)
      await ctx.admin
        .from('ai_agents')
        .update({
          role: a.rol,
          permissions: preset?.permissions ?? null,
          escalate_keywords: preset?.escalateKeywords ?? [],
          followup_enabled: preset?.followupEnabled ?? false,
          puede_crear_pedidos: preset?.permissions.crear_pedidos === true,
        })
        .eq('id', base)
        .eq('workspace_id', ctx.workspaceId)
      hechos.push({ que: `agente ${a.rol}`, detalle: 'desde tu marca', ok: true })
      base = null
      continue
    }
    await ejecutar(
      'agentes.crear_borrador',
      { nombre: `Riverz ${a.rol}`, rol: a.rol },
      `agente ${a.rol}`,
    )
  }

  for (const receta of plan.recetas) {
    await ejecutar('automatizaciones.crear_desde_receta', { receta }, `receta ${receta}`)
  }

  await ctx.admin
    .from('operacion_setup')
    .upsert(
      {
        workspace_id: ctx.workspaceId,
        step: 4,
        applied: hechos,
        completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'workspace_id' },
    )

  // Recién montada, la cuenta queda muda hacia afuera hasta que alguien la
  // mire. Los agentes y las automatizaciones ya nacen pausados uno por uno,
  // pero eso obliga a encenderlos de a uno; el motor es el mismo permiso a
  // nivel cuenta, y es lo que después se enciende con un solo botón.
  //
  // Sólo en la PRIMERA instalación (`completed_at` estaba vacío). Volver a
  // pasar por el asistente en una cuenta que ya opera no puede dejarla muda:
  // ahí adentro hay clientes esperando respuesta ahora mismo.
  if (!s.completed_at) {
    await ponerMotor(ctx.admin, ctx.workspaceId, false, ctx.userId).catch(() => {})
  }

  return NextResponse.json({ ok: true, hechos, motorApagado: !s.completed_at })
}
