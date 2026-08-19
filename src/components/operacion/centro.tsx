'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from '@/components/i18n/locale-link'
import {
  AlertTriangle,
  ArrowRight,
  Bot,
  CheckCircle2,
  MessageSquare,
  Radio,
  ShoppingBag,
  UserPlus,
  Zap,
} from 'lucide-react'
import { useT } from '@/hooks/use-locale'
import { MetricCard } from '@/components/dashboard/metric-card'
import { SkeletonCard } from '@/components/dashboard/skeleton'
import { cn } from '@/lib/utils'

/**
 * El Centro de Operación IA.
 *
 * Orden de lectura deliberado: primero lo que necesita a una persona, después
 * lo que la operación viene haciendo sola, y al final los números. Un panel que
 * arranca con métricas obliga a buscar el problema entre los gráficos.
 *
 * Todo sale de `/api/operacion/overview`, que compone capacidades. Esta
 * pantalla no consulta ninguna tabla: es lo que garantiza que diga lo mismo
 * que le contesta el agente a la misma pregunta.
 */

interface Issue {
  kind: string
  severity: 'critical' | 'warning'
  count: number
  detail?: string | null
  href: string
}

interface Delta {
  actual: number
  anterior: number
}

interface Overview {
  estado: {
    canales: { channel: string; status: string }[]
    automatizaciones: { id: string; name: string; is_active: boolean }[]
    corridas_24h: { total: number; exito: number; parciales: number; fallidas: number }
    esperando_aprobacion: { id: string; title: string; kind: string }[]
    problemas: Issue[]
  }
  metricas: {
    conversaciones: Delta
    contactos_nuevos: Delta
    ia: { respondio: number; se_abstuvo: number; fallo: number }
    pedidos: { cantidad: number; facturado: number; moneda: string | null }
  }
  pendientes: {
    conversation_id: string
    contacto: string
    canal: string
    horas_esperando: number | null
    pidio_humano: string | null
  }[]
  agentes: { id: string; name: string; is_active: boolean }[]
}

export function CentroOperacion({ refreshKey = 0 }: { refreshKey?: number }) {
  const t = useT()
  const [data, setData] = useState<Overview | null>(null)
  const [error, setError] = useState(false)

  const load = useCallback(async () => {
    setError(false)
    try {
      const res = await fetch('/api/operacion/overview', { cache: 'no-store' })
      if (!res.ok) throw new Error('failed')
      setData((await res.json()) as Overview)
    } catch {
      setError(true)
    }
  }, [])

  // `refreshKey` cambia cuando el Operator ejecuta algo: la pantalla tiene que
  // reflejarlo enseguida, porque acabar de prender una automatización y seguir
  // viendo el conteo viejo hace dudar de si la acción se aplicó.
  useEffect(() => {
    void load()
  }, [load, refreshKey])

  if (error) {
    return (
      <div className="rounded-xl border border-border bg-card p-6 text-center">
        <p className="text-sm text-muted-foreground">{t('operation.loadError')}</p>
        <button
          onClick={() => void load()}
          className="mt-3 text-sm font-medium text-foreground underline underline-offset-4"
        >
          {t('operation.retry')}
        </button>
      </div>
    )
  }

  if (!data) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <SkeletonCard key={i} />
        ))}
      </div>
    )
  }

  const { estado, metricas, pendientes, agentes } = data
  const agentesActivos = agentes.filter((a) => a.is_active).length
  const autosActivas = estado.automatizaciones.filter((a) => a.is_active).length
  const canalesConectados = estado.canales.filter((c) => c.status === 'connected').length
  const sinOperacion = agentesActivos === 0 && autosActivas === 0

  return (
    <div className="space-y-8">
      <Atencion
        problemas={estado.problemas}
        aprobaciones={estado.esperando_aprobacion}
        pendientes={pendientes}
      />

      <section>
        <h2 className="text-sm font-semibold text-foreground">{t('operation.running')}</h2>
        {sinOperacion ? (
          <div className="mt-3 rounded-xl border border-dashed border-border p-6 text-center">
            <p className="text-sm font-medium text-foreground">
              {t('operation.nothingRunning')}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              {t('operation.nothingRunningHint')}
            </p>
            {/* La salida del estado vacío es el asistente, no una lista de
                secciones para recorrer a mano. */}
            <Link
              href="/operacion/activar"
              className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
            >
              {t('operation.activateCta')}
              <ArrowRight className="size-4" />
            </Link>
          </div>
        ) : (
          <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <MetricCard
              title={t('operation.agentsActive')}
              value={String(agentesActivos)}
              icon={Bot}
            />
            <MetricCard
              title={t('operation.automationsActive')}
              value={String(autosActivas)}
              icon={Zap}
            />
            <MetricCard
              title={t('operation.channelsConnected')}
              value={String(canalesConectados)}
              icon={Radio}
            />
            <MetricCard
              title={t('operation.runs24h')}
              value={String(estado.corridas_24h.total)}
              icon={CheckCircle2}
              subtitle={t('operation.runsBreakdown', {
                ok: estado.corridas_24h.exito,
                partial: estado.corridas_24h.parciales,
                failed: estado.corridas_24h.fallidas,
              })}
            />
          </div>
        )}
      </section>

      <section>
        <h2 className="text-sm font-semibold text-foreground">{t('operation.results')}</h2>
        <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <MetricCard
            title={t('operation.conversations')}
            value={String(metricas.conversaciones.actual)}
            icon={MessageSquare}
            delta={deltaDe(metricas.conversaciones, t('operation.vsPrevious'))}
          />
          <MetricCard
            title={t('operation.aiAnswered')}
            value={String(metricas.ia.respondio)}
            icon={Bot}
          />
          <MetricCard
            title={t('operation.newContacts')}
            value={String(metricas.contactos_nuevos.actual)}
            icon={UserPlus}
            delta={deltaDe(metricas.contactos_nuevos, t('operation.vsPrevious'))}
          />
          <MetricCard
            title={t('operation.orders')}
            value={String(metricas.pedidos.cantidad)}
            icon={ShoppingBag}
          />
        </div>
      </section>
    </div>
  )
}

