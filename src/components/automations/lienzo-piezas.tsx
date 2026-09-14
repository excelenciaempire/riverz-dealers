'use client'

import { Fragment, useCallback, useEffect, useRef, useState } from 'react'
import {
  CircleSlash,
  FileText,
  GitBranch,
  Hourglass,
  MessageSquare,
  PencilLine,
  PhoneCall,
  Tag,
  Tag as TagIcon,
  UserCheck,
  Webhook,
  Zap,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import type { BuilderStepType } from './automation-builder'
import { CARD_HALF, LINE_W } from './canvas-geometry'
export { CARD_HALF, LINE_W } from './canvas-geometry'

/**
 * Las piezas que definen cómo SE VE el lienzo de una automatización.
 *
 * Vivían adentro del constructor, que son cuatro mil líneas con arrastre,
 * nueve contextos y un guardado que navega. El chat que opera la cuenta dibuja
 * la MISMA automatización y necesita las mismas tarjetas: con una copia propia,
 * los colores y los iconos se habrían separado el primer día que alguien tocara
 * uno, y el chat pasaría a mostrar algo parecido en vez de lo mismo.
 *
 * Acá no hay lógica de edición: son el mapa de estilos por tipo de paso y el
 * abanico que dibuja las ramas. Los dos lados importan de acá.
 */

export interface StepMeta {
  /** i18n key (e.g. "automations.stepSendMessage") resolved with t() at render. */
  label: string
  icon: typeof Zap
  /** Left-border accent color (matches the icon hue). */
  border: string
  /** Tailwind classes for the icon chip on the step card. */
  iconBg: string
  iconText: string
  /** When set, the chip renders the brand SVG from /public/channels
   *  instead of the lucide icon. Used for first-class WhatsApp/Shopify
   *  step types so the canvas reads as "this is a WhatsApp action". */
  brand?: 'whatsapp' | 'shopify'
}

// `label` holds an i18n key, resolved with t() where the meta is rendered.
// `iconBg: "bg-white"` es a propósito y en los dos modos: esas piezas llevan
// el logo de un canal (marca de colores sobre fondo transparente) y sobre
// superficie oscura se pierde.
export const STEP_META: Record<BuilderStepType, StepMeta> = {
  switch: {
    // Mismo nombre e icono que `condition`: para quien arma el flujo es UN
    // elemento. Que por dentro se guarden distinto (binario con ramas
    // anidadas vs multi-camino) es asunto nuestro, no suyo — verlos con
    // iconos distintos hacía pensar que son dos cosas.
    label: "automations.stepCondition",
    icon: GitBranch,
    border: "border-l-amber-500",
    iconBg: "bg-amber-500/15",
    iconText: "text-amber-600 dark:text-amber-400",
  },
  send_message: {
    label: "automations.stepSendMessage",
    icon: MessageSquare,
    border: "border-l-emerald-500",
    iconBg: "bg-white",
    iconText: "text-emerald-500",
    brand: "whatsapp",
  },
  send_template: {
    label: "automations.stepSendTemplate",
    icon: FileText,
    border: "border-l-emerald-500",
    iconBg: "bg-white",
    iconText: "text-emerald-500",
    brand: "whatsapp",
  },
  add_tag: {
    label: "automations.stepAddTag",
    icon: Tag,
    border: "border-l-pink-500",
    iconBg: "bg-pink-500/15",
    iconText: "text-pink-600 dark:text-pink-400",
  },
  remove_tag: {
    label: "automations.stepRemoveTag",
    icon: TagIcon,
    border: "border-l-rose-500",
    iconBg: "bg-rose-500/15",
    iconText: "text-rose-600 dark:text-rose-400",
  },
  assign_conversation: {
    label: "automations.stepAssignConversation",
    icon: UserCheck,
    border: "border-l-cyan-500",
    iconBg: "bg-cyan-500/15",
    iconText: "text-cyan-600 dark:text-cyan-400",
  },
  update_contact_field: {
    label: "automations.stepUpdateContactField",
    icon: PencilLine,
    border: "border-l-violet-500",
    iconBg: "bg-violet-500/15",
    iconText: "text-violet-600 dark:text-violet-400",
  },
  set_context: {
    label: "automations.stepSetContext",
    icon: PencilLine,
    border: "border-l-violet-500",
    iconBg: "bg-violet-500/15",
    iconText: "text-violet-600 dark:text-violet-400",
  },
  wait: {
    label: "automations.stepWait",
    icon: Hourglass,
    border: "border-l-slate-500",
    iconBg: "bg-slate-500/15",
    iconText: "text-slate-600 dark:text-slate-400",
  },
  condition: {
    label: "automations.stepCondition",
    icon: GitBranch,
    border: "border-l-amber-500",
    iconBg: "bg-amber-500/15",
    iconText: "text-amber-600 dark:text-amber-400",
  },
  send_webhook: {
    label: "automations.stepSendWebhook",
    icon: Webhook,
    border: "border-l-indigo-500",
    iconBg: "bg-indigo-500/15",
    iconText: "text-indigo-600 dark:text-indigo-400",
  },
  close_conversation: {
    label: "automations.stepCloseConversation",
    icon: CircleSlash,
    border: "border-l-red-500",
    iconBg: "bg-red-500/15",
    iconText: "text-red-600 dark:text-red-400",
  },
  voice_call: {
    label: "automations.stepVoiceCall",
    icon: PhoneCall,
    border: "border-l-violet-500",
    iconBg: "bg-violet-500/15",
    iconText: "text-violet-600 dark:text-violet-400",
  },
}

/**
 * Alto de la cabecera de una tarjeta: 78 px de botón + el borde de arriba y el
 * de abajo. Es la caja a la que se alinea todo lo demás de la fila.
 */
export const HEAD_H = "h-20"
/** Media cabecera: la altura exacta a la que corre toda línea horizontal. */

/**
 * Color y grosor de las líneas del lienzo.
 *
 * `border` sobre el fondo oscuro del lienzo quedaba casi invisible: el flujo
 * se veía como tarjetas sueltas y había que adivinar qué se conectaba con
 * qué. Las líneas son la mitad de la información de un diagrama.
 *
 * 2 px, el mismo grosor que los tramos del "+ Añadir": con 1 px la línea
 * cambiaba de grosor justo donde se unían.
 */
export const LINE = "bg-foreground/25"
/** Grosor de la línea; el centro cae en CARD_HALF, así que se dibuja 1 px antes. */

export function BranchFan({
  lanes,
}: {
  lanes: { key: string; label: string; color: string; content: React.ReactNode }[]
}) {
  const wrap = useRef<HTMLDivElement | null>(null)
  // Keep nested fans in normal flow so every sibling reserves its full height.
  // Only this fan's direct rows share its offsetParent; descendants do not.
  // Dónde arranca cada fila, en píxeles de CSS desde el borde del abanico.
  const [rows, setRows] = useState<number[]>([])
  const [heights, setHeights] = useState<Record<string, number>>({})
  // Short exits go above long continuations. Reserving the whole continuation
  // before drawing an empty exit creates a spine hundreds of pixels tall.
  // Keys, labels and content move together; execution order is untouched.
  const orderedLanes = [...lanes].sort((a, b) =>
    (heights[a.key] ?? 0) - (heights[b.key] ?? 0))

  const measure = useCallback(() => {
    const el = wrap.current
    if (!el) return
    // offsetTop, no getBoundingClientRect: el lienzo está escalado y el rect
    // vendría en píxeles de pantalla, que hay que dividir por el zoom antes de
    // escribirlos de vuelta como CSS. offsetTop ya es layout.
    const tops = [...el.querySelectorAll<HTMLElement>(":scope > [data-lane-row]")].map(
      (r) => r.offsetTop,
    )
    // Sólo se escribe si de verdad cambió: esto corre después de cada pintada
    // y guardar lo mismo volvería a pintar, sin fin.
    const same = (a: number, b: number) => Math.abs(a - b) < 0.5
    setRows((prev) =>
      prev.length === tops.length && prev.every((v, i) => same(v, tops[i])) ? prev : tops,
    )
    const next = Object.fromEntries(
      [...el.querySelectorAll<HTMLElement>(":scope > [data-lane-content]")]
        .map(r => [r.dataset.laneContent!, r.offsetHeight]),
    )
    setHeights(prev => Object.keys(next).length === Object.keys(prev).length &&
      Object.entries(next).every(([key, value]) => same(prev[key] ?? -1, value)) ? prev : next)
  }, [])

  // Después de cada pintada, no sólo cuando algo cambia de tamaño. Desplegar
  // una tarjeta mueve los carriles de abajo sin cambiar el alto de ninguno,
  // y el observador de tamaño no se entera: la espina quedaba donde estaba,
  // sin llegar al último camino.
  //
  // Medir el DOM es exactamente para lo que sirve un efecto, y `measure` sólo
  // escribe cuando el número cambió de verdad, así que no encadena pintadas.
  useEffect(measure)

  useEffect(() => {
    const el = wrap.current
    if (!el) return
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    el.querySelectorAll(":scope > [data-lane-row]").forEach((r) => ro.observe(r))
    return () => ro.disconnect()
  }, [lanes.length, measure])

  const first = rows.length ? rows[0] : 0
  const last = rows.length ? rows[rows.length - 1] : 0

  return (
    <div
      ref={wrap}
      className="relative grid grid-cols-[max-content_auto] items-start gap-y-5 pl-8"
    >
      {/* Tronco: de la tarjeta que abre el abanico hasta la espina. Sin esto
          la tarjeta y sus caminos se veían como dos cosas sueltas. */}
      <span
        aria-hidden
        className={cn("absolute -left-2 w-6", LINE)}
        style={{ top: CARD_HALF - LINE_W / 2, height: LINE_W }}
      />
      {/* Espina: une el primer ramal con el último. */}
      {rows.length > 1 && (
        <span
          aria-hidden
          className={cn("absolute left-4", LINE)}
          style={{
            top: first + CARD_HALF - LINE_W / 2,
            height: last - first + LINE_W,
            width: LINE_W,
          }}
        />
      )}
      {orderedLanes.map((lane) => (
        <Fragment key={lane.key}>
          {/* Columna de la etiqueta: el ramal entra por la izquierda, pasa por
              la etiqueta y sigue hasta el primer paso del camino. Mide lo mismo
              que una cabecera para que su centro caiga en el tronco aunque el
              camino esté vacío.
              Sin hueco entre la etiqueta y la línea: el cable tiene que tocar
              la etiqueta, si no vuelve a leerse como dos piezas sueltas. */}
          <div data-lane-row className={cn("relative flex items-center", HEAD_H)}>
            <span
              aria-hidden
              className={cn("absolute -left-4 w-4", LINE)}
              style={{ top: CARD_HALF - LINE_W / 2, height: LINE_W }}
            />
            <span
              className={cn(
                "min-w-0 max-w-[220px] truncate rounded-full border px-2 py-0.5 text-[11px] font-semibold uppercase",
                lane.color,
              )}
              title={lane.label}
            >
              {lane.label}
            </span>
            <span
              aria-hidden
              className={cn("min-w-6 flex-1", LINE)}
              style={{ height: LINE_W }}
            />
          </div>
          <div data-lane-content={lane.key} className="justify-self-start">{lane.content}</div>
        </Fragment>
      ))}
    </div>
  )
}
