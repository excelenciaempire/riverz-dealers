'use client'

import { useState } from 'react'
import { Check, ExternalLink, Loader2, PanelRightClose, Users, X } from 'lucide-react'
import Link from '@/components/i18n/locale-link'
import { toShortId } from '@/lib/short-id'
import { useT } from '@/hooks/use-locale'
import { cn } from '@/lib/utils'
import { VistaArtefacto } from './artefacto'
import { MapaEquipo } from './mapa-equipo'
import { TextoRico } from '@/components/ui/texto-rico'
import {
  mesaTieneAlgo,
  useMesa,
  useMesaDispatch,
  type AgenteEnMesa,
  type FijadoEnMesa,
} from './mesa-contexto'

/**
 * La mesa de trabajo: qué está armando el equipo, ahora.
 *
 * No es un registro de actividad. Es la pieza que se está tocando, dibujada, y
 * cambiando mientras la tocan. Para "actualizá el carrito abandonado" no
 * alcanza con redibujar el árbol —quien mira ya conocía esa automatización—
 * así que lo que se ve es el diff: lo que estaba atenuado, lo nuevo encendido,
 * lo que se va tachado.
 *
 * Sólo aparece cuando hay algo que mostrar. Una barra vacía al costado de un
 * chat vacío es ruido, y en una cuenta nueva sería lo único que se ve.
 */
export function Mesa() {
  const m = useMesa()
  const aLaMesa = useMesaDispatch()
  const t = useT()
  const [abierta, setAbierta] = useState(true)
  const [enCajon, setEnCajon] = useState(false)

  if (!mesaTieneAlgo(m)) return null

  const cuerpo = (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="flex shrink-0 items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <Users className="size-4 text-accent-ink" />
          <h2 className="text-sm font-semibold text-foreground">{t('operation.mesaTitulo')}</h2>
          {m.activo && (
            <span className="relative flex size-2" aria-hidden>
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-accent-ink opacity-60" />
              <span className="relative inline-flex size-2 rounded-full bg-accent-ink" />
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={() => (enCajon ? setEnCajon(false) : setAbierta(false))}
          className="rounded-lg p-1 text-muted-foreground transition-colors hover:text-foreground"
          aria-label={t('operation.mesaCerrar')}
        >
          {enCajon ? <X className="size-4" /> : <PanelRightClose className="size-4" />}
        </button>
      </header>

      <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
        {/* Lo que alguien pidió mirar. Va arriba de todo: es lo que fue a
            buscar, y lo que el equipo esté haciendo puede esperar. */}
        {m.fijado && <VistaFijado fijado={m.fijado} onCerrar={() => aLaMesa({ tipo: 'fijar', fijado: null })} />}

        {/* El plan NO se repite acá. Estaba, y quedaba palabra por palabra al
            lado de la tarjeta del hilo, que además es la que tiene los
            botones: dos veces el mismo párrafo en la misma pantalla. Lo que
            va acá es quién está trabajando, que es otra cosa. */}
        {/* Con un plan corriendo, el mapa: lo que va junto se ve junto y lo
            que espera se ve esperando, que es lo único que hace falta saber
            mientras se espera. Sin plan es una sola delegación, y ahí un mapa
            de un nodo dice menos que la línea de lo que está haciendo. */}
        {m.plan && m.agentes.length > 0 ? (
          <MapaEquipo plan={m.plan} agentes={m.agentes} activo={m.activo} />
        ) : (
          m.agentes.length > 0 && (
            <section className="space-y-1.5">
              {m.agentes.map((a) => (
                <FilaAgente key={a.id} agente={a} />
              ))}
            </section>
          )
        )}

        {/* Los lienzos van al final y no arriba: mientras el equipo trabaja, lo
            que se mira es quién está haciendo qué; el dibujo importa cuando ya
            hay algo dibujado. */}
        {m.lienzos.map((l) => (
          <section key={`${l.agente}-${l.paso ?? 'x'}`} className="space-y-1.5">
            <p className="app-eyebrow">{l.agente}</p>
            <VistaArtefacto artefacto={l.artefacto} />
          </section>
        ))}
      </div>

      {/* El gasto en tokens no va acá. A quien vende no le dice nada y la
          palabra misma es de las que no usaría nunca; el consumo real se mira
          en /admin, que es donde importa. */}
    </div>
  )

  return (
    <>
      {/* Columna en flujo, nunca fija: el ancho del menú de la izquierda es
          estado local del shell y no está expuesto en ningún contexto, así que
          un panel fijo no tendría contra qué calcular su posición.

          Desde `lg` y no desde `xl`: en una tablet apaisada o en un portátil
          chico sobraba el ancho y el panel no aparecía igual. Estrecho en `lg`,
          más cómodo desde `xl`. */}
      {abierta && (
        <aside className="hidden w-80 shrink-0 border-l border-border bg-card lg:block xl:w-96">
          {cuerpo}
        </aside>
      )}

      {/* Debajo de `lg` no queda rail sin ahogar la conversación, así que es un
          cajón a pantalla completa, con su propio scroll y respetando el área
          segura del teléfono. */}
      {enCajon && (
        <div className="fixed inset-0 z-50 flex lg:hidden">
          <button
            type="button"
            className="flex-1 bg-black/60 backdrop-blur-sm"
            onClick={() => setEnCajon(false)}
            aria-label={t('operation.mesaCerrar')}
          />
          <div className="w-[min(24rem,90vw)] border-l border-border bg-card pb-[env(safe-area-inset-bottom)]">
            {cuerpo}
          </div>
        </div>
      )}

      {/* La forma de traerla de vuelta. Sin esto, cerrarla una vez la esconde
          para siempre y parece que se rompió.

          Son DOS botones y los esconde el CSS, no un `if`. Antes uno solo
          decidía con `window.innerWidth >= 1280`, que se lee una vez: girar el
          teléfono o cambiar el tamaño de la ventana lo dejaba abriendo el panel
          equivocado. */}
      {!abierta && (
        <BotonVer
          className="hidden lg:inline-flex"
          activo={m.activo}
          onClick={() => setAbierta(true)}
        />
      )}
      {!enCajon && (
        <BotonVer className="lg:hidden" activo={m.activo} onClick={() => setEnCajon(true)} />
      )}
    </>
  )
}

function BotonVer({
  className,
  activo,
  onClick,
}: {
  className?: string
  activo: boolean
  onClick: () => void
}) {
  const t = useT()
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'fixed right-4 bottom-24 z-40 items-center gap-1.5 rounded-full border border-border bg-card px-3 py-2 text-xs shadow-sm transition-colors hover:text-foreground',
        className,
      )}
    >
      <Users className="size-3.5 text-accent-ink" />
      {t('operation.mesaVer')}
      {activo && <span className="size-1.5 animate-pulse rounded-full bg-accent-ink" aria-hidden />}
    </button>
  )
}

