'use client'

import { useCallback, useEffect, useState } from 'react'
import { Check, Loader2, Sparkles, Undo2, X } from 'lucide-react'
import { toast } from 'sonner'
import { useT } from '@/hooks/use-locale'
import { useFetchWithCsrf } from '@/lib/api/fetch-with-csrf'
import { useFormat } from '@/hooks/use-format'
import { nombreDeSubagente } from '@/lib/operator/fleet/types'
import type { Actividad } from '@/lib/operator/actividad'
import { cn } from '@/lib/utils'

/**
 * Lo que hizo el Operador.
 *
 * Todo esto ya se guardaba y no se leía en ningún lado. Lo que el Operador hizo
 * la semana pasada sólo se podía reconstruir abriendo las conversaciones una
 * por una y acordándose de cuál era; y el desglose de gasto por especialista
 * —la tabla que existe para contestar cuánto cuesta el producto— no lo miraba
 * nadie desde que se escribió.
 *
 * Dos preguntas, una pantalla: qué se hizo en la cuenta, y cuánto salió.
 */

const RANGOS = [7, 30, 90]

export default function ActividadOperadorPage() {
  const t = useT()
  const fmt = useFormat()
  const fetchWithCsrf = useFetchWithCsrf()
  const [dias, setDias] = useState(30)
  const [deshaciendo, setDeshaciendo] = useState<string | null>(null)
  const [datos, setDatos] = useState<Actividad | null>(null)
  const [cargando, setCargando] = useState(true)

  const cargar = useCallback(async (d: number) => {
    setCargando(true)
    try {
      const res = await fetch(`/api/operacion/actividad?dias=${d}`, { cache: 'no-store' })
      setDatos(res.ok ? ((await res.json()) as Actividad) : null)
    } catch {
      setDatos(null)
    } finally {
      setCargando(false)
    }
  }, [])

  useEffect(() => {
    void cargar(dias)
  }, [cargar, dias])

  /**
   * Volver atrás una acción.
   *
   * Lo hace la capacidad, no la pantalla: cada una sabe cómo se deshace lo
   * suyo. Al terminar se recarga en vez de parchear la fila a mano, porque
   * deshacer una creación cambia también los números de arriba.
   */
  const deshacer = useCallback(
    async (id: string) => {
      setDeshaciendo(id)
      try {
        const res = await fetchWithCsrf(
          `/api/operacion/operator/acciones/${id}/deshacer`,
          { method: 'POST' },
        )
        const json = (await res.json()) as { ok?: boolean; que?: string; error?: string }
        if (json.ok) {
          toast.success(json.que ?? t('operation.actividadDeshecho'))
          await cargar(dias)
        } else {
          toast.error(json.error ?? t('operation.operatorError'))
        }
      } catch {
        toast.error(t('operation.operatorError'))
      } finally {
        setDeshaciendo(null)
      }
    },
    [cargar, dias, fetchWithCsrf, t],
  )

  const tope = Math.max(1, ...(datos?.gasto ?? []).map((g) => g.usd))

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 p-4 sm:p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="app-page-title text-[26px]">{t('operation.actividadTitulo')}</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {t('operation.actividadBajada')}
          </p>
        </div>
        <div className="flex gap-1">
          {RANGOS.map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setDias(d)}
              className={cn(
                'rounded-full border px-3 py-1 text-xs transition-colors',
                d === dias
                  ? 'border-primary/60 bg-primary/15 text-accent-ink'
                  : 'border-border text-muted-foreground hover:text-foreground',
              )}
            >
              {t('operation.actividadDias', { n: d })}
            </button>
          ))}
        </div>
      </div>

      {cargando ? (
        <div className="flex justify-center py-16">
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        </div>
      ) : !datos ? (
        <p className="py-16 text-center text-sm text-muted-foreground">
          {t('operation.operatorError')}
        </p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Numero valor={datos.totales.hechas} nombre={t('operation.actividadHechas')} />
            <Numero
              valor={datos.totales.esperando}
              nombre={t('operation.actividadEsperando')}
              destacado={datos.totales.esperando > 0}
            />
            <Numero
              valor={datos.totales.descartadas + datos.totales.fallidas}
              nombre={t('operation.actividadDescartadas')}
            />
            <Numero
              valor={`US$${datos.totales.usd < 0.01 && datos.totales.usd > 0 ? '<0.01' : datos.totales.usd.toFixed(2)}`}
              nombre={t('operation.actividadCosto')}
            />
          </div>

          {datos.gasto.length > 0 && (
            <section className="rounded-xl border border-border p-4">
              <h2 className="app-eyebrow text-muted-foreground">
                {t('operation.actividadPorEspecialista')}
              </h2>
              <ul className="mt-3 space-y-2">
                {datos.gasto.map((g) => (
                  <li key={g.agente} className="flex items-center gap-3 text-xs">
                    <span className="w-28 shrink-0 truncate text-foreground">
                      {g.agente === 'orquestador'
                        ? t('operation.actividadOrquestador')
                        : t(nombreDeSubagente(g.agente as never))}
                    </span>
                    <span className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-muted">
                      <span
                        className="block h-full rounded-full bg-primary"
                        style={{ width: `${Math.max(2, (g.usd / tope) * 100)}%` }}
                      />
                    </span>
                    <span className="w-24 shrink-0 text-right tabular-nums text-muted-foreground">
                      {g.llamadas} · US${g.usd.toFixed(3)}
                    </span>
                  </li>
                ))}
              </ul>
              {/* Con un prefijo estable, la mayor parte de la entrada tiene que
                  leerse del caché. Un porcentaje bajo con muchos turnos quiere
                  decir que algo lo está rompiendo, y sin el número es una
                  suposición. */}
              <p className="mt-3 text-[11px] text-muted-foreground">
                {t('operation.actividadCache', { n: datos.totales.cachePct })}
              </p>
            </section>
          )}

          {datos.acciones.length === 0 ? (
            <p className="rounded-xl border border-dashed border-border py-14 text-center text-sm text-muted-foreground">
              {t('operation.actividadVacio')}
            </p>
          ) : (
            <ul className="divide-y divide-border rounded-xl border border-border">
              {datos.acciones.map((a) => (
                <li key={a.id} className="flex items-start gap-3 p-3">
                  <span className="mt-0.5 shrink-0">
                    {a.estado === 'ejecutado' ? (
                      <Check className="size-3.5 text-accent-ink" />
                    ) : a.estado === 'propuesto' ? (
                      <Sparkles className="size-3.5 text-accent-ink" />
                    ) : a.estado === 'deshecho' ? (
                      <Undo2 className="size-3.5 text-muted-foreground" />
                    ) : (
                      <X className="size-3.5 text-muted-foreground" />
                    )}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p
                      className={cn(
                        'text-sm leading-snug',
                        a.estado === 'ejecutado'
                          ? 'text-foreground'
                          : 'text-muted-foreground',
                        a.estado === 'deshecho' && 'line-through',
                      )}
                    >
                      {a.que ?? a.capabilityKey}
                    </p>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">
                      {fmt.dateTime(a.decididoEn ?? a.cuando, {
                        day: '2-digit',
                        month: 'short',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                      {' · '}
                      {t(`operation.estado_${a.estado}`)}
                    </p>
                  </div>
                  {/* Sólo donde la capacidad sabe volver atrás. Una plantilla ya
                      enviada a Meta o un mensaje entregado no vuelven, y un
                      botón que dijera lo contrario sería mentir. */}
                  {a.sePuedeDeshacer && (
                    <button
                      type="button"
                      disabled={deshaciendo === a.id}
                      onClick={() => void deshacer(a.id)}
                      className="app-card-cta shrink-0 text-[11px] text-muted-foreground transition-colors hover:text-accent-ink disabled:opacity-50"
                    >
                      {deshaciendo === a.id ? (
                        <Loader2 className="size-3 animate-spin" />
                      ) : (
                        <Undo2 className="size-3" />
                      )}
                      {t('operation.actividadDeshacer')}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  )
}

function Numero({
  valor,
  nombre,
  destacado,
}: {
  valor: number | string
  nombre: string
  destacado?: boolean
}) {
  return (
    <div className="rounded-xl border border-border p-3">
      <p
        className={cn(
          'text-2xl font-medium tabular-nums',
          destacado ? 'text-accent-ink' : 'text-foreground',
        )}
      >
        {valor}
      </p>
      <p className="app-eyebrow mt-1 text-muted-foreground">{nombre}</p>
    </div>
  )
}
