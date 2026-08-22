'use client'

import { Fragment } from 'react'
import { Check, Loader2, Sparkles, X } from 'lucide-react'
import { useT } from '@/hooks/use-locale'
import { TextoRico } from '@/components/ui/texto-rico'
import { cn } from '@/lib/utils'
import type { AgenteEnMesa, PlanEnMesa } from './mesa-contexto'

/**
 * El equipo trabajando, dibujado.
 *
 * Una lista no dice lo único que hace falta saber mientras se espera: **qué
 * está corriendo junto y qué está esperando a otro**. Un especialista quieto se
 * ve igual que uno colgado si no se ve de quién depende.
 *
 * El plan ya trae esa forma —cada paso dice de cuáles depende— así que acá sólo
 * se agrupa en olas y se dibuja: lo que no se debe nada va en la misma fila, lo
 * que espera va debajo con la línea que lo une. Sin librerías: son cajas y
 * bordes, así que se pliega solo cuando no hay ancho.
 *
 * No repite el encargo de cada paso. Eso está en la tarjeta del hilo, con sus
 * botones, y ponerlo también acá era la misma frase dos veces en la misma
 * pantalla.
 */

type Estado = 'espera' | 'trabajando' | 'listo' | 'fallido'

/** Los pasos agrupados por ola: los que no dependen de nadie pendiente, juntos. */
export function olasDelPlan(pasos: PlanEnMesa['pasos']): PlanEnMesa['pasos'][] {
  const olas: PlanEnMesa['pasos'][] = []
  const puestos = new Set<number>()
  let quedan = pasos.slice()
  // Tope defensivo: una dependencia circular no llega hasta acá (el servidor la
  // rechaza al validar el plan), pero un bucle infinito en el navegador sí
  // congelaría la pantalla.
  while (quedan.length > 0 && olas.length < pasos.length + 1) {
    const lista = quedan.filter((p) => p.dependeDe.every((d) => puestos.has(d)))
    if (lista.length === 0) {
      olas.push(quedan)
      break
    }
    olas.push(lista)
    for (const p of lista) puestos.add(p.i)
    quedan = quedan.filter((p) => !puestos.has(p.i))
  }
  return olas
}

export function MapaEquipo({
  plan,
  agentes,
  activo,
}: {
  /** Sin plan es una sola delegación: un especialista, una ola. */
  plan: PlanEnMesa | null
  agentes: AgenteEnMesa[]
  activo: boolean
}) {
  const t = useT()
  const porAgente = new Map(agentes.map((a) => [a.id, a]))
  // El mapa se dibuja siempre, con plan o sin él. Antes, un pedido que se
  // resolvía con un solo especialista caía a una lista y el panel no se parecía
  // en nada al de un pedido grande: se veía como si el equipo no existiera.
  const olas = plan
    ? olasDelPlan(plan.pasos)
    : [agentes.map((a, i) => ({ i, agente: a.id, encargo: '', dependeDe: [] }))]

  return (
    <section className="space-y-1">
      <div className="flex justify-center">
        <div
          className={cn(
            'inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[11px] font-medium',
            activo
              ? 'border-accent-ink/40 bg-primary/10 text-accent-ink'
              : 'border-border bg-background text-muted-foreground',
          )}
        >
          <Sparkles className="size-3" />
          {t('operation.mapaOperador')}
          {activo && (
            <span className="relative flex size-1.5" aria-hidden>
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-accent-ink opacity-70" />
              <span className="relative inline-flex size-1.5 rounded-full bg-accent-ink" />
            </span>
          )}
        </div>
      </div>

      {olas.map((ola, n) => (
        <Fragment key={n}>
          <Linea />
          <div className="flex flex-wrap justify-center gap-1.5">
            {ola.map((paso) => {
              const a = porAgente.get(paso.agente)
              const estado: Estado = a?.estado ?? 'espera'
              return (
                <Nodo
                  key={paso.i}
                  nombre={paso.agente}
                  estado={estado}
                  ultima={estado === 'espera' ? undefined : a?.ultima}
                />
              )
            })}
          </div>
        </Fragment>
      ))}
    </section>
  )
}

/** El tramo que une una ola con la siguiente. Es lo que se lee como "espera a". */
function Linea() {
  return <div className="mx-auto h-3 w-px bg-border" aria-hidden />
}

function Nodo({
  nombre,
  estado,
  ultima,
}: {
  nombre: string
  estado: Estado
  ultima?: string
}) {
  const Icono =
    estado === 'trabajando' ? Loader2 : estado === 'listo' ? Check : estado === 'fallido' ? X : null
  return (
    <div
      className={cn(
        'min-w-0 max-w-full rounded-lg border px-2 py-1.5 text-[11px] transition-colors',
        estado === 'fallido'
          ? 'border-red-500/30 bg-red-500/5'
          : estado === 'listo'
            ? 'border-accent-ink/25 bg-primary/5'
            : estado === 'trabajando'
              ? 'border-accent-ink/40 bg-primary/10'
              : 'border-dashed border-border bg-background opacity-70',
      )}
    >
      <div className="flex items-center gap-1.5">
        {Icono ? (
          <Icono
            className={cn(
              'size-3 shrink-0',
              estado === 'trabajando' && 'animate-spin text-accent-ink',
              estado === 'listo' && 'text-accent-ink',
              estado === 'fallido' && 'text-red-600 dark:text-red-400',
            )}
          />
        ) : (
          <span className="size-1.5 shrink-0 rounded-full bg-border" aria-hidden />
        )}
        <span className="truncate font-medium text-foreground">{nombre}</span>
      </div>
      {ultima && (
        <div className="mt-0.5 line-clamp-2 leading-snug text-muted-foreground">
          <TextoRico text={ultima} />
        </div>
      )}
    </div>
  )
}
