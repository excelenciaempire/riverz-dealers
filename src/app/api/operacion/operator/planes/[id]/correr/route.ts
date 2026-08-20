import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { csrfGuard } from '@/lib/csrf'
import { resolveWorkspaceIdForUser } from '@/lib/workspaces/resolve'
import { getFeatureFlags, isOperatorFleet, isRiverz2 } from '@/lib/admin/feature-flags'
import { limitByKey } from '@/lib/rate-limit'
import { getAnthropicStreaming } from '@/lib/ai/anthropic-client'
import { resolveAnthropicKey } from '@/lib/ai/platform-key'
import { encodeEvent, type OperatorEvent } from '@/lib/operator/events'
import { crearPresupuesto } from '@/lib/operator/fleet/budget'
import { ejecutarPlan } from '@/lib/operator/fleet/ejecutar-plan'
import { cargarPlan, reclamarPlan } from '@/lib/operator/fleet/plan'
import { anthropicRunner } from '@/lib/operator/fleet/runner'
import { guardarGasto } from '@/lib/operator/gasto'
import { appendMessage } from '@/lib/operator/threads'
import { getLocale } from '@/lib/i18n/server'
import type { CapabilityContext } from '@/lib/capabilities/types'

/**
 * Correr un plan que una persona aprobó.
 *
 * Es una ruta propia y no un turno de chat con la palabra "aprobado". La
 * alternativa se descartó por un motivo concreto: gastaría una llamada al
 * modelo para volver a decidir lo mismo, y le daría la oportunidad de repartir
 * distinto de lo que la persona aprobó, que es justo lo que la aprobación viene
 * a impedir. Lo que corre son los pasos GUARDADOS, textuales, igual que aprobar
 * una acción ejecuta los argumentos guardados y no lo que el modelo diga
 * después.
 *
 * Devuelve el mismo NDJSON que el chat, así que la pantalla lo lee con el mismo
 * código.
 */
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Más bajo que el del chat a propósito.
 *
 * Un plan mueve al equipo entero: cinco por minuto ya es más de lo que una
 * persona puede mirar, y el techo protege el saldo de la plataforma de un bucle
 * de reintentos.
 */
const RATE = { limit: 5, windowMs: 60_000 }

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
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = supabaseAdmin()
  const workspaceId = await resolveWorkspaceIdForUser(admin, user.id)
  if (!workspaceId) return NextResponse.json({ error: 'no_workspace' }, { status: 400 })

  const flags = await getFeatureFlags(admin, workspaceId)
  if (!isRiverz2(flags) || !isOperatorFleet(flags)) {
    return NextResponse.json({ error: 'not_available' }, { status: 404 })
  }

  const rl = await limitByKey(`operator:plan:${workspaceId}`, RATE)
  if (!rl.success) return NextResponse.json({ error: 'rate_limited' }, { status: 429 })

  const { id: planId } = await params
  const plan = await cargarPlan(admin, planId, workspaceId)
  if (!plan) return NextResponse.json({ error: 'no existe' }, { status: 404 })

  // El UPDATE condicionado es lo que impide correrlo dos veces: dos clicks
  // seguidos, o dos pestañas abiertas, y el segundo se encuentra con que ya no
  // está esperando aprobación.
  const reclamado = await reclamarPlan(admin, planId, workspaceId, user.id)
  if (!reclamado) {
    return NextResponse.json({ error: 'ya no esta esperando' }, { status: 409 })
  }

  const resolved = await resolveAnthropicKey(admin, { workspaceId })
  if (!resolved) return NextResponse.json({ error: 'sin clave de IA' }, { status: 400 })

  const locale = await getLocale()
  const ctx: CapabilityContext = {
    db: admin,
    workspaceId,
    actor: { type: 'operator', id: user.id },
    locale,
  }
  const threadId = plan.threadId ?? planId

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const enc = new TextEncoder()
      let cerrado = false
      const push = (e: OperatorEvent) => {
        if (cerrado) return
        try {
          controller.enqueue(enc.encode(encodeEvent(e)))
        } catch {
          cerrado = true
        }
      }

      // Un plan de varias olas puede tardar minutos sin decir nada, y un NDJSON
      // mudo es indistinguible de una conexión cortada para el navegador, para
      // un proxy y para la persona que está mirando.
      const latido = setInterval(() => push({ t: 'latido' }), 10_000)

      try {
        push({ t: 'plan_estado', planId, estado: 'corriendo' })
        const presupuesto = crearPresupuesto()
        const r = await ejecutarPlan({
          plan,
          ctx,
          threadId,
          // Diez minutos: un plan de varias olas los usa sin que nada falle.
          runner: anthropicRunner(getAnthropicStreaming(resolved.key)),
          emit: push,
          presupuesto,
        })

        const total = presupuesto.total()
        await guardarGasto(admin, {
          workspaceId,
          threadId,
          porAgente: presupuesto.porAgente(),
        })

        // El cierre en el hilo: qué quedó hecho y qué quedó esperando. Sin
        // esto, la conversación termina con el plan propuesto y nunca cuenta
        // cómo salió.
        const cierre = resumirCierre(r)
        push({ t: 'text', delta: cierre })
        await appendMessage(admin, {
          threadId,
          workspaceId,
          role: 'assistant',
          text: cierre,
          promptTokens: total.promptTokens,
          completionTokens: total.completionTokens,
        }).catch(() => {
          /* si el plan no cuelga de un hilo de chat, no hay dónde anotarlo */
        })

        push({ t: 'done', thread: threadId })
      } catch (err) {
        push({ t: 'error', message: err instanceof Error ? err.message : 'failed' })
      } finally {
        clearInterval(latido)
        cerrado = true
        try {
          controller.close()
        } catch {
          /* ya estaba cerrado */
        }
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-store, no-transform',
      'Content-Encoding': 'identity',
      'X-Accel-Buffering': 'no',
    },
  })
}

/**
 * Cómo salió, en una línea.
 *
 * Lo escribe el servidor y no el modelo: es un recuento de hechos, y gastar una
 * llamada en redactarlo sería pagar por adornar una suma. Con negritas en las
 * cifras, que es como se escribe en esta casa.
 */
function resumirCierre(r: Awaited<ReturnType<typeof ejecutarPlan>>): string {
  const ok = r.pasos.filter((p) => p.estado === 'ok').length
  const fallidos = r.pasos.filter((p) => p.estado === 'fallido')
  const saltados = r.pasos.filter((p) => p.estado === 'saltado').length

  const partes: string[] = []
  if (ok > 0) partes.push(`**${ok}** ${ok === 1 ? 'paso listo' : 'pasos listos'}`)
  if (r.construidas > 0) {
    partes.push(
      `**${r.construidas}** ${r.construidas === 1 ? 'cosa creada' : 'cosas creadas'}`,
    )
  }
  if (r.propuestas > 0) {
    partes.push(
      `**${r.propuestas}** ${r.propuestas === 1 ? 'espera tu aprobación' : 'esperan tu aprobación'}`,
    )
  }
  if (fallidos.length > 0) {
    partes.push(`**${fallidos.length}** ${fallidos.length === 1 ? 'falló' : 'fallaron'}`)
  }
  if (saltados > 0) {
    partes.push(`**${saltados}** no se ${saltados === 1 ? 'intentó' : 'intentaron'}`)
  }

  const linea = partes.length > 0 ? partes.join(' · ') : 'No quedó nada por hacer.'
  if (fallidos.length === 0) return linea
  return `${linea}\n\n${fallidos.map((f) => `${f.agente}: ${f.resumen}`).join('\n')}`
}
