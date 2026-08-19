import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { csrfGuard } from '@/lib/csrf'
import { resolveWorkspaceIdForUser } from '@/lib/workspaces/resolve'
import { getFeatureFlags, isRiverz2 } from '@/lib/admin/feature-flags'
import { limitByKey } from '@/lib/rate-limit'
import { runOperator } from '@/lib/operator/loop'
import { encodeEvent, type OperatorEvent } from '@/lib/operator/events'
import {
  appendMessage,
  ensureThread,
  loadActions,
  loadMessages,
  toAnthropic,
} from '@/lib/operator/threads'
import { getLocale } from '@/lib/i18n/server'

/**
 * Hablar con el Operator.
 *
 * GET  ?thread=… → el hilo y sus acciones propuestas
 * POST { texto, thread? } → una vuelta de conversación
 *
 * Un turno del Operator puede encadenar varias llamadas al modelo, así que
 * tiene su propio techo de ritmo: sin él, mantener apretado "enviar" gasta el
 * saldo de la plataforma tan rápido como aguante la red.
 */
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const RATE = { limit: 20, windowMs: 60_000 }

async function contexto() {
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
  return { admin, userId: user.id, workspaceId }
}

export async function GET(request: Request) {
  const ctx = await contexto()
  if (!ctx) return NextResponse.json({ error: 'not_available' }, { status: 404 })

  const threadId = new URL(request.url).searchParams.get('thread')
  if (!threadId) return NextResponse.json({ mensajes: [], acciones: [] })

  const [mensajes, acciones] = await Promise.all([
    loadMessages(ctx.admin, threadId, ctx.workspaceId),
    loadActions(ctx.admin, threadId, ctx.workspaceId),
  ])
  return NextResponse.json(
    { mensajes, acciones },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}

export async function POST(request: Request) {
  const block = await csrfGuard(request)
  if (block) return block

  const ctx = await contexto()
  if (!ctx) return NextResponse.json({ error: 'not_available' }, { status: 404 })

  const rl = await limitByKey(`operator:${ctx.workspaceId}`, RATE)
  if (!rl.success) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 })
  }

  const body = (await request.json().catch(() => null)) as {
    texto?: string
    thread?: string | null
  } | null
  const texto = (body?.texto ?? '').trim().slice(0, 4000)
  if (!texto) return NextResponse.json({ error: 'texto_required' }, { status: 400 })

  const locale = await getLocale()

  /**
   * El turno se transmite mientras ocurre.
   *
   * Antes esto esperaba a que terminara todo y devolvía un JSON: el comercio
   * veía un spinner veinte segundos y después un párrafo. Ahora ve el
   * razonamiento, cada consulta y cada cosa que queda propuesta, en el momento
   * en que pasa.
   */
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

      try {
        const threadId = await ensureThread(ctx.admin, {
          threadId: body?.thread,
          workspaceId: ctx.workspaceId,
          userId: ctx.userId,
          firstText: texto,
        })

        // El historial se lee ANTES de anotar el mensaje nuevo: el turno actual
        // va aparte, así no se duplica al armar el contexto.
        const previos = await loadMessages(ctx.admin, threadId, ctx.workspaceId)
        await appendMessage(ctx.admin, {
          threadId,
          workspaceId: ctx.workspaceId,
          role: 'user',
          text: texto,
        })

        const turno = await runOperator({
          db: ctx.admin,
          workspaceId: ctx.workspaceId,
          userId: ctx.userId,
          threadId,
          history: [...toAnthropic(previos), { role: 'user', content: texto }],
          locale,
          onEvent: push,
        })

        await appendMessage(ctx.admin, {
          threadId,
          workspaceId: ctx.workspaceId,
          role: 'assistant',
          text: turno.text,
          promptTokens: turno.promptTokens,
          completionTokens: turno.completionTokens,
        })

        // Se manda al final por si el cupo diario cortó el turno antes de
        // llamar al modelo: ahí no hubo deltas y esto es todo lo que hay.
        if (turno.overBudget) push({ t: 'text', delta: turno.text })
        push({ t: 'done', thread: threadId })
      } catch (err) {
        push({ t: 'error', message: err instanceof Error ? err.message : 'failed' })
      } finally {
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
      // Sin esto, la compresión de Next junta los chunks y todo llega al final
      // — que es exactamente lo que este endpoint viene a evitar.
      'X-Accel-Buffering': 'no',
    },
  })
}