/** Signo y texto del delta, ya formateado. */
function deltaDe(d: Delta, sufijo: string) {
  const diff = d.actual - d.anterior
  return { sign: diff, label: `${diff >= 0 ? '+' : ''}${diff} ${sufijo}` }
}

/**
 * Lo primero de la pantalla: lo que no puede seguir solo.
 *
 * Se muestra siempre, incluso vacío — al revés que el aviso del panel viejo.
 * Acá el bloque es el índice de la pantalla, y un hueco que aparece y
 * desaparece hace que el resto salte de lugar cada vez que algo se rompe.
 */
function Atencion({
  problemas,
  aprobaciones,
  pendientes,
}: {
  problemas: Issue[]
  aprobaciones: { id: string; title: string; kind: string }[]
  pendientes: Overview['pendientes']
}) {
  const t = useT()
  const vacio = problemas.length === 0 && aprobaciones.length === 0 && pendientes.length === 0

  return (
    <section>
      <div className="flex items-center gap-2">
        {vacio ? (
          <CheckCircle2 className="size-4 text-accent-ink" />
        ) : (
          <AlertTriangle className="size-4 text-amber-600 dark:text-amber-400" />
        )}
        <h2 className="text-sm font-semibold text-foreground">
          {vacio ? t('operation.allClear') : t('operation.needsYou')}
        </h2>
      </div>

      {vacio ? (
        <p className="mt-2 text-sm text-muted-foreground">{t('operation.allClearHint')}</p>
      ) : (
        <div className="mt-3 space-y-3">
          {problemas.length > 0 && (
            <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border">
              {problemas.map((p) => (
                <li key={`${p.kind}-${p.href}`}>
                  <Link
                    href={p.href}
                    className="group flex items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/50"
                  >
                    <span
                      className={cn(
                        'size-1.5 shrink-0 rounded-full',
                        p.severity === 'critical' ? 'bg-red-500' : 'bg-amber-500',
                      )}
                    />
                    <span className="min-w-0 flex-1 text-sm text-foreground">
                      {t(`health.${p.kind}`, { n: p.count })}
                      {p.detail && (
                        <span className="text-muted-foreground"> · {p.detail}</span>
                      )}
                    </span>
                    <ArrowRight className="size-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                  </Link>
                </li>
              ))}
            </ul>
          )}

          {aprobaciones.length > 0 && (
            <Bloque
              titulo={t('operation.waitingApproval')}
              href="/panel"
              filas={aprobaciones.map((a) => ({ id: a.id, texto: a.title, nota: a.kind }))}
            />
          )}

          {pendientes.length > 0 && (
            <Bloque
              titulo={t('operation.pendingReplies')}
              href="/bandeja"
              filas={pendientes.map((c) => ({
                id: c.conversation_id,
                texto: c.contacto,
                nota:
                  c.pidio_humano ??
                  (c.horas_esperando !== null
                    ? t('operation.hoursWaiting', { n: c.horas_esperando })
                    : c.canal),
              }))}
            />
          )}
        </div>
      )}
    </section>
  )
}

function Bloque({
  titulo,
  href,
  filas,
}: {
  titulo: string
  href: string
  filas: { id: string; texto: string; nota: string | null }[]
}) {
  const t = useT()
  return (
    <div className="overflow-hidden rounded-xl border border-border">
      <div className="flex items-center justify-between px-4 py-2.5">
        <p className="text-xs font-medium text-muted-foreground">{titulo}</p>
        <Link
          href={href}
          className="text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          {t('operation.seeAll')}
        </Link>
      </div>
      <ul className="divide-y divide-border border-t border-border">
        {filas.map((f) => (
          <li key={f.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
            <span className="min-w-0 flex-1 truncate text-foreground">{f.texto}</span>
            {f.nota && (
              <span className="shrink-0 text-xs text-muted-foreground">{f.nota}</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}
