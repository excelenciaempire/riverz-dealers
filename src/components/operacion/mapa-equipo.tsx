'use client'

import { Fragment } from 'react'
import { Check, Loader2, Sparkles, X } from 'lucide-react'
import { useT } from '@/hooks/use-locale'
import { cn } from '@/lib/utils'
import type { AgenteEnMesa, PlanEnMesa } from './mesa-contexto'

/**
 * La cinta del equipo: quién trabaja, quién terminó y quién espera a quién.
 *
 * Una lista no dice lo único que hace falta saber mientras se espera: **qué
 * corre junto y qué está esperando a otro**. Un especialista quieto se ve igual
 * que uno colgado si no se ve de quién depende.
 *
 * El plan ya trae esa forma —cada paso dice de cuáles depende— así que acá se
 * agrupa en olas y se dibuja de izquierda a derecha, sobre el banco: lo que no
 * se debe nada va junto, lo que espera va después de una línea. Fichas de
 * vidrio y una línea; sin librerías, y se pliega solo cuando no hay ancho.
 *
 * No repite el encargo de cada paso: eso está en el margen, con sus botones.
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

export function CintaEquipo({
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
  // La cinta se dibuja siempre, con plan o sin él. Antes, un pedido que se
  // resolvía con un solo especialista caía a una lista y el panel no se parecía
  // en nada al de un pedido grande: se veía como si el equipo no existiera.
  const olas = plan
    ? olasDelPlan(plan.pasos)
    : [agentes.map((a, i) => ({ i, agente: a.id, encargo: '', dependeDe: [] }))]

  return (
    <section
      aria-label={t('operation.mesaTitulo')}
      className="scrollbar-thin flex items-center gap-2 overflow-x-auto pb-1"
    >
      <span
        className={cn(
          'app-glass inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium',
          activo ? 'text-accent-ink' : 'text-muted-foreground',
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
      </span>

      {olas.map((ola, n) => (
        <Fragment key={n}>
          <Hilo />
          <div className="flex shrink-0 items-center gap-1.5">
            {ola.map((paso) => {
              const a = porAgente.get(paso.agente)
              const estado: Estado = a?.estado ?? 'espera'
              return <Ficha key={paso.i} nombre={paso.agente} estado={estado} />
            })}
          </div>
        </Fragment>
      ))}
    </section>
  )
}

/** El tramo que une una ola con la siguiente. Es lo que se lee como "espera a". */
function Hilo() {
  return <span className="h-px w-5 shrink-0 bg-border" aria-hidden />
}

function Ficha({ nombre, estado }: { nombre: string; estado: Estado }) {
  const Icono =
    estado === 'trabajando' ? Loader2 : estado === 'listo' ? Check : estado === 'fallido' ? X : null
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors',
        estado === 'fallido'
          ? 'bg-red-500/10 text-red-600 ring-1 ring-red-500/30 dark:text-red-400'
          : estado === 'listo'
            ? 'bg-primary/15 text-accent-ink ring-1 ring-primary/40'
            : estado === 'trabajando'
              ? 'app-glass text-accent-ink'
              : 'border border-dashed border-border text-muted-foreground',
      )}
    >
      {Icono ? (
        <Icono className={cn('size-3', estado === 'trabajando' && 'animate-spin')} />
      ) : (
        <span className="size-1.5 rounded-full bg-border" aria-hidden />
      )}
      {nombre}
    </span>
  )
}
