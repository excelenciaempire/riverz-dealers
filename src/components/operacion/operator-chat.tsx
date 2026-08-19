'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertTriangle, ArrowUp, Brain, Check, Loader2, Sparkles, X } from 'lucide-react'
import { useT } from '@/hooks/use-locale'
import { useFetchWithCsrf } from '@/lib/api/fetch-with-csrf'
import { drainEvents } from '@/lib/operator/events'
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
 * El turno en el orden en que pasó.
 *
 * Texto y pasos van en UNA lista y no en dos, porque se intercalan: el Operator
 * dice qué va a hacer, lo hace, cuenta lo que encontró, hace otra cosa. Con
 * listas separadas, la frase "voy a mirar cómo viene la cuenta" terminaba
 * debajo de la consulta que anunciaba.
 */
type Bloque =
  | { k: 'texto'; id: string; texto: string }
  | {
      k: 'paso'
      id: string
      key: string
      /** Lo que manda el servidor, por si la capacidad no tiene etiqueta corta. */
      label: string
      estado: 'corriendo' | 'ok' | 'error' | 'propuesto'
      detalle?: string
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
  'campanas.estado': 'operation.stepCampanas',
  'agentes.listar': 'operation.stepAgentes',
  'agentes.crear_borrador': 'operation.stepAgenteCrear',
  'agentes.activar': 'operation.stepAgenteActivar',
  'automatizaciones.listar': 'operation.stepAutosListar',
  'automatizaciones.recetas': 'operation.stepRecetas',
  'automatizaciones.activar': 'operation.stepAutoActivar',
  'automatizaciones.editar_espera': 'operation.stepAutoEspera',
  'automatizaciones.crear_desde_receta': 'operation.stepAutoCrear',
  'aprobaciones.pendientes': 'operation.stepAprobPend',
  'aprobaciones.decidir': 'operation.stepAprobDecidir',
}

/** El turno en curso. */
interface Vivo {
  /** Razonamiento del modelo, cuando lo expone (ver `events.ts`). */
  thinking: string
  bloques: Bloque[]
}

/** Suma un delta de texto al último bloque, o abre uno nuevo si venía un paso. */
function conTexto(bloques: Bloque[], delta: string): Bloque[] {
  const ultimo = bloques[bloques.length - 1]
  if (ultimo?.k === 'texto') {
    return [...bloques.slice(0, -1), { ...ultimo, texto: ultimo.texto + delta }]
  }
  return [...bloques, { k: 'texto', id: `t${bloques.length}`, texto: delta }]
}

