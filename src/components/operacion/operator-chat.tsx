'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertTriangle, ArrowUp, Check, Loader2, Sparkles, X } from 'lucide-react'
import { useT } from '@/hooks/use-locale'
import { useFetchWithCsrf } from '@/lib/api/fetch-with-csrf'
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
}

interface Accion {
  id: string
  capability_key: string
  args: Record<string, unknown>
  risk: 'lectura' | 'reversible' | 'irreversible'
  status: 'propuesto' | 'ejecutado' | 'rechazado' | 'fallido'
  preview: string | null
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
  const [error, setError] = useState<string | null>(null)
  const finalRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    finalRef.current?.scrollIntoView({ block: 'end' })
  }, [mensajes, pensando])

  const enviar = useCallback(
    async (valor: string) => {
      const limpio = valor.trim()
      if (!limpio || pensando) return
      setError(null)
      setTexto('')
      setMensajes((m) => [...m, { id: `local-${m.length}`, role: 'user', text: limpio }])
      setPensando(true)
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
        if (!res.ok) throw new Error('failed')
        const json = (await res.json()) as {
          thread: string
          texto: string
          acciones: Accion[]
        }
        setThread(json.thread)
        setAcciones(json.acciones ?? [])
        setMensajes((m) => [
          ...m,
          { id: `a-${m.length}`, role: 'assistant', text: json.texto },
        ])
      } catch {
        setError(t('operation.operatorError'))
      } finally {
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

        {mensajes.map((m) => (
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
        ))}

        {pensando && (
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
