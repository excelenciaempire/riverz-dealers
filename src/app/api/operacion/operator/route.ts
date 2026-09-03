import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { csrfGuard } from '@/lib/csrf'
import { puertaDeIa } from '@/lib/wallet/puerta'
import { cobrar } from '@/lib/wallet/saldo'
import { resolveWorkspaceIdForUser } from '@/lib/workspaces/resolve'
import { getFeatureFlags, isOperatorFleet, isRiverz2 } from '@/lib/admin/feature-flags'
import { limitByKey } from '@/lib/rate-limit'
import { runOperator } from '@/lib/operator/loop'
import { encodeEvent, type OperatorEvent } from '@/lib/operator/events'
import { grabador } from '@/lib/operator/bloques'
import { planQueEspera } from '@/lib/operator/fleet/plan'
import {
  abrirCorrida,
  cerrarCorrida,
  corridaViva,
  latido,
  pidieronDetener,
} from '@/lib/operator/corridas'
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
/**
 * Nada se construye sin que una persona lo apruebe.
 *
 * Hubo un interruptor —«construye solo» vs «pide permiso»— y el argumento para
 * el primero era que lo inerte no le hace daño a nadie: nace pausado. Es cierto
 * que no hace daño, y aun así fue el peor momento del producto: se creó una
 * automatización, el paso decía «Crearía» y había un botón de aprobar debajo
 * (el de prenderla), así que quien miraba concluyó que no había aprobado nada.
 * Y tenía razón en lo único que importa: no lo había aprobado.
 *
 * Un interruptor que decide si te van a preguntar es una decisión que se toma
 * una vez, en frío, y se cobra siempre. Ahora no hay decisión: el equipo
 * propone y una persona aprueba. Los pasos de un plan YA aprobado sí se
 * construyen — ahí la aprobación fue el click sobre el plan.
 */
// Construir un borrador local, un agente en pausa o una automatización pausada
// no alcanza a nadie. El loop sólo ejecuta esas capacidades marcadas como
// inertes; publicar, activar, enviar, cobrar o borrar sigue quedando como una
// propuesta que requiere confirmación explícita.
const CONSTRUIR_INERTE_AUTOMATICAMENTE = true

