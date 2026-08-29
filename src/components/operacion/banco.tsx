'use client'

import { useState } from 'react'
import { ExternalLink, Hammer, X } from 'lucide-react'
import Link from '@/components/i18n/locale-link'
import { CanvasViewport } from '@/components/canvas/canvas-viewport'
import { useT } from '@/hooks/use-locale'
import type { Artefacto } from '@/lib/operator/artifacts'
import { toShortId } from '@/lib/short-id'
import { cn } from '@/lib/utils'
import { WhatsappPreview } from '@/components/templates/whatsapp-preview'
import type { TemplateButtonInput } from '@/lib/whatsapp/template-components'
import { VistaArtefacto } from './artefacto'
import { VISTAS_ANCHAS } from './vistas'
import { LienzoAutomatizacion } from './lienzo-automatizacion'
import {
  useMesa,
  useMesaDispatch,
  type EstadoMesa,
  type FijadoEnMesa,
  type LienzoEnMesa,
} from './mesa-contexto'

/**
 * El banco de trabajo: TODO lo que se armó, a la vez.
 *
 * Antes mostraba una pieza y las demás detrás de una ficha, así que de un pedido
 * de recompra —tres plantillas y una automatización— se veía una y había que
 * acordarse de que las otras existían. Lo que se está decidiendo es el conjunto:
 * si los tres mensajes dicen lo que tienen que decir Y si el árbol los usa donde
 * corresponde. Eso no se puede mirar de a una.
 *
 * Ahora se divide según lo que haya. La automatización es ancha y se lleva una
 * franja entera con su lienzo; los mensajes son angostos y van uno al lado del
 * otro, cada uno en su teléfono. Un solo scroll, ningún click para ver el resto.
 *
 * **Se abre cuando las piezas están listas, no antes.** Mientras el equipo
 * trabaja lo que se mira es la conversación, que va contando lo que hace.
 */
export function bancoTieneAlgo(m: EstadoMesa): boolean {
  if (m.fijado) return true
  return m.lienzos.length > 0 && !m.activo
}

export function Banco({ className }: { className?: string }) {
  const m = useMesa()
  const aLaMesa = useMesaDispatch()
  const t = useT()
  const fijado = m.fijado
  // Traer una pieza desde un paso es pedir ESA: mientras esté fijada, el banco
  // muestra sólo ella y con su salida a la pantalla de siempre.
  const piezas: LienzoEnMesa[] = fijado
    ? [{ key: fijado.capabilityKey, artefacto: fijado.artefacto }]
    : m.lienzos

  if (piezas.length === 0) {
    return (
      <section className={cn('relative flex min-w-0 flex-col bg-background', className)}>
        <div className="app-trama pointer-events-none absolute inset-0 opacity-70" aria-hidden />
        <BancoVacio />
      </section>
    )
  }

  // Un lienzo solo se queda con la pantalla entera: es lo que más se gana con
  // alto, y dibujar un árbol de nueve pasos dentro de una franja de 380px es
  // volver a la miniatura de la que veníamos.
  const soloLienzo = piezas.length === 1 && piezas[0].artefacto.kind === 'automatizacion'

  return (
    <section
      className={cn('relative flex min-w-0 flex-col overflow-hidden bg-background', className)}
    >
      {/* La trama sólo cuando NO hay un lienzo a pantalla completa:
          `CanvasViewport` dibuja la suya, y dos retículas de distinto paso una
          encima de otra se ven mal. */}
      {!soloLienzo && (
        <div className="app-trama pointer-events-none absolute inset-0 opacity-70" aria-hidden />
      )}
      <div className="app-halo pointer-events-none absolute inset-0 opacity-40" aria-hidden />

      {/* Encabezado sólo cuando hay una pieza fijada.
          Sin fijar decía «Así queda» sobre un panel que muestra cómo queda:
          cincuenta y seis píxeles de alto para no agregar nada, encima de unas
          piezas que ya llevan su nombre. Fijada sí hace falta — dice CUÁL es, y
          al lado viven la salida a su pantalla y la cruz para volver a verlas
          todas. */}
      {fijado && (
        <header className="relative z-20 flex h-14 shrink-0 items-center justify-between gap-4 border-b border-border px-5">
          <h2 className="app-page-title min-w-0 truncate text-[22px]">
            {nombreDe(fijado.artefacto) || t('operation.bancoVacioTitulo')}
          </h2>
          <div className="flex shrink-0 items-center gap-3">
            {fijado.real && fijado.entidadId && pantallaDe(fijado) && (
              <Link
                href={pantallaDe(fijado)!}
                className="app-card-cta text-[11px] text-accent-ink hover:underline"
              >
                {t('operation.mesaAbrirEnPantalla')}
                <ExternalLink className="size-3" />
              </Link>
            )}
            <button
              type="button"
              onClick={() => aLaMesa({ tipo: 'fijar', fijado: null })}
              className="rounded-lg p-1 text-muted-foreground transition-colors hover:text-foreground"
              aria-label={t('operation.mesaCerrar')}
            >
              <X className="size-4" />
            </button>
          </div>
        </header>
      )}

      {soloLienzo ? (
        <div className="relative z-10 min-h-0 flex-1">
          <Lienzo pieza={piezas[0].artefacto} />
        </div>
      ) : (
        <div className="relative z-10 min-h-0 flex-1 overflow-y-auto">
          <Reparto lienzos={piezas} />
        </div>
      )}
    </section>
  )
}

