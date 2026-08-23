'use client'

import { useState } from 'react'
import { ExternalLink, Hammer, X } from 'lucide-react'
import Link from '@/components/i18n/locale-link'
import { CanvasViewport } from '@/components/canvas/canvas-viewport'
import { useT } from '@/hooks/use-locale'
import type { Artefacto } from '@/lib/operator/artifacts'
import { toShortId } from '@/lib/short-id'
import { cn } from '@/lib/utils'
import { VistaArtefacto } from './artefacto'
import { LienzoAutomatizacion } from './lienzo-automatizacion'
import {
  useMesa,
  useMesaDispatch,
  type EstadoMesa,
  type FijadoEnMesa,
} from './mesa-contexto'

/**
 * El banco de trabajo: la pieza terminada, a tamaño real.
 *
 * Antes esto era una barra lateral con la lista del equipo y una miniatura de
 * 300px — una automatización de nueve pasos, que en su propia pantalla ocupa un
 * lienzo con zoom, dibujada del tamaño de un sello.
 *
 * **Se abre cuando la pieza está lista, no antes.** Mientras el equipo trabaja
 * lo que se mira es la conversación, que va contando lo que hace; media
 * pantalla ocupada por un lienzo a medio dibujar no ayuda a decidir nada. Y lo
 * que se ve acá es la pieza y nada más: sin rótulos que digan lo que el dibujo
 * ya dice.
 */
export function bancoTieneAlgo(m: EstadoMesa): boolean {
  if (m.fijado) return true
  return m.lienzos.length > 0 && !m.activo
}

export function Banco({ className }: { className?: string }) {
  const m = useMesa()
  const aLaMesa = useMesaDispatch()
  const t = useT()

  // Qué se mira: lo que alguien fijó con «Ver cómo quedó» gana; si no, lo
  // último que el equipo dejó armado.
  const ultimoLienzo = m.lienzos[m.lienzos.length - 1]
  const pieza: Artefacto | null = m.fijado?.artefacto ?? ultimoLienzo?.artefacto ?? null
  const fijado = m.fijado
  const enLienzo = pieza?.kind === 'automatizacion'

  return (
    <section
      className={cn('relative flex min-w-0 flex-col overflow-hidden bg-background', className)}
    >
      {/* La trama sólo cuando NO hay lienzo: `CanvasViewport` dibuja la suya, y
          dos retículas de distinto paso una encima de otra se ven mal. */}
      {!enLienzo && (
        <div className="app-trama pointer-events-none absolute inset-0 opacity-70" aria-hidden />
      )}
      <div className="app-halo pointer-events-none absolute inset-0 opacity-40" aria-hidden />

      {pieza ? (
        <>
          {/* Una sola fila, con su alto propio: el nombre a la izquierda y lo
              que se puede hacer a la derecha. Nada flotando sobre el lienzo. */}
          <header className="relative z-20 flex h-14 shrink-0 items-center justify-between gap-4 border-b border-border px-5">
            <h2 className="app-page-title min-w-0 truncate text-[22px]">{nombreDe(pieza)}</h2>
            <div className="flex shrink-0 items-center gap-3">
              {fijado?.real && fijado.entidadId && esAutomatizacion(fijado) && (
                <Link
                  href={`/automatizaciones/${toShortId(fijado.entidadId)}/editar`}
                  className="app-card-cta text-[11px] text-accent-ink hover:underline"
                >
                  {t('operation.mesaAbrirEnPantalla')}
                  <ExternalLink className="size-3" />
                </Link>
              )}
              {fijado && (
                <button
                  type="button"
                  onClick={() => aLaMesa({ tipo: 'fijar', fijado: null })}
                  className="rounded-lg p-1 text-muted-foreground transition-colors hover:text-foreground"
                  aria-label={t('operation.mesaCerrar')}
                >
                  <X className="size-4" />
                </button>
              )}
            </div>
          </header>

          <div className="relative z-10 min-h-0 flex-1">
            {pieza.kind === 'automatizacion' ? (
              <CanvasViewport className="h-full" initialFit="fit">
                <LienzoAutomatizacion cuando={pieza.cuando} pasos={pieza.pasos} />
              </CanvasViewport>
            ) : (
              // Una plantilla o un segmento no son un árbol: se leen enteros de
              // un vistazo y meterlos en un lienzo con zoom sería disfrazarlos.
              <div className="flex h-full items-start justify-center overflow-y-auto p-8">
                <div className="w-full max-w-md">
                  <VistaArtefacto artefacto={pieza} />
                </div>
              </div>
            )}
          </div>
        </>
      ) : (
        <BancoVacio />
      )}
    </section>
  )
}

function BancoVacio() {
  const t = useT()
  return (
    <div className="relative z-10 flex flex-1 flex-col items-center justify-center gap-3 px-8 text-center">
      <span className="app-glass flex size-12 items-center justify-center rounded-2xl">
        <Hammer className="size-5 text-accent-ink" />
      </span>
      <p className="max-w-xs text-sm text-muted-foreground">{t('operation.bancoVacio')}</p>
    </div>
  )
}

function nombreDe(a: Artefacto): string {
  return 'nombre' in a && typeof a.nombre === 'string' ? a.nombre : ''
}

function esAutomatizacion(f: FijadoEnMesa): boolean {
  return f.capabilityKey.startsWith('automatizaciones.')
}

/**
 * El banco en móvil, como hoja.
 *
 * Debajo de `lg` no hay ancho para las dos zonas sin ahogar las dos, así que la
 * conversación se queda con la pantalla y la pieza sube desde abajo. El botón
 * lo esconde el CSS y no un `if`: decidirlo con `window.innerWidth` se lee una
 * vez y giraba mal el teléfono.
 */
export function BancoEnHoja() {
  const m = useMesa()
  const t = useT()
  const [abierta, setAbierta] = useState(false)

  if (!bancoTieneAlgo(m)) return null

  return (
    <>
      {!abierta && (
        <button
          type="button"
          onClick={() => setAbierta(true)}
          className="app-glass fixed right-4 bottom-24 z-40 inline-flex items-center gap-1.5 rounded-full px-3 py-2 text-xs transition-colors hover:text-foreground lg:hidden"
        >
          <Hammer className="size-3.5 text-accent-ink" />
          {t('operation.bancoVer')}
        </button>
      )}

      {abierta && (
        <div className="fixed inset-0 z-50 flex flex-col lg:hidden">
          <button
            type="button"
            className="h-16 w-full bg-black/60 backdrop-blur-sm"
            onClick={() => setAbierta(false)}
            aria-label={t('operation.mesaCerrar')}
          />
          <div className="flex min-h-0 flex-1 flex-col rounded-t-2xl border-t border-border bg-background pb-[env(safe-area-inset-bottom)]">
            <div className="flex justify-center py-2">
              <span className="h-1 w-10 rounded-full bg-border" aria-hidden />
            </div>
            <Banco className="min-h-0 flex-1" />
          </div>
        </div>
      )}
    </>
  )
}
