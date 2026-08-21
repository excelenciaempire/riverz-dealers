import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { csrfGuard } from '@/lib/csrf'
import { resolveWorkspaceIdForUser } from '@/lib/workspaces/resolve'
import { getFeatureFlags, isOperatorFleet, isRiverz2 } from '@/lib/admin/feature-flags'
import { limitByKey } from '@/lib/rate-limit'
import { runOperator } from '@/lib/operator/loop'
import { encodeEvent, type OperatorEvent } from '@/lib/operator/events'
import {
  appendMessage,
  borrarHilo,
  ensureThread,
  listarHilos,
  loadActions,
  loadMessages,
  toAnthropic,
} from '@/lib/operator/threads'
import { guardarGasto } from '@/lib/operator/gasto'
import { getLocale } from '@/lib/i18n/server'
import { translate } from '@/lib/i18n/translate'
import { claveRechazada } from '@/lib/ai/platform-key'

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

/**
 * Cuántos mensajes por minuto.
 *
 * Baja de 20 a 10 porque un turno hace mucho más trabajo que antes: con equipo
 * puede encadenar el orquestador más tres especialistas, cada uno con sus
 * vueltas. Diez por minuto sigue siendo más de lo que nadie escribe, y el techo
 * real de llamadas al modelo lo pone `MAX_LLAMADAS_TURNO`, que cuenta lo que
 * este cubo no puede ver: un pedido HTTP no dice cuántas llamadas hay adentro.
 */
const RATE = { limit: 10, windowMs: 60_000 }

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
  // El equipo es otro flag, y arranca apagado. `riverz_2` ya está prendido para
  // toda la base: sin esta segunda puerta, cada commit del equipo le llegaría a
  // comercios reales antes de estar terminado.
  return { admin, userId: user.id, workspaceId, flota: isOperatorFleet(flags) }
}

/**
 * ¿Este comercio pidió que construya sin preguntar?
 *
 * Sin fila, SÍ. Cambió respecto de la primera versión: arrancar en modo tímido
 * hacía que la primera experiencia de cualquier cuenta fuera aprobar tres
 * tarjetas para crear tres borradores que nacen apagados. Lo que se construye
 * solo es únicamente lo inerte —lo que queda pausado, en borrador, sin salir—,
 * así que lo peor que pasa sin mirar es que aparezcan cosas apagadas.
 *
 * Lo que le llega a una persona, sale a Meta o mueve dinero sigue pidiendo el
 * click en los dos modos, y el interruptor sigue estando para quien prefiera
 * aprobar todo.
 */
async function autoBuildDe(
  admin: ReturnType<typeof supabaseAdmin>,
  workspaceId: string,
): Promise<boolean> {
  const { data } = await admin
    .from('operacion_setup')
    .select('auto_build')
    .eq('workspace_id', workspaceId)
    .maybeSingle()
  const fila = data as { auto_build?: boolean } | null
  return fila?.auto_build !== false
}

export async function GET(request: Request) {
  const ctx = await contexto()
  if (!ctx) return NextResponse.json({ error: 'not_available' }, { status: 404 })

  const threadId = new URL(request.url).searchParams.get('thread')
  // La lista de hilos viaja siempre: la pantalla la necesita tanto al abrir una
  // conversación como al arrancar en blanco, y son dos consultas baratas.
  const [autoBuild, hilos] = await Promise.all([
    autoBuildDe(ctx.admin, ctx.workspaceId),
    listarHilos(ctx.admin, ctx.workspaceId),
  ])

  if (!threadId) {
    return NextResponse.json(
      { mensajes: [], acciones: [], autoBuild, hilos },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  }

  const [mensajes, acciones] = await Promise.all([
    loadMessages(ctx.admin, threadId, ctx.workspaceId),
    loadActions(ctx.admin, threadId, ctx.workspaceId),
  ])
  return NextResponse.json(
    { mensajes, acciones, autoBuild, hilos },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}

/**
 * Borrar una conversación.
 *
 * Lo que se hizo desde ella no se borra: las acciones se desatan del hilo pero
 * quedan. Una automatización creada sigue existiendo en la cuenta después de
 * limpiar el historial, y su registro de auditoría tiene que sobrevivir a eso.
 */
export async function DELETE(request: Request) {
  const block = await csrfGuard(request)
  if (block) return block
  const ctx = await contexto()
  if (!ctx) return NextResponse.json({ error: 'not_available' }, { status: 404 })

  const threadId = new URL(request.url).searchParams.get('thread')
  if (!threadId) return NextResponse.json({ error: 'falta thread' }, { status: 400 })

  const ok = await borrarHilo(ctx.admin, threadId, ctx.workspaceId)
  if (!ok) return NextResponse.json({ error: 'no existe' }, { status: 404 })
  return NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } })
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
          autoBuild: await autoBuildDe(ctx.admin, ctx.workspaceId),
          flota: ctx.flota,
          // Lo último que escribió la persona, para la pista de intención. El
          // historial ya lo trae, pero buscarlo ahí adentro sería adivinar
          // cuál de los mensajes es el de ahora.
          pedido: texto,
        })

        await appendMessage(ctx.admin, {
          threadId,
          workspaceId: ctx.workspaceId,
          role: 'assistant',
          text: turno.text,
          promptTokens: turno.promptTokens,
          completionTokens: turno.completionTokens,
        })

        if (turno.porAgente) {
          await guardarGasto(ctx.admin, {
            workspaceId: ctx.workspaceId,
            threadId,
            porAgente: turno.porAgente,
          })
        }

        // Se manda al final por si el cupo diario cortó el turno antes de
        // llamar al modelo: ahí no hubo deltas y esto es todo lo que hay.
        if (turno.overBudget) push({ t: 'text', delta: turno.text })
        push({ t: 'done', thread: threadId })
      } catch (err) {
        // Lo que salía era el JSON crudo de Anthropic, en inglés y en rojo:
        // «400 {"type":"error",...,"Your credit balance is too low..."}». Nadie
        // que venda cremas tiene por qué leer eso. El único caso que le sirve
        // saber es que la plataforma se quedó sin saldo, y eso se lo decimos
        // con palabras; el detalle técnico queda en el log.
        if (err) console.error('[operator] turno caído', err)
        push({
          t: 'error',
          message: translate(
            locale,
            claveRechazada(err) ? 'operation.operatorSinSaldo' : 'operation.operatorError',
          ),
        })
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
      // Las tres cabeceras existen por lo mismo: que nadie junte los pedazos.
      // Un intermediario que comprima o cachee este cuerpo lo entrega entero al
      // final, y entonces el streaming no se nota en ningún lado.
      'Cache-Control': 'no-store, no-transform',
      'Content-Encoding': 'identity',
      'X-Accel-Buffering': 'no',
    },
  })
}
