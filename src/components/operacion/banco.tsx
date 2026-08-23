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
import { CintaEquipo } from './mapa-equipo'
import {
  useMesa,
  useMesaDispatch,
  type EstadoMesa,
  type FijadoEnMesa,
} from './mesa-contexto'

/**
 * El banco de trabajo: la pieza, a tamaño real, mientras se arma.
 *
 * Antes esto era una barra lateral con la lista del equipo y una miniatura de
 * 300px de lo que se estaba construyendo — una automatización de nueve pasos,
 * que en su propia pantalla ocupa un lienzo con zoom, dibujada del tamaño de un
 * sello. El pedido va al margen; la pieza va sobre la mesa.
 *
 * La trama de puntos y el halo no son decoración: son lo que hace que el fondo
 * se lea como un lienzo donde se trabaja y no como el fondo de un panel. El
 * halo respira mientras alguien del equipo está trabajando y se apaga cuando no
 * hay nadie, así que el estado del turno se ve sin leer una palabra.
 */
/**
 * ¿Hay algo sobre la mesa?
 *
 * El banco no está abierto por costumbre. Una conversación que todavía no armó
 * nada no tiene pieza que mirar, y medio ancho de pantalla ocupado por un
 * lienzo vacío es peor que no tenerlo: es una promesa sin cumplir.
 */
export function bancoTieneAlgo(m: EstadoMesa): boolean {
  return m.agentes.length > 0 || m.lienzos.length > 0 || m.fijado !== null
}

export function Banco({ className }: { className?: string }) {
  const m = useMesa()
  const aLaMesa = useMesaDispatch()
  const t = useT()

  // Qué se mira: lo que alguien fijó con «Ver cómo quedó» gana; si no, lo
  // último que el equipo dibujó mientras trabajaba.
  const ultimoLienzo = m.lienzos[m.lienzos.length - 1]
  const pieza: Artefacto | null = m.fijado?.artefacto ?? ultimoLienzo?.artefacto ?? null
  const fijado = m.fijado
  const enLienzo = pieza?.kind === 'automatizacion'

  return (
    <section
      className={cn(
        'relative flex min-w-0 flex-col overflow-hidden bg-background',
        className,
      )}
    >
      {/* La trama sólo cuando NO hay lienzo: `CanvasViewport` dibuja la suya, y
          dos retículas de distinto paso una encima de otra se ven mal. */}
      {!enLienzo && (
        <div className="app-trama pointer-events-none absolute inset-0 opacity-70" aria-hidden />
      )}
      <div
        className={cn(
          'app-halo pointer-events-none absolute inset-0',
          m.activo ? 'app-halo-vivo' : 'opacity-40',
        )}
        aria-hidden
      />

      {/* La cinta del equipo flota sobre el banco: quién trabaja y quién
          espera, encima de lo que están armando. */}
      {m.agentes.length > 0 && (
        <div className="relative z-20 px-5 pt-4">
          <CintaEquipo plan={m.plan} agentes={m.agentes} activo={m.activo} />
        </div>
      )}

      {pieza ? (
        <>
          <header className="relative z-20 flex items-start justify-between gap-4 px-5 pt-4 pb-1">
            <div className="min-w-0">
              <p className="app-eyebrow">{t('operation.bancoLaPieza')}</p>
              <h2 className="app-page-title mt-0.5 truncate">{nombreDe(pieza)}</h2>
              {'cuando' in pieza && (
                <p className="mt-0.5 truncate text-xs text-muted-foreground">{pieza.cuando}</p>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {fijado?.real && fijado.entidadId && esAutomatizacion(fijado) && (
                <Link
                  href={`/automatizaciones/${toShortId(fijado.entidadId)}/editar`}
                  className="app-card-cta text-accent-ink hover:underline"
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

          {fijado && !fijado.real && (
            <p className="relative z-20 px-5 pb-1 text-[11px] text-muted-foreground">
              {t('operation.mesaEsLoPropuesto')}
            </p>
          )}

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
    <div className="relative z-10 flex flex-1 flex-col items-center justify-center gap-2 px-8 text-center">
      <span className="app-glass flex size-12 items-center justify-center rounded-2xl">
        <Hammer className="size-5 text-accent-ink" />
      </span>
      <p className="app-eyebrow mt-1">{t('operation.bancoLaPieza')}</p>
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
          {m.activo && (
            <span className="size-1.5 animate-pulse rounded-full bg-accent-ink" aria-hidden />
          )}
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
