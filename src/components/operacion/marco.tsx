'use client'

import type { ReactNode } from 'react'
import { useT } from '@/hooks/use-locale'
import type { BaseArtefacto, Cambio } from '@/lib/operator/artifacts'
import { cn } from '@/lib/utils'

/**
 * El marco común de todo lo que se dibuja en el banco.
 *
 * Vive aparte de `artefacto.tsx` porque ahora lo usan los dos: las piezas que
 * el equipo CONSTRUYE y las vistas de lo que se LEE. Tenerlo en el archivo de
 * las piezas construidas obligaba a que el de las vistas lo importara de ahí, y
 * como aquél también dibuja vistas, el ciclo se cerraba.
 */

/**
 * Los tonos del cambio.
 *
 * Sin verde ni rojo puestos a mano: todo sale de los tokens del tema, así que
 * el dibujo se ve igual de bien en claro y en oscuro. Lo acentuado usa
 * `accent-ink` y nunca `primary`, que como texto es invisible sobre fondo claro.
 */
export const TONO: Record<Cambio, string> = {
  igual: 'border-border/70 bg-background opacity-60',
  nuevo: 'border-accent-ink/30 bg-primary/10',
  editado: 'border-accent-ink/30 bg-primary/10',
  quitado: 'border-dashed border-border bg-background opacity-50 line-through',
}

export function Marco({
  titulo,
  bajada,
  base,
  children,
}: {
  titulo: string
  bajada?: string
  base?: BaseArtefacto
  children: ReactNode
}) {
  const t = useT()
  return (
    <div className="rounded-xl border border-border bg-card p-3">
      <p className="text-sm font-medium text-foreground">{titulo}</p>
      {bajada && <p className="text-xs text-muted-foreground">{bajada}</p>}
      {/* Decir sobre qué se está trabajando importa: sin esto, un cambio se lee
          como una creación y nadie busca qué se movió. */}
      {base && (
        <p className="mt-0.5 text-[11px] text-accent-ink">
          {t('operation.marcoCambiosSobre')} {base.nombre}
        </p>
      )}
      <div className="mt-3">{children}</div>
    </div>
  )
}

export function Fichas({ items }: { items: string[] }) {
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

/**
 * Cuando no hay nada que dibujar.
 *
 * Una tabla sin filas o una conversación sin mensajes es un resultado, no un
 * error: «no hay pedidos esta semana» es exactamente lo que se fue a averiguar.
 * Dibujar un marco vacío hacía parecer que algo se rompió.
 */
export function Nada({ children }: { children: ReactNode }) {
  return (
    <p className={cn('rounded-lg border border-dashed border-border px-3 py-4', 'text-center text-xs text-muted-foreground')}>
      {children}
    </p>
  )
}
