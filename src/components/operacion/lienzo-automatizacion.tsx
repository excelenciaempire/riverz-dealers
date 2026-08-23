'use client'

import { Fragment } from 'react'
import {
  Clock,
  FileText,
  GitBranch,
  MessageSquare,
  PhoneCall,
  Tag,
  UserCog,
  Users,
  Webhook,
  XCircle,
  Zap,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import type { Cambio, PasoArtefacto } from '@/lib/operator/artifacts'

/**
 * La automatización sobre el banco, con la forma que tiene en su editor.
 *
 * No es el editor: son 4.200 líneas con nueve contextos, arrastre y un guardado
 * que navega. Es su MISMA GRAMÁTICA en modo lectura — el disparador a la
 * izquierda, el flujo hacia la derecha, las ramas colgando con su etiqueta— y
 * las mismas tarjetas de 320px, para que se lea como el mismo objeto y no como
 * una miniatura de otra cosa.
 *
 * **El lima significa una sola cosa acá: esto le llega a una persona.** Un paso
 * que deja algo apagado va en trazo; uno que manda un mensaje o hace una
 * llamada va relleno. Es el modelo de seguridad del producto —la línea que
 * decide qué se construye solo y qué espera una mano— convertido en gráfica, en
 * vez de dieciséis filas grises iguales.
 *
 * La disposición es flex anidado y no coordenadas: un árbol chico se acomoda
 * solo, sin medir nada y sin que un texto largo descoloque un conector.
 */

const ICONO: Record<string, typeof Clock> = {
  wait: Clock,
  send_message: MessageSquare,
  send_template: FileText,
  add_tag: Tag,
  remove_tag: Tag,
  close_conversation: XCircle,
  assign_conversation: Users,
  condition: GitBranch,
  update_contact_field: UserCog,
  send_webhook: Webhook,
  voice_call: PhoneCall,
}

/** Los pasos que salen al mundo. Son los que se dibujan en lima. */
const SALE_AL_MUNDO = new Set(['send_message', 'send_template', 'voice_call'])

/** El tono del diff, cuando se está editando algo que ya existía. */
const TONO: Record<Cambio, string> = {
  igual: 'opacity-60',
  nuevo: 'ring-accent-ink/40',
  editado: 'ring-accent-ink/40',
  quitado: 'opacity-40 line-through',
}

export function LienzoAutomatizacion({
  cuando,
  pasos,
  hayDiff,
}: {
  /** Cuándo se dispara, en palabras. */
  cuando: string
  pasos: PasoArtefacto[]
  /** Si esto es una edición, los pasos traen su cambio y se tiñen. */
  hayDiff?: boolean
}) {
  return (
    <div className="flex w-max items-center gap-0 px-10 py-14">
      <Disparador cuando={cuando} />
      <Tramo pasos={pasos} hayDiff={hayDiff} />
    </div>
  )
}

function Disparador({ cuando }: { cuando: string }) {
  return (
    <div className="app-glass w-80 shrink-0 rounded-xl p-4">
      <p className="app-eyebrow">Cuando</p>
      <p className="mt-1.5 flex items-start gap-2 text-sm leading-snug text-foreground">
        <Zap className="mt-0.5 size-4 shrink-0 text-accent-ink" />
        {cuando}
      </p>
    </div>
  )
}

/** Una fila de pasos que corren uno tras otro. */
function Tramo({ pasos, hayDiff }: { pasos: PasoArtefacto[]; hayDiff?: boolean }) {
  if (pasos.length === 0) return <Vacio />
  return (
    <div className="flex items-center">
      {pasos.map((p, i) => (
        <Fragment key={`${p.tipo}-${i}`}>
          <Flecha />
          <div className="flex items-center">
            <Nodo paso={p} hayDiff={hayDiff} />
            {(p.si?.length || p.no?.length) && <Bifurcacion paso={p} hayDiff={hayDiff} />}
          </div>
        </Fragment>
      ))}
    </div>
  )
}

/** Las dos ramas de una pregunta, colgadas a la derecha con su etiqueta. */
function Bifurcacion({ paso, hayDiff }: { paso: PasoArtefacto; hayDiff?: boolean }) {
  return (
    <div className="flex flex-col gap-6 pl-0">
      <Salida etiqueta="Sí" tono="si">
        <Tramo pasos={paso.si ?? []} hayDiff={hayDiff} />
      </Salida>
      <Salida etiqueta="No" tono="no">
        <Tramo pasos={paso.no ?? []} hayDiff={hayDiff} />
      </Salida>
    </div>
  )
}

function Salida({
  etiqueta,
  tono,
  children,
}: {
  etiqueta: string
  tono: 'si' | 'no'
  children: React.ReactNode
}) {
  return (
    <div className="flex items-center">
      <span
        className={cn(
          'ml-3 shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold tracking-[0.14em] uppercase',
          tono === 'si'
            ? 'bg-primary/15 text-accent-ink'
            : 'bg-muted text-muted-foreground',
        )}
      >
        {etiqueta}
      </span>
      {children}
    </div>
  )
}

function Nodo({ paso, hayDiff }: { paso: PasoArtefacto; hayDiff?: boolean }) {
  const Icono = ICONO[paso.tipo] ?? MessageSquare
  const sale = SALE_AL_MUNDO.has(paso.tipo)
  const cambio = paso.cambio ?? 'igual'
  const esPregunta = paso.tipo === 'condition'

  return (
    <div
      className={cn(
        'w-80 shrink-0 rounded-xl p-4 transition-colors',
        // Lo que sale al mundo va relleno; lo demás, en trazo. Es la única cosa
        // que el lima dice en esta pantalla.
        sale
          ? 'bg-primary text-primary-foreground ring-1 ring-primary/60'
          : esPregunta
            ? 'app-glass'
            : 'rounded-xl border border-dashed border-border bg-transparent',
        hayDiff && TONO[cambio],
      )}
    >
      {paso.antes && (
        <p className="mb-1 text-[11px] leading-snug text-muted-foreground line-through">
          {paso.antes}
        </p>
      )}
      <p className="flex items-start gap-2 text-sm leading-snug">
        <Icono
          className={cn(
            'mt-0.5 size-4 shrink-0',
            sale ? 'text-primary-foreground/70' : 'text-muted-foreground',
          )}
        />
        <span className="min-w-0 flex-1">{paso.resumen}</span>
      </p>
      {sale && (
        <p className="mt-2 text-[10px] font-semibold tracking-[0.14em] uppercase opacity-70">
          Le llega a una persona
        </p>
      )}
    </div>
  )
}

/** Una rama sin pasos: el motor sigue de largo y conviene que se vea. */
function Vacio() {
  return (
    <div className="ml-3 shrink-0 rounded-lg border border-dashed border-border px-3 py-2 text-[11px] text-muted-foreground">
      No hace nada
    </div>
  )
}

/** El tramo entre dos nodos. */
function Flecha() {
  return (
    <div className="flex h-px w-10 shrink-0 items-center" aria-hidden>
      <div className="h-px flex-1 bg-border" />
      <div className="size-1.5 shrink-0 rotate-45 border-t border-r border-border" />
    </div>
  )
}
