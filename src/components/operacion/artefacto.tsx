'use client'

import { ArrowDown, Clock, MessageSquare, Tag, XCircle, GitBranch, FileText } from 'lucide-react'
import type { Artefacto, PasoArtefacto } from '@/lib/operator/artifacts'
import { cn } from '@/lib/utils'

/**
 * Lo que el Operador armó, dibujado.
 *
 * El texto dice "creé una automatización de tres pasos" y eso no alcanza para
 * saber si es la que pediste. Acá se ve el árbol con sus esperas y sus ramas,
 * que es lo que permite aprobar mirando en vez de confiando.
 *
 * Es un dibujo propio y no el lienzo del editor: aquél son 4.200 líneas con
 * nueve contextos y arrastra la pantalla entera. Acá alcanza con una columna de
 * tarjetas chicas — se lee de un vistazo y entra en un mensaje.
 */

const ICONO: Record<string, typeof Clock> = {
  wait: Clock,
  send_message: MessageSquare,
  send_template: FileText,
  add_tag: Tag,
  close_conversation: XCircle,
  condition: GitBranch,
}

export function VistaArtefacto({ artefacto }: { artefacto: Artefacto }) {
  if (artefacto.kind === 'agente') {
    return (
      <div className="rounded-xl border border-border bg-card p-3">
        <p className="text-sm font-medium text-foreground">{artefacto.nombre}</p>
        <p className="text-xs text-muted-foreground">{artefacto.rol}</p>
        {artefacto.puede.length > 0 && (
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {artefacto.puede.map((x) => (
              <li
                key={x}
                className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] text-accent-ink"
              >
                {x}
              </li>
            ))}
          </ul>
        )}
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-border bg-card p-3">
      <p className="text-sm font-medium text-foreground">{artefacto.nombre}</p>
      <p className="text-xs text-muted-foreground">Cuando {artefacto.cuando}</p>
      <div className="mt-3">
        <Rama pasos={artefacto.pasos} />
      </div>
    </div>
  )
}

function Rama({ pasos, nivel = 0 }: { pasos: PasoArtefacto[]; nivel?: number }) {
  return (
    <ol className={cn('flex flex-col gap-1', nivel > 0 && 'mt-1')}>
      {pasos.map((p, i) => {
        const Icon = ICONO[p.tipo] ?? MessageSquare
        return (
          <li key={`${p.tipo}-${i}`}>
            <div className="flex items-start gap-2 rounded-lg border border-border/70 bg-background px-2.5 py-1.5">
              <Icon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 text-xs leading-snug text-foreground">
                {p.resumen}
              </span>
            </div>

            {/* Las ramas se dibujan indentadas y etiquetadas. Sin el "sí/no" a
                la vista, un condicional se lee como dos pasos seguidos. */}
            {(p.si?.length || p.no?.length) && (
              <div className="mt-1 ml-3 border-l border-border pl-3">
                {p.si && p.si.length > 0 && (
                  <>
                    <p className="text-[10px] font-medium tracking-wide text-accent-ink uppercase">
                      Sí
                    </p>
                    <Rama pasos={p.si} nivel={nivel + 1} />
                  </>
                )}
                {p.no && p.no.length > 0 && (
                  <>
                    <p className="mt-2 text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
                      No
                    </p>
                    <Rama pasos={p.no} nivel={nivel + 1} />
                  </>
                )}
              </div>
            )}

            {i < pasos.length - 1 && !p.si?.length && !p.no?.length && (
              <ArrowDown className="mx-auto my-0.5 size-3 text-border" />
            )}
          </li>
        )
      })}
    </ol>
  )
}
