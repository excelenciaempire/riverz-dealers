'use client'

import {
  ArrowDown,
  Clock,
  FileText,
  GitBranch,
  MessageSquare,
  PhoneCall,
  Tag,
  UserCog,
  Users,
  Webhook,
  Workflow,
  XCircle,
} from 'lucide-react'
import type { Artefacto, Cambio, PasoArtefacto } from '@/lib/operator/artifacts'
import { cn } from '@/lib/utils'

/**
 * Lo que el equipo armó, dibujado.
 *
 * El texto dice "creé una automatización de tres pasos" y eso no alcanza para
 * saber si es la que pediste. Acá se ve el árbol con sus esperas y sus ramas,
 * que es lo que permite aprobar mirando en vez de confiando.
 *
 * Y cuando lo que se pidió fue un CAMBIO, el árbol nuevo tampoco alcanza: quien
 * mira ya conocía esa automatización y necesita ver qué se movió. Por eso cada
 * parte viaja marcada y acá se dibuja la marca: lo que estaba, atenuado; lo
 * nuevo, encendido; lo editado con lo que decía antes; lo que se va, tachado.
 *
 * Es un dibujo propio y no el lienzo del editor: aquél son 4.200 líneas con
 * nueve contextos y arrastra la pantalla entera. Acá alcanza con una columna de
 * tarjetas chicas — se lee de un vistazo, entra en un mensaje y entra en el
 * panel de la derecha.
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

/**
 * Los tonos del cambio.
 *
 * Sin verde ni rojo puestos a mano: todo sale de los tokens del tema, así que
 * el dibujo se ve igual de bien en claro y en oscuro. Lo acentuado usa
 * `accent-ink` y nunca `primary`, que como texto es invisible sobre fondo claro.
 */
const TONO: Record<Cambio, string> = {
  igual: 'border-border/70 bg-background opacity-60',
  nuevo: 'border-accent-ink/30 bg-primary/10',
  editado: 'border-accent-ink/30 bg-primary/10',
  quitado: 'border-dashed border-border bg-background opacity-50 line-through',
}

export function VistaArtefacto({ artefacto }: { artefacto: Artefacto }) {
  switch (artefacto.kind) {
    case 'automatizacion':
      return (
        <Marco titulo={artefacto.nombre} bajada={`Cuando ${artefacto.cuando}`} base={artefacto.base}>
          <Rama pasos={artefacto.pasos} />
        </Marco>
      )

    case 'agente':
      return (
        <Marco titulo={artefacto.nombre} bajada={artefacto.rol} base={artefacto.base}>
          {artefacto.puede.length > 0 && <Fichas items={artefacto.puede} />}
          {artefacto.escala.length > 0 && (
            <p className="mt-2 text-[11px] text-muted-foreground">
              Deriva a una persona: {artefacto.escala.join(', ')}
            </p>
          )}
        </Marco>
      )

    case 'plantilla':
      return (
        <Marco
          titulo={artefacto.nombre}
          bajada={`${artefacto.categoria} · ${artefacto.idioma}`}
          base={artefacto.base}
        >
          {/* El cuerpo como lo va a leer el cliente, no como está guardado. */}
          <div className="rounded-lg border border-border/70 bg-background px-2.5 py-2">
            {artefacto.encabezado && (
              <p className="text-xs font-semibold text-foreground">{artefacto.encabezado}</p>
            )}
            <p className="text-xs leading-snug whitespace-pre-line text-foreground">
              {artefacto.cuerpo}
            </p>
            {artefacto.pie && (
              <p className="mt-1 text-[10px] text-muted-foreground">{artefacto.pie}</p>
            )}
          </div>
          {artefacto.botones && artefacto.botones.length > 0 && (
            <Fichas items={artefacto.botones.map((b) => b.texto)} />
          )}
        </Marco>
      )

    case 'segmento':
      return (
        <Marco
          titulo={artefacto.nombre}
          bajada={
            artefacto.alcance === undefined
              ? undefined
              : `${artefacto.alcance} ${artefacto.alcance === 1 ? 'contacto' : 'contactos'}`
          }
          base={artefacto.base}
        >
          <ul className="flex flex-col gap-1">
            {artefacto.reglas.map((r, i) => (
              <li
                key={`${r.campo}-${i}`}
                className={cn(
                  'rounded-lg border px-2.5 py-1.5 text-xs text-foreground',
                  TONO[r.cambio ?? 'igual'],
                )}
              >
                {r.campo} {r.op} {r.valor}
              </li>
            ))}
          </ul>
        </Marco>
      )

    case 'campana':
      return (
        <Marco titulo={artefacto.nombre} bajada={artefacto.cuando} base={artefacto.base}>
          <p className="text-xs text-foreground">
            <span className="font-medium">{artefacto.destinatarios}</span> destinatarios ·{' '}
            {artefacto.plantilla}
          </p>
        </Marco>
      )

    case 'flujo':
      return (
        <Marco titulo={artefacto.nombre} base={artefacto.base}>
          <ul className="flex flex-col gap-1">
            {artefacto.nodos.map((n) => (
              <li
                key={n.clave}
                className={cn(
                  'flex items-start gap-2 rounded-lg border px-2.5 py-1.5',
                  TONO[n.cambio ?? 'igual'],
                )}
              >
                <Workflow className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 text-xs leading-snug text-foreground">
                  {n.resumen}
                </span>
              </li>
            ))}
          </ul>
        </Marco>
      )
  }
}

function Marco({
  titulo,
  bajada,
  base,
  children,
}: {
  titulo: string
  bajada?: string
  base?: { id: string; nombre: string }
  children: React.ReactNode
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-3">
      <p className="text-sm font-medium text-foreground">{titulo}</p>
      {bajada && <p className="text-xs text-muted-foreground">{bajada}</p>}
      {/* Decir sobre qué se está trabajando importa: sin esto, un cambio se lee
          como una creación y nadie busca qué se movió. */}
      {base && (
        <p className="mt-0.5 text-[11px] text-accent-ink">Cambios sobre {base.nombre}</p>
      )}
      <div className="mt-3">{children}</div>
    </div>
  )
}

function Fichas({ items }: { items: string[] }) {
  return (
    <ul className="mt-2 flex flex-wrap gap-1.5">
      {items.map((x) => (
        <li key={x} className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] text-accent-ink">
          {x}
        </li>
      ))}
    </ul>
  )
}

function Rama({ pasos, nivel = 0 }: { pasos: PasoArtefacto[]; nivel?: number }) {
  return (
    <ol className={cn('flex flex-col gap-1', nivel > 0 && 'mt-1')}>
      {pasos.map((p, i) => {
        const Icon = ICONO[p.tipo] ?? MessageSquare
        const cambio = p.cambio ?? 'igual'
        // Sin marcas no es un cambio sino una creación, y ahí atenuar todo
        // sería raro: se dibuja plano.
        const hayDiff = pasos.some((x) => x.cambio && x.cambio !== 'igual')
        return (
          <li key={`${p.tipo}-${i}`}>
            <div
              className={cn(
                'flex items-start gap-2 rounded-lg border px-2.5 py-1.5',
                hayDiff ? TONO[cambio] : 'border-border/70 bg-background',
              )}
            >
              <Icon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 text-xs leading-snug text-foreground">
                {p.antes && (
                  <span className="block text-[11px] text-muted-foreground line-through">
                    {p.antes}
                  </span>
                )}
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
