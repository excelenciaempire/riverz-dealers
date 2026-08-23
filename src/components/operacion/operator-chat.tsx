'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  AlertTriangle,
  ArrowUp,
  Check,
  Eye,
  History,
  Loader2,
  MessageSquarePlus,
  PlusCircle,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react'
import { useT } from '@/hooks/use-locale'
import { TextoRico } from '@/components/ui/texto-rico'
import {
  agrupar,
  aplicarEvento,
  aplicarEventoDePlan,
  sinCondicional,
  type Bloque,
} from '@/lib/operator/bloques'
import { useFormat } from '@/hooks/use-format'
import { useFetchWithCsrf } from '@/lib/api/fetch-with-csrf'
import { drainEvents } from '@/lib/operator/events'
import type { Artefacto } from '@/lib/operator/artifacts'
import type { ResumenHilo } from '@/lib/operator/threads'
import { VistaArtefacto } from './artefacto'
import { useMesaDispatch } from './mesa-contexto'
import { cn } from '@/lib/utils'

/**
 * El Operator, dentro del Centro de Operación.
 *
 * Lo que el Operator propone NO está hecho: aparece como una tarjeta con lo
 * que haría y dos botones. Esa separación es la que permite que lea datos
 * escritos por clientes —donde alguien podría esconder una instrucción— sin
 * que eso alcance para cambiar nada.
 */

interface Mensaje {
  id: string
  role: 'user' | 'assistant'
  text: string
  /**
   * El turno tal como se vio ocurrir. Se conserva después de terminar: haber
   * mirado cómo lo armaba y que después quede sólo un párrafo borra la parte
   * que explica de dónde salió cada cosa.
   */
  bloques?: Bloque[]
}

interface Accion {
  id: string
  capability_key: string
  args: Record<string, unknown>
  risk: 'lectura' | 'reversible' | 'irreversible'
  status: 'propuesto' | 'ejecutado' | 'rechazado' | 'fallido'
  preview: string | null
}

/**
 * Cómo se lee cada paso en la pantalla.
 *
 * La descripción de una capacidad está escrita para el modelo y son dos
 * renglones; acá hace falta un verbo y poco más. Lo que no esté en este mapa
 * cae a lo que mandó el servidor, así que sumar una capacidad nunca deja un
 * hueco — sólo una línea más larga.
 */
const PASO_LABEL: Record<string, string> = {
  'operacion.estado': 'operation.stepEstado',
  'metricas.resumen': 'operation.stepMetricas',
  'conversaciones.pendientes': 'operation.stepPendientes',
  'contactos.buscar': 'operation.stepContacto',
  'mensajes.diagnostico': 'operation.stepDiagnostico',
  'pedidos.listar': 'operation.stepPedidos',
  'plantillas.estado': 'operation.stepPlantillas',
  'integraciones.estado': 'operation.stepIntegraciones',
  'campanas.estado': 'operation.stepCampanas',
  'agentes.listar': 'operation.stepAgentes',
  'agentes.crear_borrador': 'operation.stepAgenteCrear',
  'agentes.activar': 'operation.stepAgenteActivar',
  'automatizaciones.listar': 'operation.stepAutosListar',
  'automatizaciones.ver': 'operation.stepAutoVer',
  'automatizaciones.editar': 'operation.stepAutoEditar',
  'plantillas.detalle': 'operation.stepPlantillaDetalle',
  'plantillas.crear_borrador': 'operation.stepPlantillaBorrador',
  'plantillas.enviar_a_meta': 'operation.stepPlantillaAMeta',
  'automatizaciones.recetas': 'operation.stepRecetas',
  'automatizaciones.activar': 'operation.stepAutoActivar',
  'automatizaciones.editar_espera': 'operation.stepAutoEspera',
  'automatizaciones.crear_desde_receta': 'operation.stepAutoCrear',
  // Faltaba justo la que arma desde cero: sin entrada acá caía al respaldo del
  // servidor, que es la primera cláusula de la descripción escrita para el
  // modelo — dos renglones donde tenía que haber un verbo.
  'automatizaciones.crear': 'operation.stepAutoCrearCero',
  'aprobaciones.pendientes': 'operation.stepAprobPend',
  'aprobaciones.decidir': 'operation.stepAprobDecidir',
  'contactos.listar': 'operation.stepContactosListar',
  'etiquetas.listar': 'operation.stepEtiquetas',
  'segmentos.listar': 'operation.stepSegmentosListar',
  'segmentos.calcular': 'operation.stepSegmentoCalcular',
  'segmentos.crear': 'operation.stepSegmentoCrear',
  'contactos.etiquetar': 'operation.stepEtiquetar',
}

/** La primera frase de un texto. Lo que se muestra de un encargo. */
function primeraFrase(texto: string): string {
  const m = texto.match(/^[^.!?]*[.!?]/)
  const f = (m ? m[0] : texto).trim()
  return f.length > 4 ? f : texto.trim()
}

interface PlanPendiente {
  planId: string
  porque: string
  pasos: { i: number; agente: string; encargo: string; dependeDe: number[] }[]
  estado: 'esperando' | 'corriendo' | 'listo' | 'rechazado'
}