/** Cambia el estado de un paso ya abierto, dejándolo donde está. */
function conPaso(
  bloques: Bloque[],
  id: string,
  patch: Partial<Extract<Bloque, { k: 'paso' }>>,
): Bloque[] {
  return bloques.map((b) => (b.k === 'paso' && b.id === id ? { ...b, ...patch } : b))
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
  const [thread, setThread] = useState<string | null>(null)
  const [mensajes, setMensajes] = useState<Mensaje[]>([])
  const [acciones, setAcciones] = useState<Accion[]>([])
  const [texto, setTexto] = useState('')
  const [pensando, setPensando] = useState(false)
  const [vivo, setVivo] = useState<Vivo | null>(null)
  const [error, setError] = useState<string | null>(null)
  const finalRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    finalRef.current?.scrollIntoView({ block: 'end' })
  }, [mensajes, pensando, vivo?.bloques])

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
            if (e.t === 'text') {
              final += e.delta
              bloques = conTexto(bloques, e.delta)
            } else if (e.t === 'thinking') {
              thinking += e.delta
            } else if (e.t === 'tool_start') {
              bloques = [
                ...bloques,
                { k: 'paso', id: e.id, key: e.key, label: e.label, estado: 'corriendo' },
              ]
            } else if (e.t === 'tool_done') {
              bloques = conPaso(bloques, e.id, {
                estado: e.ok ? 'ok' : 'error',
                detalle: e.ok ? undefined : e.resumen,
              })
            } else if (e.t === 'proposed') {
              bloques = conPaso(bloques, e.id, { estado: 'propuesto', detalle: e.preview })
            } else if (e.t === 'error') {
              setError(e.message)
            } else if (e.t === 'done') {
              hilo = e.thread
            }
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
          if (r.ok) setAcciones(((await r.json()).acciones ?? []) as Accion[])
        }
      } catch {
        setError(t('operation.operatorError'))
      } finally {
        setVivo(null)
        setPensando(false)
      }
    },
    [fetchWithCsrf, pensando, t, thread],
  )

  const decidir = useCallback(
    async (id: string, aprobar: boolean) => {
      setAcciones((a) =>
        a.map((x) =>
          x.id === id ? { ...x, status: aprobar ? 'ejecutado' : 'rechazado' } : x,
        ),
      )
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
        if (json.ok && aprobar) onChanged?.()
      } catch {
        setAcciones((a) =>
          a.map((x) => (x.id === id ? { ...x, status: 'fallido' } : x)),
        )
      }
    },
    [fetchWithCsrf, onChanged],
  )

  const pendientes = acciones.filter((a) => a.status === 'propuesto')
  const resueltas = acciones.filter((a) => a.status !== 'propuesto')

  return (
    <div
      className={cn(
        'flex h-full flex-col',
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

      <div
        className={cn(
          'flex-1 space-y-3 overflow-y-auto',
          fullscreen ? 'mx-auto w-full max-w-3xl px-4 py-8' : 'p-4',
        )}
      >
        {mensajes.length === 0 && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">{t('operation.operatorHint')}</p>
            <div className="flex flex-wrap gap-2">
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
            <Turno key={m.id} bloques={m.bloques} />
          ) : (
            <div
              key={m.id}
              className={cn(
                'max-w-[90%] rounded-xl px-3 py-2 text-sm whitespace-pre-wrap',
                m.role === 'user'
                  ? 'ml-auto bg-primary text-primary-foreground'
                  : 'bg-muted text-foreground',
              )}
            >
              {m.text}
            </div>
          ),
        )}

        {vivo && <Turno bloques={vivo.bloques} thinking={vivo.thinking} />}

        {pensando && !vivo?.bloques.length && !vivo?.thinking && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" />
            {t('operation.operatorThinking')}
          </div>
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

      <form
        onSubmit={(e) => {
          e.preventDefault()
          void enviar(texto)
        }}
        className={cn(
          'shrink-0',
          fullscreen
            ? 'mx-auto w-full max-w-3xl px-4 pb-6'
            : 'flex items-center gap-2 border-t border-border p-3',
        )}
      >
        <div
          className={cn(
            'flex items-center gap-2',
            // A pantalla completa el compositor es una pieza flotante y no una
            // franja pegada al borde: es lo que hace que el chat se sienta la
            // pantalla y no el pie de otra cosa.
            fullscreen &&
              'rounded-2xl border border-border bg-card px-4 py-3 shadow-sm',
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
      </form>
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
function Turno({ bloques, thinking }: { bloques: Bloque[]; thinking?: string }) {
  const t = useT()
  return (
    <div className="space-y-2">
      {thinking ? (
        <div className="rounded-lg border border-dashed border-border px-3 py-2">
          <div className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
            <Brain className="size-3" />
            {t('operation.operatorReasoning')}
          </div>
          <p className="mt-1 line-clamp-3 text-xs leading-snug text-muted-foreground">
            {thinking}
          </p>
        </div>
      ) : null}

      {bloques.map((b) =>
        b.k === 'texto' ? (
          <div
            key={b.id}
            className="max-w-[90%] rounded-xl bg-muted px-3 py-2 text-sm whitespace-pre-wrap text-foreground"
          >
            {b.texto}
          </div>
        ) : (
          <div key={b.id} className="flex items-start gap-2 pl-1 text-xs">
            <span className="mt-0.5 shrink-0">
              {b.estado === 'corriendo' ? (
                <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
              ) : b.estado === 'error' ? (
                <X className="size-3.5 text-red-600 dark:text-red-400" />
              ) : b.estado === 'propuesto' ? (
                <Sparkles className="size-3.5 text-accent-ink" />
              ) : (
                <Check className="size-3.5 text-accent-ink" />
              )}
            </span>
            <span className="min-w-0 flex-1 text-muted-foreground">
              {PASO_LABEL[b.key] ? t(PASO_LABEL[b.key]) : b.label}
              {b.detalle && <span className="text-foreground"> · {b.detalle}</span>}
            </span>
          </div>
        ),
      )}
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