export async function GET(request: Request) {
  const ctx = await contexto()
  if (!ctx) return NextResponse.json({ error: 'not_available' }, { status: 404 })

  const threadId = new URL(request.url).searchParams.get('thread')
  // La lista de hilos viaja siempre: la pantalla la necesita tanto al abrir una
  // conversación como al arrancar en blanco, y son dos consultas baratas.
  const hilos = await listarHilos(ctx.admin, ctx.workspaceId)

  /**
   * Sin `thread`, se abre la última.
   *
   * Es lo que la pantalla hace SIEMPRE al entrar, y pedirlo aparte costaba un
   * segundo viaje encadenado: primero la lista, después —ya sabiendo el id— la
   * conversación. Dos esperas en fila con el chat en blanco, por algo que el
   * servidor ya tiene en la mano.
   */
  const abrir = threadId ?? hilos[0]?.id ?? null

  if (!abrir) {
    return NextResponse.json(
      { thread: null, mensajes: [], acciones: [], hilos, plan: null, corrida: null },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  }

  const [mensajes, acciones, plan, corrida] = await Promise.all([
    loadMessages(ctx.admin, abrir, ctx.workspaceId),
    loadActions(ctx.admin, abrir, ctx.workspaceId),
    // El plan que quedó esperando un sí. Se dibujaba sólo desde el stream, así
    // que cerrar la pantalla lo borraba de la vista y quedaba en la base sin
    // forma de aprobarlo.
    planQueEspera(ctx.admin, abrir, ctx.workspaceId),
    // Y si quedó algo corriendo. Era el TERCER viaje: salir de la pantalla no
    // cancela el turno, así que al volver hay que engancharse de nuevo — y
    // preguntarlo aparte era otra espera por un booleano.
    corridaViva(ctx.admin, abrir, ctx.workspaceId),
  ])
  return NextResponse.json(
    {
      thread: abrir,
      mensajes,
      acciones,
      hilos,
      corrida,
      plan: plan
        ? {
            planId: plan.id,
            porque: plan.porque ?? '',
            pasos: plan.pasos.map((p) => ({
              i: p.i,
              agente: p.agente,
              que: p.que,
              encargo: p.encargo,
              dependeDe: p.dependeDe,
            })),
          }
        : null,
    },
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

  // El Operador es la IA mas cara de la casa: un turno son varias llamadas al
  // modelo. Sin saldo o con la suscripcion vencida no arranca, y el motivo
  // vuelve al cliente para que la pantalla diga cual de los dos es.
  const puerta = await puertaDeIa(ctx.admin, ctx.workspaceId)
  if (!puerta.puede) {
    return NextResponse.json({ error: puerta.motivo }, { status: 402 })
  }

  const locale = await getLocale()

  /**
   * El turno se transmite mientras ocurre.
   *
   * Antes esto esperaba a que terminara todo y devolvía un JSON: el comercio
   * veía un spinner veinte segundos y después un párrafo. Ahora ve el
   * razonamiento, cada consulta y cada cosa que queda propuesta, en el momento
   * en que pasa.
   */
  /**
   * El turno corre SOLO, y el stream mira.
   *
   * Antes el trabajo vivía adentro del `ReadableStream`: cuando el navegador se
   * iba —cambiar de pantalla, cerrar la pestaña, perder señal— el stream se
   * cortaba y el turno moría con él. Al volver, la conversación mostraba el
   * pedido y ninguna respuesta. Y un turno con reparto tarda minutos: irse a
   * mirar otra cosa mientras tanto es lo normal, no el caso raro.
   *
   * Ahora son dos cosas separadas. El trabajo es una promesa suelta que empuja
   * eventos a una cola y va guardando cómo va; el stream se limita a vaciar esa
   * cola hacia quien esté mirando. Si no hay nadie, la cola se descarta y el
   * trabajo sigue igual — y quien vuelve lo retoma leyendo la corrida.
   */
  const threadId = await ensureThread(ctx.admin, {
    threadId: body?.thread,
    workspaceId: ctx.workspaceId,
    userId: ctx.userId,
    firstText: texto,
  })

  const { id: runId, yaHabia } = await abrirCorrida(ctx.admin, threadId, ctx.workspaceId)
  // Dos turnos a la vez sobre el mismo hilo se pisan el contexto. Quien pide
  // uno mientras hay otro corriendo recibe el que ya está.
  if (yaHabia) {
    return NextResponse.json(
      { error: 'ya_corriendo', run: runId, thread: threadId },
      { status: 409 },
    )
  }

  const turnoVisto = grabador()
  const cola: OperatorEvent[] = []
  // En una caja y no en un `let`: el compilador no ve la asignacion que pasa
  // dentro del stream y estrecha la variable a `null`, asi que llamarla desde
  // el trabajo no compila. La caja lo deja mutar desde los dos lados.
  const espera: { avisar: (() => void) | null } = { avisar: null }
  let terminado = false
  let textoAcumulado = ''
  const foto = latido(ctx.admin, runId)

  const push = (e: OperatorEvent) => {
    turnoVisto.ver(e)
    if (e.t === 'text') textoAcumulado += e.delta
    cola.push(e)
    espera.avisar?.()
    // La foto, para quien vuelva. Como mucho una por segundo.
    void foto.ver(textoAcumulado, turnoVisto.bloques)
  }

  /** El trabajo. NO se espera acá: por eso sobrevive al navegador. */
  const trabajo = (async () => {
    try {
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
        autoBuild: CONSTRUIR_INERTE_AUTOMATICAMENTE,
        flota: ctx.flota,
        pedido: texto,
        detener: () => pidieronDetener(ctx.admin, runId),
      })

      /**
       * Se guarda lo que se VIO, no la última frase.
       *
       * `turno.text` es el texto de la última llamada al modelo, y un turno son
       * varias: lo que dijo en la primera —«esas tres plantillas no llegaron a
       * crearse»— se emitía en pantalla y no quedaba en la fila. El hilo se
       * dibuja desde los bloques, así que a la vista no se notaba; lo que se
       * perdía era el contexto del turno siguiente, que sí lee este campo.
       */
      await appendMessage(ctx.admin, {
        threadId,
        workspaceId: ctx.workspaceId,
        role: 'assistant',
        text: textoAcumulado.trim() || turno.text,
        bloques: turnoVisto.bloques,
        promptTokens: turno.promptTokens,
        completionTokens: turno.completionTokens,
      })

      // ── La billetera ──
      // El Operador corre siempre con la llave de Riverz: no hay BYOK en este
      // camino. Se cobra el turno que se ejecuto, con el costo real de todos
      // los modelos que participaron. `cobrar` nunca lanza.
      if (turno.costoUsd > 0) {
        void cobrar(ctx.admin, ctx.workspaceId, {
          concepto: 'ia_operador',
          cantidad: 1,
          costoUsd: turno.costoUsd,
          referenciaTipo: 'operator_thread',
          referenciaId: threadId,
          detalle: { equipo: Boolean(ctx.flota) },
        })
      }

      if (turno.porAgente) {
        await guardarGasto(ctx.admin, {
          workspaceId: ctx.workspaceId,
          threadId,
          porAgente: turno.porAgente,
        })
      }

      // Se manda al final por si el cupo diario cortó el turno antes de llamar
      // al modelo: ahí no hubo deltas y esto es todo lo que hay.
      if (turno.overBudget) push({ t: 'text', delta: turno.text })
      push({ t: 'done', thread: threadId })

      const detenido = await pidieronDetener(ctx.admin, runId)
      await cerrarCorrida(ctx.admin, runId, detenido ? 'detenido' : 'listo', {
        texto: turno.text || textoAcumulado,
        bloques: turnoVisto.bloques,
      })
    } catch (err) {
      // Lo que salía era el JSON crudo de Anthropic, en inglés y en rojo. Nadie
      // que venda cremas tiene por qué leer eso: el único caso que le sirve
      // saber es que la plataforma se quedó sin saldo, y eso se dice con
      // palabras. El detalle técnico queda en el log.
      if (err) console.error('[operator] turno caído', err)
      const message = translate(
        locale,
        claveRechazada(err) ? 'operation.operatorSinSaldo' : 'operation.operatorError',
      )
      push({ t: 'error', message })

      /**
       * Un turno que se cae igual deja rastro en el hilo.
       *
       * No se guardaba nada: quedaba el pedido de la persona y ninguna
       * respuesta, aunque el equipo hubiera dejado tres propuestas en la base
       * antes de romperse. Al recargar, la conversación se veía como si nunca
       * hubiera pasado nada, y el turno siguiente arrancaba sin saber qué había
       * propuesto — que es exactamente cómo se terminan proponiendo las mismas
       * tres cosas dos veces.
       *
       * Sólo si hubo algo que contar: un turno que muere en la primera llamada
       * no tiene por qué dejar un mensaje vacío en el historial.
       */
      if (textoAcumulado.trim() || turnoVisto.bloques.length > 0) {
        await appendMessage(ctx.admin, {
          threadId,
          workspaceId: ctx.workspaceId,
          role: 'assistant',
          text: textoAcumulado.trim() || message,
          bloques: turnoVisto.bloques,
        }).catch(() => undefined)
      }

      await cerrarCorrida(ctx.admin, runId, 'fallido', {
        texto: textoAcumulado,
        bloques: turnoVisto.bloques,
        error: err instanceof Error ? err.message : String(err),
      })
    } finally {
      terminado = true
      espera.avisar?.()
    }
  })()
  // Que no se pierda un rechazo sin manejar si nadie llega a leerla.
  void trabajo.catch(() => undefined)

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const enc = new TextEncoder()
      try {
        // Se vacía la cola hasta que el trabajo diga que terminó. Si el cliente
        // se va, `enqueue` tira y se sale del bucle — el trabajo ni se entera.
        for (;;) {
          while (cola.length > 0) {
            controller.enqueue(enc.encode(encodeEvent(cola.shift()!)))
          }
          if (terminado) break
          await new Promise<void>((resolve) => {
            const seguir = () => {
              espera.avisar = null
              clearTimeout(reloj)
              resolve()
            }
            /**
             * El aviso perdido.
             *
             * Entre vaciar la cola y llegar a esta línea pasa un tick, y en ese
             * hueco `push` puede haber corrido: encolaba el evento y llamaba a
             * un `avisar` que todavía era null. Nadie despertaba al lector, así
             * que la conversación se congelaba después de la primera frase
             * mientras el turno seguía trabajando sin que nadie lo viera.
             *
             * Se cierra mirando la cola DESPUÉS de instalar el aviso. Y el reloj
             * es el cinturón: si alguna vez se pierde otro, el lector se
             * despierta igual en un cuarto de segundo en vez de dormir para
             * siempre.
             */
            const reloj = setTimeout(seguir, 250)
            espera.avisar = seguir
            if (cola.length > 0 || terminado) seguir()
          })
        }
      } catch {
        // El navegador se fue. El turno sigue.
      } finally {
        espera.avisar = null
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
      // Con qué corrida se está mirando. Es lo que le permite a la pantalla
      // ofrecer el botón de detener, y volver a engancharse si se va y regresa.
      'x-riverz-run': runId,
    },
  })
}