/** El turno en curso. */
interface Vivo {
  /** Razonamiento del modelo, cuando lo expone (ver `events.ts`). */
  thinking: string
  bloques: Bloque[]
}

export function OperatorChat({
  onChanged,
  fullscreen = false,
}: {
  onChanged?: () => void
  /**
   * El chat como pantalla y no como panel: sin marco ni encabezado (la barra
   * de pestañas ya dice dónde estás) y con la conversación en una columna
   * centrada, que es lo que hace legible un hilo largo en una pantalla ancha.
   */
  fullscreen?: boolean
}) {
  const t = useT()
  const fetchWithCsrf = useFetchWithCsrf()
  // La mesa de trabajo es HERMANA del chat, no hija: se le pasan los eventos
  // por contexto en vez de levantar el estado, para no tener que reescribir el
  // lector del stream.
  const aLaMesa = useMesaDispatch()
  const [thread, setThread] = useState<string | null>(null)
  const [mensajes, setMensajes] = useState<Mensaje[]>([])
  const [acciones, setAcciones] = useState<Accion[]>([])
  const [texto, setTexto] = useState('')
  const [pensando, setPensando] = useState(false)
  const [vivo, setVivo] = useState<Vivo | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [hilos, setHilos] = useState<ResumenHilo[]>([])
  /**
   * El reparto que quedó esperando un click.
   *
   * Vive en el chat y no en la mesa porque es una DECISIÓN, y las decisiones
   * están donde están las otras: junto a las tarjetas de aprobación, al final
   * del hilo. La mesa lo muestra también, pero de sólo lectura.
   */
  const [plan, setPlan] = useState<PlanPendiente | null>(null)
  const [cargandoHilo, setCargandoHilo] = useState(false)
  const finalRef = useRef<HTMLDivElement | null>(null)

  // El modo es de la cuenta, no del navegador: se lee del servidor al abrir.
  // De paso vienen las conversaciones anteriores, que es la misma consulta.
  useEffect(() => {
    let cancelado = false
    void (async () => {
      try {
        const res = await fetch('/api/operacion/operator', { cache: 'no-store' })
        if (!res.ok || cancelado) return
        const json = (await res.json()) as {
          hilos?: ResumenHilo[]
        }
        if (cancelado) return
        setHilos(json.hilos ?? [])
      } catch {
        /* si no se puede leer, el interruptor no se muestra */
      }
    })()
    return () => {
      cancelado = true
    }
  }, [])

  /**
   * Abre una conversación anterior.
   *
   * Cada hilo es su propio contexto: lo que se habló en uno no entra en el
   * otro. Eso ya era cierto en el servidor, pero no se podía usar porque la
   * pantalla abría un hilo nuevo en cada carga y no había forma de volver a
   * ninguno. Se guardaba todo y no se leía nada.
   */
  const abrirHilo = useCallback(async (id: string) => {
    setCargandoHilo(true)
    setError(null)
    try {
      const res = await fetch(`/api/operacion/operator?thread=${id}`, {
        cache: 'no-store',
      })
      if (!res.ok) throw new Error('no se pudo')
      const json = (await res.json()) as {
        mensajes?: { id: string; role: 'user' | 'assistant'; text: string }[]
        acciones?: Accion[]
      }
      setThread(id)
      setMensajes((json.mensajes ?? []) as Mensaje[])
      setAcciones(json.acciones ?? [])
      setVivo(null)
    } catch {
      setError(t('operation.operatorError'))
    } finally {
      setCargandoHilo(false)
    }
  }, [t])

  /** Empezar de cero. El hilo anterior queda guardado y accesible. */
  const nuevoChat = useCallback(() => {
    // Sin esto quedan en la mesa los agentes del turno anterior, trabajando
    // sobre una conversación que ya no existe.
    aLaMesa({ tipo: 'limpiar' })
    setPlan(null)
    setThread(null)
    setMensajes([])
    setAcciones([])
    setVivo(null)
    setError(null)
    setTexto('')
  }, [aLaMesa])

  const borrarChat = useCallback(
    async (id: string) => {
      // Optimista: si falla, la lista se repone sola en la próxima carga.
      setHilos((hs) => hs.filter((h) => h.id !== id))
      if (id === thread) nuevoChat()
      try {
        await fetchWithCsrf(`/api/operacion/operator?thread=${id}`, { method: 'DELETE' })
      } catch {
        /* silencioso: borrar es una comodidad, no una operación crítica */
      }
    },
    [fetchWithCsrf, nuevoChat, thread],
  )

  const enviar = useCallback(
    async (valor: string) => {
      const limpio = valor.trim()
      if (!limpio || pensando) return
      setError(null)
      setTexto('')
      setMensajes((m) => [...m, { id: `local-${m.length}`, role: 'user', text: limpio }])
      setPensando(true)
      setVivo({ thinking: '', bloques: [] })

      try {
        const res = await fetchWithCsrf('/api/operacion/operator', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ texto: limpio, thread }),
        })
        if (res.status === 429) {
          setError(t('operation.operatorRateLimited'))
          return
        }
        if (!res.ok || !res.body) throw new Error('failed')

        // Se lee a medida que llega. `getReader()` y no `EventSource` porque
        // este POST lleva el token CSRF en una cabecera, y EventSource no puede
        // mandar cabeceras.
        const reader = res.body.getReader()
        const dec = new TextDecoder()
        let buffer = ''
        let final = ''
        let hilo = thread
        let bloques: Bloque[] = []
        let thinking = ''

        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          // `stream: true` mantiene a medias los caracteres partidos entre dos
          // chunks: sin eso una tilde cortada rompe el JSON de esa línea.
          buffer += dec.decode(value, { stream: true })
          const { events, rest } = drainEvents(buffer)
          buffer = rest

          for (const e of events) {
            // Todo va a la mesa; el hilo se queda sólo con lo que le toca.
            aLaMesa({ tipo: 'evento', e })
            if (e.t === 'plan') {
              setPlan({
                planId: e.planId,
                porque: e.porque,
                pasos: e.pasos,
                estado: 'esperando',
              })
            } else if (e.t === 'thinking') {
              thinking += e.delta
            } else if (e.t === 'error') {
              setError(e.message)
            } else if (e.t === 'done') {
              hilo = e.thread
            }
            if (e.t === 'text') final += e.delta
            // El mismo reductor que usa el servidor para guardar el turno: con
            // dos copias, el hilo se veía de una forma en vivo y de otra al
            // recargarlo.
            bloques = aplicarEvento(bloques, e)
          }
          // Un solo repintado por chunk y no uno por evento: con deltas de
          // texto llegando de a decenas, actualizar en cada uno hace parpadear
          // la lista sin que se vea más fluido.
          setVivo({ thinking, bloques })
        }

        setThread(hilo)
        // El turno queda como se vio: los pasos y el texto en su orden, no un
        // párrafo suelto que borra de dónde salió cada dato.
        if (final.trim() || bloques.length > 0) {
          setMensajes((m) => [
            ...m,
            { id: `a-${m.length}`, role: 'assistant', text: final, bloques },
          ])
        }
        // La lista autoritativa de acciones sale del servidor: el stream sólo
        // avisa que quedó algo propuesto, no con qué argumentos exactos.
        if (hilo) {
          const r = await fetch(`/api/operacion/operator?thread=${hilo}`, {
            cache: 'no-store',
          })
          if (r.ok) {
            const json = (await r.json()) as { acciones?: Accion[]; hilos?: ResumenHilo[] }
            setAcciones(json.acciones ?? [])
            // La misma respuesta trae la lista: así una conversación recién
            // empezada aparece en el historial sin pedir nada más.
            setHilos(json.hilos ?? [])
          }
        }
      } catch {
        setError(t('operation.operatorError'))
      } finally {
        setVivo(null)
        setPensando(false)
      }
    },
    [aLaMesa, fetchWithCsrf, pensando, t, thread],
  )

  /**
   * Cambia el paso del hilo cuando su acción se decide.
   *
   * El hilo cuenta lo que pasó, y "pasó" incluye lo que decidiste después. Sin
   * esto, el paso se queda diciendo "esto haría" para siempre mientras abajo
   * aparece la misma cosa marcada como hecha: dos versiones del mismo hecho, y
   * la de arriba es la vieja.
   */
  const marcarPasoDecidido = useCallback((actionId: string, aprobado: boolean) => {
    setMensajes((ms) =>
      ms.map((m) =>
        m.bloques?.some((b) => b.k === 'paso' && b.actionId === actionId)
          ? {
              ...m,
              bloques: m.bloques.map((b) =>
                b.k === 'paso' && b.actionId === actionId
                  ? { ...b, estado: aprobado ? ('hecho' as const) : ('error' as const) }
                  : b,
              ),
            }
          : m,
      ),
    )
  }, [])

  /**
   * Traer al panel cómo quedó lo que se construyó.
   *
   * Se pide al servidor y no se reusa el artefacto del bloque a propósito: el
   * del bloque es lo que se PROPUSO, calculado desde los argumentos del modelo.
   * Entre proponer y guardar los nombres se convierten en ids y algún paso
   * puede no haber entrado — y ahí estaba escondida una automatización que en
   * el chat se veía bien y no podía funcionar.
   */
  const verComoQuedo = useCallback(
    async (actionId: string, key: string) => {
      try {
        const res = await fetch(`/api/operacion/operator/acciones/${actionId}/artefacto`, {
          cache: 'no-store',
        })
        if (!res.ok) return
        const json = (await res.json()) as {
          artefacto: Artefacto
          real: boolean
          entidadId: string | null
        }
        aLaMesa({
          tipo: 'fijar',
          fijado: {
            artefacto: json.artefacto,
            real: json.real,
            entidadId: json.entidadId,
            capabilityKey: key,
          },
        })
      } catch {
        /* si no se puede traer, no pasa nada: el paso sigue con su dibujo */
      }
    },
    [aLaMesa],
  )

  const decidir = useCallback(
    async (id: string, aprobar: boolean) => {
      setAcciones((a) =>
        a.map((x) =>
          x.id === id ? { ...x, status: aprobar ? 'ejecutado' : 'rechazado' } : x,
        ),
      )
      marcarPasoDecidido(id, aprobar)
      try {
        const res = await fetchWithCsrf(`/api/operacion/operator/acciones/${id}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ aprobar }),
        })
        const json = (await res.json()) as { ok: boolean; status: string; message: string }
        setAcciones((a) =>
          a.map((x) =>
            x.id === id
              ? { ...x, status: (json.ok ? json.status : 'fallido') as Accion['status'] }
              : x,
          ),
        )
        if (!json.ok) marcarPasoDecidido(id, false)
        if (json.ok && aprobar) onChanged?.()
      } catch {
        setAcciones((a) =>
          a.map((x) => (x.id === id ? { ...x, status: 'fallido' } : x)),
        )
        marcarPasoDecidido(id, false)
      }
    },
    [fetchWithCsrf, marcarPasoDecidido, onChanged],
  )

  /**
   * Aprobar el reparto y dejar trabajar al equipo.
   *
   * Lo que corre son los pasos GUARDADOS: la ruta no le vuelve a preguntar al
   * modelo qué había que hacer, porque podría repartir distinto de lo que se
   * acaba de aprobar.
   */
  const correrPlan = useCallback(
    async (planId: string) => {
      setPlan((p) => (p ? { ...p, estado: 'corriendo' } : p))
      setPensando(true)
      setVivo({ thinking: '', bloques: [] })
      try {
        const res = await fetchWithCsrf(
          `/api/operacion/operator/planes/${planId}/correr`,
          { method: 'POST' },
        )
        if (!res.ok || !res.body) throw new Error('failed')

        const reader = res.body.getReader()
        const dec = new TextDecoder()
        let buffer = ''
        let final = ''
        let bloques: Bloque[] = []

        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          buffer += dec.decode(value, { stream: true })
          const { events, rest } = drainEvents(buffer)
          buffer = rest
          for (const e of events) {
            aLaMesa({ tipo: 'evento', e })
            if (e.t === 'text') final += e.delta
            if (e.t === 'error') setError(e.message)
            // Al correr un plan no hay `tool_start` antes de cada paso: el
            // reductor lo abre con la etiqueta que trae el evento, en vez de
            // imprimir la clave cruda de la capacidad.
            bloques = aplicarEventoDePlan(bloques, e)
          }
          setVivo({ thinking: '', bloques })
        }

        if (final.trim() || bloques.length > 0) {
          setMensajes((m) => [
            ...m,
            { id: `a-${m.length}`, role: 'assistant', text: final, bloques },
          ])
        }
        setPlan((p) => (p ? { ...p, estado: 'listo' } : p))

        // Las acciones que quedaron esperando salen del servidor: el stream
        // avisa que hay algo propuesto, no con qué argumentos exactos.
        const hilo = thread
        if (hilo) {
          const r = await fetch(`/api/operacion/operator?thread=${hilo}`, {
            cache: 'no-store',
          })
          if (r.ok) setAcciones(((await r.json()).acciones ?? []) as Accion[])
        }
      } catch {
        setError(t('operation.operatorError'))
        setPlan((p) => (p ? { ...p, estado: 'esperando' } : p))
      } finally {
        setVivo(null)
        setPensando(false)
      }
    },
    [aLaMesa, fetchWithCsrf, t, thread],
  )

  /**
   * Todo lo que se vio pasar en el hilo, por su id de acción.
   *
   * Lo que está arriba, en el paso donde ocurrió, no se repite abajo: mostrar
   * dos veces la misma cosa —y la segunda truncada— era lo que hacía parecer
   * que el texto aparecía y se borraba. Ahora los bloques se guardan con el
   * mensaje, así que esto sigue valiendo después de recargar; antes se vaciaba
   * y TODAS las acciones del historial caían amontonadas al final.
   */
  const porAccion = new Map(acciones.map((a) => [a.id, a]))
  const enElHilo = new Set(
    [...mensajes.map((m) => m.bloques ?? []), vivo?.bloques ?? []].flatMap((bs) =>
      bs.flatMap((b) => (b.k === 'paso' && b.actionId ? [b.actionId] : [])),
    ),
  )
  // Las de una conversación vieja sin bloques, que no tienen dónde ir arriba.
  const sueltas = acciones.filter((a) => !enElHilo.has(a.id))
  const pendientes = sueltas.filter((a) => a.status === 'propuesto')
  const resueltas = sueltas.filter((a) => a.status !== 'propuesto')

  return (
    <div
      className={cn(
        // `relative` para que el botón del historial se cuelgue de la esquina
        // sin salirse de la columna del chat.
        'relative flex h-full flex-col',
        !fullscreen && 'min-h-[26rem] rounded-xl border border-border bg-card',
      )}
    >
      {!fullscreen && (
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          <Sparkles className="size-4 text-accent-ink" />
          <h2 className="text-sm font-semibold text-foreground">
            {t('operation.operatorTitle')}
          </h2>
        </div>
      )}

      {fullscreen && (
        <BotonHilos
          hilos={hilos}
          activo={thread}
          cargando={cargandoHilo}
          onAbrir={abrirHilo}
          onNuevo={nuevoChat}
          onBorrar={borrarChat}
        />
      )}

      <div className={cn('flex-1 overflow-y-auto', !fullscreen && 'p-4')}>
        <div
          className={cn(
            'flex flex-col gap-3',
            // La conversación se apoya abajo, contra el compositor, en vez de
            // colgar del techo con media pantalla vacía debajo. Con el hilo
            // largo el scroll se comporta igual; con el hilo corto deja de
            // parecer una pantalla a medio cargar.
            // Sin `max-w-3xl` centrado: el pedido YA es una columna angosta,
            // y centrarlo adentro dejaba dos márgenes muertos a los costados.
            fullscreen &&
              'min-h-full w-full px-5 py-6 ' +
                (mensajes.length === 0 ? 'justify-center' : 'justify-end'),
          )}
        >
        {mensajes.length === 0 && (
          <div className={cn('space-y-4', fullscreen && 'pb-8 text-center')}>
            <p
              className={cn(
                'text-muted-foreground',
                fullscreen ? 'text-lg text-foreground' : 'text-sm',
              )}
            >
              {t('operation.operatorHint')}
            </p>
            <div className={cn('flex flex-wrap gap-2', fullscreen && 'justify-center')}>
              {['operatorTry1', 'operatorTry2', 'operatorTry3'].map((k) => (
                <button
                  key={k}
                  onClick={() => void enviar(t(`operation.${k}`))}
                  className="rounded-full border border-border px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  {t(`operation.${k}`)}
                </button>
              ))}
            </div>
          </div>
        )}

        {mensajes.map((m) =>
          m.bloques?.length ? (
            <Turno
              key={m.id}
              bloques={m.bloques}
              acciones={porAccion}
              onDecidir={decidir}
              onVer={verComoQuedo}
            />
          ) : (
            <Dicho key={m.id} role={m.role} text={m.text} />
          ),
        )}

        {vivo && (
          <Turno
            bloques={vivo.bloques}
            thinking={vivo.thinking}
            acciones={porAccion}
            onDecidir={decidir}
            onVer={verComoQuedo}
          />
        )}

        {pensando && !vivo?.bloques.length && !vivo?.thinking && <Armando />}

        {plan && plan.estado !== 'rechazado' && (
          <TarjetaPlan
            plan={plan}
            onAprobar={() => correrPlan(plan.planId)}
            onRechazar={() => setPlan({ ...plan, estado: 'rechazado' })}
          />
        )}

        {pendientes.length > 0 && (
          <div className="space-y-2 pt-1">
            <p className="text-xs font-medium text-muted-foreground">
              {t('operation.proposedTitle')}
            </p>
            {pendientes.map((a) => (
              <TarjetaAccion key={a.id} accion={a} onDecidir={decidir} />
            ))}
          </div>
        )}

        {resueltas.map((a) => (
          <TarjetaResuelta key={a.id} accion={a} />
        ))}

        {error && (
          <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
        )}
          <div ref={finalRef} />
        </div>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault()
          void enviar(texto)
        }}
        className={cn(
          'shrink-0',
          fullscreen ? 'w-full px-5 pb-5' : 'flex items-center gap-2 border-t border-border p-3',
        )}
      >
        <div
          className={cn(
            'flex items-center gap-2',
            // A pantalla completa el compositor es una pieza flotante y no una
            // franja pegada al borde: es lo que hace que el chat se sienta la
            // pantalla y no el pie de otra cosa.
            fullscreen && 'app-glass rounded-2xl px-4 py-3',
          )}
        >
          <input
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            placeholder={t('operation.operatorPlaceholder')}
            className="min-w-0 flex-1 bg-transparent px-1 text-sm text-foreground outline-none placeholder:text-muted-foreground"
          />
          <button
            type="submit"
            disabled={pensando || !texto.trim()}
            aria-label={t('operation.operatorSend')}
            className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground transition-opacity disabled:opacity-40"
          >
            <ArrowUp className="size-4" />
          </button>
        </div>

        {/* Debajo del compositor y no en una pantalla de ajustes: es una
            decisión sobre lo que va a pasar en el próximo mensaje, así que se
            toma mirando el mensaje. */}
      </form>
    </div>
  )
}

/**
 * Las conversaciones anteriores, detrás de un botón.
 *
 * Antes era una tira horizontal arriba del hilo, y estaba mal por una razón
 * simple: ocupaba una franja de la pantalla todo el tiempo para algo que se usa
 * de vez en cuando, y con cinco conversaciones ya obligaba a desplazarse de
 * costado. Un botón en la esquina no le saca lugar a la conversación, que es lo
 * que se mira.
 *
 * Cada hilo es su propio contexto: lo que se habló en uno no entra en el otro.
 */
function BotonHilos({
  hilos,
  activo,
  cargando,
  onAbrir,
  onNuevo,
  onBorrar,
}: {
  hilos: ResumenHilo[]
  activo: string | null
  cargando: boolean
  onAbrir: (id: string) => void
  onNuevo: () => void
  onBorrar: (id: string) => void
}) {
  const t = useT()
  const fmt = useFormat()
  const [abierto, setAbierto] = useState(false)
  const pendientes = hilos.reduce((n, h) => n + (h.pendientes > 0 ? 1 : 0), 0)

  return (
    <div className="absolute top-3 right-4 z-20">
      <button
        type="button"
        onClick={() => setAbierto((v) => !v)}
        className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-xs text-muted-foreground shadow-sm transition-colors hover:text-foreground"
      >
        <History className="size-3.5" />
        {t('operation.chatHistorial')}
        {/* Un punto y no un número: cuántas decisiones esperan se cuenta
            adentro; acá sólo hace falta saber que hay algo. */}
        {pendientes > 0 && (
          <span className="size-1.5 rounded-full bg-accent-ink" aria-hidden />
        )}
      </button>

      {abierto && (
        <>
          {/* El fondo cierra al tocar afuera, que es lo que espera cualquiera. */}
          <button
            type="button"
            className="fixed inset-0 z-10 cursor-default"
            onClick={() => setAbierto(false)}
            aria-label={t('operation.mesaCerrar')}
          />
          <div className="absolute right-0 z-20 mt-2 w-72 overflow-hidden rounded-xl border border-border bg-card shadow-lg">
            <button
              type="button"
              onClick={() => {
                onNuevo()
                setAbierto(false)
              }}
              className="flex w-full items-center gap-2 border-b border-border px-3 py-2.5 text-left text-xs text-foreground transition-colors hover:bg-muted/50"
            >
              <MessageSquarePlus className="size-3.5 text-accent-ink" />
              {t('operation.chatNuevo')}
            </button>

            {hilos.length === 0 ? (
              <p className="px-3 py-3 text-[11px] text-muted-foreground">
                {t('operation.chatSinHistorial')}
              </p>
            ) : (
              <ul className="max-h-80 overflow-y-auto">
                {hilos.map((h) => (
                  <li
                    key={h.id}
                    className={cn(
                      'group flex items-center gap-1 px-1.5 transition-colors hover:bg-muted/50',
                      h.id === activo && 'bg-primary/10',
                    )}
                  >
                    <button
                      type="button"
                      disabled={cargando}
                      onClick={() => {
                        onAbrir(h.id)
                        setAbierto(false)
                      }}
                      className="min-w-0 flex-1 px-1.5 py-2 text-left"
                    >
                      <span
                        className={cn(
                          'block truncate text-xs',
                          h.id === activo ? 'text-accent-ink' : 'text-foreground',
                        )}
                      >
                        {h.titulo}
                      </span>
                      <span className="block text-[10px] text-muted-foreground">
                        {fmt.dateTime(h.actualizado, {
                          day: '2-digit',
                          month: 'short',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                        {h.pendientes > 0 && ` · ${t('operation.chatEsperando')}`}
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => onBorrar(h.id)}
                      aria-label={t('operation.chatBorrar')}
                      title={t('operation.chatBorrar')}
                      className="rounded-lg p-1.5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:text-foreground"
                    >
                      <Trash2 className="size-3" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  )
}

/**
 * El reparto, con su botón.
 *
 * Se aprueba UNA vez y de ahí el equipo trabaja. Antes cada escritura pedía su
 * click, y con equipo eso se volvía absurdo: pedir "armá recuperación de
 * carritos" y tener que aprobar tres tarjetas seguidas es peor que la versión
 * anterior, no mejor.
 *
 * Aprobar acá NO aprueba todo lo que el equipo pueda hacer: lo que le llega a
 * una persona, sale a Meta o mueve dinero sigue dejando su propia tarjeta con
 * su propio botón, adentro del plan aprobado y fuera de él.
 */
function TarjetaPlan({
  plan,
  onAprobar,
  onRechazar,
}: {
  plan: PlanPendiente
  onAprobar: () => void
  onRechazar: () => void
}) {
  const t = useT()
  const corriendo = plan.estado === 'corriendo'
  const listo = plan.estado === 'listo'

  return (
    <div className="rounded-xl border border-accent-ink/30 bg-primary/5 p-3.5">
      <div className="flex items-center gap-2">
        <Sparkles className="size-4 shrink-0 text-accent-ink" />
        <p className="text-sm font-medium text-foreground">{t('operation.planTitulo')}</p>
      </div>
      {/* El porqué no se imprime: los pasos numerados y el "espera al 1" ya lo
          dicen, y una frase más arriba de una lista que se explica sola es
          justo el texto que sobra. */}

      <ol className="mt-3 space-y-1.5">
        {plan.pasos.map((p) => (
          <li key={p.i} className="flex items-start gap-2 text-xs">
            <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full bg-primary/20 text-[9px] font-semibold text-accent-ink">
              {p.i + 1}
            </span>
            <span className="min-w-0 flex-1 leading-snug">
              <span className="font-medium text-foreground">{p.agente}</span>{" "}
              {/* La primera frase, y cortada a dos líneas. El encargo completo
                  es la instrucción que recibe el especialista —lleva el detalle
                  que necesita para no adivinar— y no algo para leer entero acá:
                  dos párrafos por paso convertían la tarjeta en un muro. */}
              <span className="line-clamp-2 text-muted-foreground">{primeraFrase(p.encargo)}</span>
              {p.dependeDe.length > 0 && (
                <span className="text-muted-foreground/70">
                  {" "}
                  ({t('operation.mesaEspera', { n: p.dependeDe.map((d) => d + 1).join(', ') })})
                </span>
              )}
            </span>
          </li>
        ))}
      </ol>

      {/* Decirlo acá y no en un pie de página: es lo que hace que aprobar de
          una sola vez no sea aprobar a ciegas. */}
      <p className="mt-3 text-[11px] leading-snug text-muted-foreground">
        {t('operation.planAviso')}
      </p>

      {!listo && (
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            onClick={onAprobar}
            disabled={corriendo}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-60"
          >
            {corriendo && <Loader2 className="size-3.5 animate-spin" />}
            {corriendo ? t('operation.planCorriendo') : t('operation.planAprobar')}
          </button>
          <button
            type="button"
            onClick={onRechazar}
            disabled={corriendo}
            className="rounded-lg px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground disabled:opacity-60"
          >
            {t('operation.reject')}
          </button>
        </div>
      )}
    </div>
  )
}

/**
 * El turno mientras pasa: qué está pensando, qué va tocando y qué va diciendo.
 *
 * El razonamiento va arriba y apagado —en gris, más chico— porque es contexto y
 * no la respuesta. Los pasos van en el medio, cada uno con su estado, y así se
 * ve que está trabajando y en qué. El texto aparece abajo, en la misma burbuja
 * en la que va a quedar cuando termine, para que no salte de lugar al cerrar.
 */
/**
 * Mientras piensa qué hacer.
 *
 * Un spinner girando es el mismo que usa cualquier cosa que carga en esta app,
 * así que no distingue "estoy trayendo datos" de "estoy armando algo". Estos
 * tres segmentos se encienden en fila, como algo que se ensambla, y el brillo
 * recorre la superficie: dice que hay trabajo en curso, no que hay una espera.
 */
function Armando() {
  const t = useT()
  return (
    <div className="app-glass app-brillo rounded-xl px-3 py-2.5">
      <p className="app-eyebrow flex items-center gap-2 text-accent-ink">
        {t('operation.operatorThinking')}
      </p>
      <div className="app-armando mt-2 flex items-center gap-1" aria-hidden>
        <span className="h-1 w-10 rounded-full bg-accent-ink" />
        <span className="h-1 w-6 rounded-full bg-accent-ink" />
        <span className="h-1 w-14 rounded-full bg-accent-ink" />
      </div>
    </div>
  )
}

/**
 * Lo que se dijo, sin burbujas.
 *
 * Lo que pediste va con el resaltador de la marca —un marcador sobre el texto,
 * no una cápsula— y lo que contesta el equipo va como prosa. Las burbujas
 * enfrentadas son de una app de mensajería; esto es una transcripción, y leerla
 * como tal es lo que la separa de cualquier chat de IA.
 */
function Dicho({ role, text }: { role: 'user' | 'assistant'; text: string }) {
  if (!text.trim()) return null
  if (role === 'user') {
    return (
      <p className="text-[15px] leading-relaxed font-medium">
        <span className="app-resaltado">{text}</span>
      </p>
    )
  }
  return (
    <div className="text-sm leading-relaxed text-foreground">
      <TextoRico text={text} />
    </div>
  )
}

/**
 * Cómo se lee un paso YA HECHO.
 *
 * El gerundio cuenta lo que está pasando; sobre algo terminado hay que usar el
 * pasado, o la pantalla dice una cosa y la base dice otra.
 */
const PASO_HECHO: Record<string, string> = {
  'automatizaciones.crear': 'operation.hechoAutoCrear',
  'automatizaciones.crear_desde_receta': 'operation.hechoAutoCrear',
  'automatizaciones.editar': 'operation.hechoAutoEditar',
  'automatizaciones.activar': 'operation.hechoAutoActivar',
  'plantillas.crear_borrador': 'operation.hechoPlantilla',
  'segmentos.crear': 'operation.hechoSegmento',
  'agentes.crear_borrador': 'operation.hechoAgente',
}

function Turno({
  bloques,
  thinking,
  acciones,
  onDecidir,
  onVer,
}: {
  bloques: Bloque[]
  thinking?: string
  /** Las acciones por id, para dibujar la que espera donde ocurrió. */
  acciones?: Map<string, Accion>
  onDecidir?: (id: string, aprobar: boolean) => void
  onVer?: (actionId: string, key: string) => void
}) {
  const t = useT()
  // Las que esperan decisión, en el orden en que ocurrieron.
  const esperando = onDecidir
    ? bloques.flatMap((b) => {
        if (b.k !== 'paso' || !b.actionId) return []
        const a = acciones?.get(b.actionId)
        return a?.status === 'propuesto' ? [a] : []
      })
    : []

  return (
    <div className="space-y-3">
      {thinking ? (
        <p className="line-clamp-3 border-l border-dashed border-border pl-3 text-[11px] leading-snug text-muted-foreground">
          {thinking}
        </p>
      ) : null}

      {agrupar(bloques).map(({ b, veces }) => {
        if (b.k === 'texto') {
          return <Dicho key={b.id} role="assistant" text={b.texto} />
        }

        const hecho = b.estado === 'hecho'
        const claveHecho = hecho ? PASO_HECHO[b.key] : undefined
        const etiqueta = claveHecho
          ? t(claveHecho)
          : PASO_LABEL[b.key]
            ? t(PASO_LABEL[b.key])
            : b.label

        // Una lectura es una anotación al margen: línea fina, letra chica. Lo
        // que dejó algo en la cuenta sube de rango y se dibuja como una ficha.
        if (!hecho && b.estado !== 'propuesto') {
          return (
            <p
              key={b.id}
              className="flex items-center gap-2 border-l border-border pl-3 text-[10px] font-semibold tracking-[0.14em] text-muted-foreground uppercase"
            >
              {b.estado === 'corriendo' ? (
                <Loader2 className="size-3 shrink-0 animate-spin" />
              ) : b.estado === 'error' ? (
                <X className="size-3 shrink-0 text-red-600 dark:text-red-400" />
              ) : (
                <Check className="size-3 shrink-0 text-accent-ink" />
              )}
              <span className="min-w-0 flex-1 truncate">{etiqueta}</span>
              {veces > 1 && <span className="shrink-0 tabular-nums opacity-60">×{veces}</span>}
              {b.estado === 'error' && b.detalle && (
                <span className="min-w-0 flex-1 truncate normal-case tracking-normal text-red-600 dark:text-red-400">
                  {b.detalle}
                </span>
              )}
            </p>
          )
        }

        return (
          <div
            key={b.id}
            className={cn(
              'rounded-xl p-3',
                // Lo hecho ya está en la cuenta; lo propuesto todavía no. Se
                // ven distinto sin leer una palabra.
              hecho
                ? 'app-glass'
                : 'border border-dashed border-accent-ink/40 bg-primary/5',
            )}
          >
            <p className="flex items-center gap-2 text-[10px] font-semibold tracking-[0.14em] uppercase">
              {hecho ? (
                <PlusCircle className="size-3 shrink-0 text-accent-ink" />
              ) : (
                <Sparkles className="size-3 shrink-0 text-accent-ink" />
              )}
              <span className="text-accent-ink">{etiqueta}</span>
            </p>
            {b.detalle && (
              <p className="mt-1.5 text-xs leading-snug text-foreground">
                {hecho ? sinCondicional(b.detalle) : b.detalle}
              </p>
            )}
            {b.artefacto && b.actionId && onVer && (
              <button
                type="button"
                onClick={() => onVer(b.actionId!, b.key)}
                className="app-card-cta mt-2 text-[10px] text-accent-ink transition-opacity hover:opacity-70"
              >
                <Eye className="size-3" />
                {hecho ? t('operation.mesaVerComoQuedo') : t('operation.mesaVerElDetalle')}
              </button>
            )}
            {/* Sin acción a la que pedirle el dibujo, el de acá es lo único
                que hay. Pasa dentro de un plan que todavía no se aprobó. */}
            {b.artefacto && !b.actionId && (
              <div className="mt-2">
                <VistaArtefacto artefacto={b.artefacto} />
              </div>
            )}
          </div>
        )
      })}

      {/* Lo que espera tu decisión va SIEMPRE al final del turno, después de
          todo lo que el equipo dijo. Antes se dibujaba pegado al paso que la
          originó, y con dos o tres frases debajo el botón quedaba en el medio
          de la conversación: había que buscar dónde decidir. */}
      {esperando.map((a) => (
        <TarjetaAccion key={a.id} accion={a} onDecidir={onDecidir!} />
      ))}
    </div>
  )
}

function TarjetaAccion({
  accion,
  onDecidir,
}: {
  accion: Accion
  onDecidir: (id: string, aprobar: boolean) => void
}) {
  const t = useT()
  const irreversible = accion.risk === 'irreversible'
  return (
    <div
      className={cn(
        'rounded-xl border p-3',
        irreversible ? 'border-amber-500/40 bg-amber-500/5' : 'border-border',
      )}
    >
      <div className="flex items-center gap-1.5">
        {irreversible && (
          <AlertTriangle className="size-3.5 text-amber-600 dark:text-amber-400" />
        )}
        <span className="text-xs font-medium text-muted-foreground">
          {t(irreversible ? 'operation.riskIrreversible' : 'operation.riskReversible')}
        </span>
      </div>
      <p className="mt-1 text-sm text-foreground">
        {accion.preview ?? describir(accion)}
      </p>
      <div className="mt-3 flex gap-2">
        <button
          onClick={() => onDecidir(accion.id, true)}
          className="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground"
        >
          {t('operation.approve')}
        </button>
        <button
          onClick={() => onDecidir(accion.id, false)}
          className="rounded-lg px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted"
        >
          {t('operation.reject')}
        </button>
      </div>
    </div>
  )
}

function TarjetaResuelta({ accion }: { accion: Accion }) {
  const t = useT()
  const label =
    accion.status === 'ejecutado'
      ? t('operation.statusExecuted')
      : accion.status === 'rechazado'
        ? t('operation.statusRejected')
        : t('operation.statusFailed')
  const Icon = accion.status === 'ejecutado' ? Check : X
  return (
    <div className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-xs text-muted-foreground">
      <Icon className="size-3.5 shrink-0" />
      <span className="min-w-0 flex-1 truncate">
        {accion.preview ?? describir(accion)}
      </span>
      <span className="shrink-0">{label}</span>
    </div>
  )
}

/** Cuando la capacidad no trajo vista previa: la clave y sus argumentos. */
function describir(a: Accion): string {
  const args = Object.entries(a.args)
    .map(([k, v]) => `${k}: ${String(v)}`)
    .join(', ')
  return args ? `${a.capability_key} — ${args}` : a.capability_key
}