/**
 * Las piezas repartidas: lo ancho a lo ancho, lo angosto en fila.
 *
 * Un árbol y un mensaje no piden el mismo espacio. Meterlos en la misma grilla
 * deja a la automatización apretada y a los teléfonos estirados; separarlos por
 * forma es lo único que hace que las cuatro se lean.
 *
 * Desde que el panel también muestra LECTURAS, la lista se estira: una tabla de
 * pedidos y un tablero de integraciones piden ancho por lo mismo que un árbol,
 * y una ficha o un recibo entran en una columna como entra un teléfono.
 *
 * Se recorre `lienzos` y no una lista suelta de artefactos porque cada uno trae
 * de dónde salió, y eso es lo que titula el grupo. Antes se recorrían dos
 * listas en paralelo y el índice de una se usaba contra la otra: la segunda
 * pieza ancha se titulaba con el agente de la segunda pieza de la mesa, que
 * casi nunca era la misma.
 */
function Reparto({ lienzos }: { lienzos: LienzoEnMesa[] }) {
  const anchas = lienzos.filter((l) => esAncha(l.artefacto.kind))
  const angostas = lienzos.filter((l) => !esAncha(l.artefacto.kind))

  return (
    <div className="flex flex-col gap-6 p-5">
      {anchas.map((l, i) => (
        <section key={`ancha-${i}`} className="min-w-0">
          <Titulo lienzo={l} />
          {l.artefacto.kind === 'automatizacion' ? (
            // Alto acotado y con su propio zoom: dentro de una columna que ya
            // hace scroll, un lienzo que crece sin techo empuja todo lo demás
            // fuera de la pantalla.
            <div className="h-[360px] overflow-hidden rounded-xl border border-border">
              <Lienzo pieza={l.artefacto} />
            </div>
          ) : (
            <VistaArtefacto artefacto={l.artefacto} />
          )}
        </section>
      ))}

      {angostas.length > 0 && (
        <div className="flex flex-wrap items-start justify-center gap-6">
          {angostas.map((l, i) => (
            <div key={`angosta-${i}`} className="w-full max-w-[320px] shrink-0">
              {l.artefacto.kind === 'plantilla' ? (
                <>
                  {/* Aprobar un mensaje es mirar el mensaje. Es el mismo
                      teléfono que usa el editor de plantillas, así que los dos
                      no se pueden separar. */}
                  <p className="app-eyebrow mb-2 truncate text-center text-muted-foreground">
                    {l.artefacto.nombre}
                  </p>
                  <WhatsappPreview
                    headerType={l.artefacto.encabezado ? 'text' : 'none'}
                    headerText={l.artefacto.encabezado ?? undefined}
                    bodyText={l.artefacto.cuerpo}
                    footerText={l.artefacto.pie ?? undefined}
                    buttons={(l.artefacto.botones ?? []).map(aBoton)}
                  />
                </>
              ) : (
                <VistaArtefacto artefacto={l.artefacto} />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * De dónde salió esta pieza.
 *
 * El nombre propio gana siempre. Cuando no lo hay se cae al especialista que la
 * armó — pero SÓLO si lo hay, y no al dominio de la capacidad. Eso último se
 * probó y se vio en producción: `operacion.estado` daba `operation.subOperacion`,
 * que no existe en el catálogo, y el encabezado imprimía la clave cruda
 * («OPERATION.SUBOPERACION») sobre el tablero de salud.
 *
 * Y no hace falta: una vista de lectura ya lleva su título adentro del marco
 * («Cómo está la operación»), así que el encabezado no agregaba nada.
 */
function Titulo({ lienzo }: { lienzo: LienzoEnMesa }) {
  const t = useT()
  const texto = nombreDe(lienzo.artefacto) || (lienzo.agente ? t(`operation.sub${cap(lienzo.agente)}`) : '')
  if (!texto) return null
  return <h3 className="app-eyebrow mb-2 text-muted-foreground">{texto}</h3>
}

/** Las que piden una franja entera: un árbol, una tabla, un ida y vuelta. */
function esAncha(kind: Artefacto['kind']): boolean {
  return kind === 'automatizacion' || kind === 'flujo' || VISTAS_ANCHAS.has(kind)
}

function Lienzo({ pieza }: { pieza: Artefacto }) {
  if (pieza.kind !== 'automatizacion') return null
  return (
    <CanvasViewport className="h-full" initialFit="fit">
      <LienzoAutomatizacion cuando={pieza.cuando} pasos={pieza.pasos} />
    </CanvasViewport>
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

/**
 * Un botón del artefacto, como lo entiende el teléfono.
 *
 * El artefacto habla en castellano —«respuesta_rapida», «url»— porque es lo que
 * escribe el modelo; el preview habla el idioma de Meta. La traducción va acá y
 * no en el modelo: pedirle que escriba QUICK_REPLY es pedirle que acierte una
 * constante.
 */
function aBoton(b: { texto: string; tipo: string }): TemplateButtonInput {
  const tipo = b.tipo.toLowerCase()
  if (tipo === 'url') return { type: 'URL', text: b.texto }
  if (tipo === 'telefono' || tipo === 'phone_number') {
    return { type: 'PHONE_NUMBER', text: b.texto }
  }
  return { type: 'QUICK_REPLY', text: b.texto }
}

function nombreDe(a: Artefacto): string {
  return 'nombre' in a && typeof a.nombre === 'string' ? a.nombre : ''
}

/** El nombre del especialista, para cuando la pieza no trae uno. */
function cap(id: string): string {
  return `${id[0].toUpperCase()}${id.slice(1)}`
}

/**
 * A qué pantalla lleva esta pieza, si tiene una.
 *
 * Sólo las automatizaciones tenían salida: el resto se veía en el banco y se
 * quedaba ahí. Un agente y un segmento no la tienen porque no hay una pantalla
 * por id a la que ir, y un enlace que lleva a una lista no es abrir la pieza.
 */
const PANTALLA: Record<string, (id: string) => string> = {
  'automatizaciones.': (id) => `/automatizaciones/${toShortId(id)}/editar`,
  'plantillas.': (id) => `/plantillas/${toShortId(id)}`,
  'campanas.': (id) => `/campanas/${toShortId(id)}`,
  // El menú se pide por su id entero: su pantalla lo busca por la API y no
  // por columna, así que el id corto no resolvería.
  'flujos.': (id) => `/menus/${id}`,
  // El producto resuelve por id entero o por handle, no por id corto.
  'productos.': (id) => `/productos/${id}`,
}

function pantallaDe(f: FijadoEnMesa): string | null {
  const armar = Object.entries(PANTALLA).find(([p]) => f.capabilityKey.startsWith(p))?.[1]
  return armar && f.entidadId ? armar(f.entidadId) : null
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
