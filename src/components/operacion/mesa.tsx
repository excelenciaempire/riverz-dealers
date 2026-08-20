'use client'

import { useState } from 'react'
import { Check, Loader2, PanelRightClose, Users, X } from 'lucide-react'
import { useT } from '@/hooks/use-locale'
import { cn } from '@/lib/utils'
import { VistaArtefacto } from './artefacto'
import { mesaTieneAlgo, useMesa, type AgenteEnMesa } from './mesa-contexto'

/**
 * La mesa de trabajo: qué está armando el equipo, ahora.
 *
 * No es un registro de actividad. Es la pieza que se está tocando, dibujada, y
 * cambiando mientras la tocan. Para "actualizá el carrito abandonado" no
 * alcanza con redibujar el árbol —quien mira ya conocía esa automatización—
 * así que lo que se ve es el diff: lo que estaba atenuado, lo nuevo encendido,
 * lo que se va tachado.
 *
 * Sólo aparece cuando hay algo que mostrar. Una barra vacía al costado de un
 * chat vacío es ruido, y en una cuenta nueva sería lo único que se ve.
 */
export function Mesa() {
  const m = useMesa()
  const t = useT()
  const [abierta, setAbierta] = useState(true)
  const [enCajon, setEnCajon] = useState(false)

  if (!mesaTieneAlgo(m)) return null

  const cuerpo = (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="flex shrink-0 items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <Users className="size-4 text-accent-ink" />
          <h2 className="text-sm font-semibold text-foreground">{t('operation.mesaTitulo')}</h2>
          {m.activo && (
            <span className="relative flex size-2" aria-hidden>
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-accent-ink opacity-60" />
              <span className="relative inline-flex size-2 rounded-full bg-accent-ink" />
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={() => (enCajon ? setEnCajon(false) : setAbierta(false))}
          className="rounded-lg p-1 text-muted-foreground transition-colors hover:text-foreground"
          aria-label={t('operation.mesaCerrar')}
        >
          {enCajon ? <X className="size-4" /> : <PanelRightClose className="size-4" />}
        </button>
      </header>

      <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
        {m.plan && <VistaPlan plan={m.plan} />}

        {m.agentes.length > 0 && (
          <section className="space-y-1.5">
            {m.agentes.map((a) => (
              <FilaAgente key={a.id} agente={a} />
            ))}
          </section>
        )}

        {/* Los lienzos van al final y no arriba: mientras el equipo trabaja, lo
            que se mira es quién está haciendo qué; el dibujo importa cuando ya
            hay algo dibujado. */}
        {m.lienzos.map((l) => (
          <section key={`${l.agente}-${l.paso ?? 'x'}`} className="space-y-1.5">
            <p className="app-eyebrow">{l.agente}</p>
            <VistaArtefacto artefacto={l.artefacto} />
          </section>
        ))}
      </div>

      {m.gasto && (
        <footer className="shrink-0 border-t border-border px-4 py-2.5 text-[11px] text-muted-foreground">
          {t('operation.mesaGasto', {
            n: (m.gasto.promptTokens + m.gasto.completionTokens).toLocaleString(),
          })}
        </footer>
      )}
    </div>
  )

  return (
    <>
      {/* Columna en flujo, nunca fija: el ancho del menú de la izquierda es
          estado local del shell y no está expuesto en ningún contexto, así que
          un panel fijo no tendría contra qué calcular su posición. */}
      {abierta && (
        <aside className="hidden w-90 shrink-0 border-l border-border bg-card xl:block">
          {cuerpo}
        </aside>
      )}

      {/* Debajo de xl el hilo pide 768px y no queda rail sin ahogar la
          conversación, así que abajo es un cajón. */}
      {enCajon && (
        <div className="fixed inset-0 z-50 flex xl:hidden">
          <button
            type="button"
            className="flex-1 bg-black/60 backdrop-blur-sm"
            onClick={() => setEnCajon(false)}
            aria-label={t('operation.mesaCerrar')}
          />
          <div className="w-[min(24rem,90vw)] border-l border-border bg-card">{cuerpo}</div>
        </div>
      )}

      {/* La forma de traerla de vuelta. Sin esto, cerrarla una vez la esconde
          para siempre y parece que se rompió. */}
      {(!abierta || !enCajon) && (
        <button
          type="button"
          onClick={() => (window.innerWidth >= 1280 ? setAbierta(true) : setEnCajon(true))}
          className={cn(
            'fixed right-4 bottom-24 z-40 inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-2 text-xs shadow-sm transition-colors hover:text-foreground',
            abierta && 'xl:hidden',
          )}
        >
          <Users className="size-3.5 text-accent-ink" />
          {t('operation.mesaVer')}
          {m.activo && (
            <span className="size-1.5 animate-pulse rounded-full bg-accent-ink" aria-hidden />
          )}
        </button>
      )}
    </>
  )
}

function FilaAgente({ agente }: { agente: AgenteEnMesa }) {
  const Icono =
    agente.estado === 'trabajando' ? Loader2 : agente.estado === 'listo' ? Check : X
  return (
    <div
      className={cn(
        'rounded-lg border px-3 py-2',
        agente.estado === 'fallido'
          ? 'border-red-500/30 bg-red-500/5'
          : agente.estado === 'listo'
            ? 'border-accent-ink/25 bg-primary/5'
            : 'border-border bg-background',
      )}
    >
      <div className="flex items-center gap-2">
        <Icono
          className={cn(
            'size-3.5 shrink-0',
            agente.estado === 'trabajando' && 'animate-spin text-muted-foreground',
            agente.estado === 'listo' && 'text-accent-ink',
            agente.estado === 'fallido' && 'text-red-600 dark:text-red-400',
          )}
        />
        <span className="text-xs font-medium text-foreground">{agente.id}</span>
        {(agente.propuestas > 0 || agente.construidas > 0) && (
          <span className="ml-auto text-[10px] text-muted-foreground tabular-nums">
            {agente.construidas > 0 && `${agente.construidas} ✓`}
            {agente.propuestas > 0 && ` ${agente.propuestas} ⏳`}
          </span>
        )}
      </div>
      {agente.ultima && (
        <p className="mt-1 line-clamp-2 text-[11px] leading-snug text-muted-foreground">
          {agente.ultima}
        </p>
      )}
    </div>
  )
}

function VistaPlan({ plan }: { plan: NonNullable<ReturnType<typeof useMesa>['plan']> }) {
  const t = useT()
  return (
    <section className="rounded-xl border border-border bg-background p-3">
      <p className="app-eyebrow">{t('operation.mesaPlan')}</p>
      {plan.porque && (
        <p className="mt-1 text-[11px] leading-snug text-muted-foreground">{plan.porque}</p>
      )}
      <ol className="mt-2 space-y-1">
        {plan.pasos.map((p) => (
          <li key={p.i} className="flex items-start gap-2 text-[11px]">
            <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full bg-muted text-[9px] font-semibold text-muted-foreground">
              {p.i + 1}
            </span>
            <span className="min-w-0 flex-1 leading-snug text-foreground">
              <span className="font-medium">{p.agente}</span>{' '}
              <span className="text-muted-foreground">{p.encargo}</span>
              {/* Decir de qué depende es lo que hace entendible por qué un paso
                  todavía no arrancó. */}
              {p.dependeDe.length > 0 && (
                <span className="text-muted-foreground/70">
                  {' '}
                  ({t('operation.mesaEspera', { n: p.dependeDe.map((d) => d + 1).join(', ') })})
                </span>
              )}
            </span>
          </li>
        ))}
      </ol>
    </section>
  )
}