function FilaAgente({ agente }: { agente: AgenteEnMesa }) {
  const Icono =
    agente.estado === 'trabajando' ? Loader2 : agente.estado === 'listo' ? Check : X
  return (
    <div
      className={cn(
        'rounded-lg border px-3 py-2',
        agente.estado === 'fallido'
          ? 'border-red-500/30 bg-red-500/5'
          : agente.estado === 'listo'
            ? 'border-accent-ink/25 bg-primary/5'
            : 'border-border bg-background',
      )}
    >
      <div className="flex items-center gap-2">
        <Icono
          className={cn(
            'size-3.5 shrink-0',
            agente.estado === 'trabajando' && 'animate-spin text-muted-foreground',
            agente.estado === 'listo' && 'text-accent-ink',
            agente.estado === 'fallido' && 'text-red-600 dark:text-red-400',
          )}
        />
        <span className="text-xs font-medium text-foreground">{agente.id}</span>
        {(agente.propuestas > 0 || agente.construidas > 0) && (
          <span className="ml-auto text-[10px] text-muted-foreground tabular-nums">
            {agente.construidas > 0 && `${agente.construidas} ✓`}
            {agente.propuestas > 0 && ` ${agente.propuestas} ⏳`}
          </span>
        )}
      </div>
      {agente.ultima && (
        <div className="mt-1 line-clamp-2 text-[11px] leading-snug text-muted-foreground">
          <TextoRico text={agente.ultima} />
        </div>
      )}
    </div>
  )
}

/**
 * Cómo quedó lo que se construyó, sin salir del chat.
 *
 * El dibujo viene del servidor leído de la BASE, no del artefacto que se
 * calculó al proponerlo. Cuando no se pudo leer —porque ya no está— se dice,
 * en vez de mostrar lo propuesto como si fuera lo guardado.
 */
function VistaFijado({
  fijado,
  onCerrar,
}: {
  fijado: FijadoEnMesa
  onCerrar: () => void
}) {
  const t = useT()
  const esAutomatizacion = fijado.capabilityKey.startsWith('automatizaciones.')
  return (
    <section className="space-y-2 rounded-xl border border-accent-ink/30 bg-primary/5 p-3">
      <div className="flex items-start justify-between gap-2">
        <p className="app-eyebrow">{t('operation.mesaVerComoQuedo')}</p>
        <button
          type="button"
          onClick={onCerrar}
          className="rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground"
          aria-label={t('operation.mesaCerrar')}
        >
          <X className="size-3.5" />
        </button>
      </div>
      <VistaArtefacto artefacto={fijado.artefacto} />
      {!fijado.real && (
        <p className="text-[11px] leading-snug text-muted-foreground">
          {t('operation.mesaEsLoPropuesto')}
        </p>
      )}
      {fijado.real && esAutomatizacion && fijado.entidadId && (
        <Link
          href={`/automatizaciones/${toShortId(fijado.entidadId)}/editar`}
          className="inline-flex items-center gap-1 text-[11px] font-medium text-accent-ink hover:underline"
        >
          {t('operation.mesaAbrirEnPantalla')}
          <ExternalLink className="size-3" />
        </Link>
      )}
    </section>
  )
}
