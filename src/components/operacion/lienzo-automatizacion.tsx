'use client'

import { Fragment } from 'react'
import Image from 'next/image'
import {
  BranchFan,
  HEAD_H,
  LINE,
  STEP_META,
} from '@/components/automations/lienzo-piezas'
import type { BuilderStepType } from '@/components/automations/automation-builder'
import { useT } from '@/hooks/use-locale'
import { cn } from '@/lib/utils'
import type { PasoArtefacto } from '@/lib/operator/artifacts'

/**
 * La automatización sobre el banco, con las MISMAS piezas que su editor.
 *
 * No es el editor —son cuatro mil líneas con arrastre, nueve contextos y un
 * guardado que navega— pero tampoco es un dibujo aparte: el mapa de estilos por
 * tipo de paso y el abanico de ramas se importan de `lienzo-piezas.tsx`, que es
 * de donde los toma el editor. Las tarjetas son las mismas, con los mismos
 * colores, los mismos iconos y el mismo alto. Una copia propia se habría
 * separado el primer día que alguien tocara un color, y entonces el chat
 * mostraría algo parecido en vez de lo mismo.
 *
 * Lo único que cambia es que acá no se puede tocar nada: sin asa, sin acordeón
 * y sin el «+ Añadir» entre paso y paso, que se reemplaza por el tramo de línea
 * que ese botón dibujaba.
 */
export function LienzoAutomatizacion({
  cuando,
  pasos,
}: {
  /** Cuándo se dispara, en palabras. */
  cuando: string
  pasos: PasoArtefacto[]
}) {
  return (
    <div className="flex w-max items-start gap-0 px-8 py-10">
      <Disparador cuando={cuando} />
      <Tramo pasos={pasos} />
    </div>
  )
}

/** La tarjeta del disparador, con la misma cabecera que las demás. */
function Disparador({ cuando }: { cuando: string }) {
  const t = useT()
  return (
    <div className="z-10 w-full max-w-[320px] sm:w-80">
      <div className="rounded-lg border border-border border-l-4 border-l-emerald-500 bg-card shadow-lg">
        <div className="flex h-[78px] w-full items-center gap-3 px-4 py-3 text-left">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-white">
            <Image src="/channels/shopify.svg" alt="" width={22} height={22} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[11px] tracking-wide text-emerald-700 uppercase dark:text-emerald-300">
              {t('automations.triggerEyebrow')}
            </div>
            <div className="truncate text-sm font-medium text-foreground">{cuando}</div>
          </div>
        </div>
      </div>
    </div>
  )
}

/**
 * Una cadena de preguntas sobre lo mismo es UNA pregunta de varios caminos.
 *
 * El editor lo hace al cargar (`collapseSwitch`): tres «¿tiene la etiqueta X?»
 * encadenadas por el NO se dibujan como una sola tarjeta «Condición» con tres
 * carriles y un «en otro caso». El chat las dibujaba encadenadas, así que la
 * misma automatización se veía distinta en los dos lados — y la del chat se
 * leía peor, con cada pregunta escondida dentro del NO de la anterior.
 *
 * La regla es la misma de allá: se pliega mientras cada camino sea una lista
 * plana. Si un camino vuelve a ramificar, se queda como está y no se esconde
 * ningún paso.
 */
export interface Plegado {
  caminos: { pregunta: string; pasos: PasoArtefacto[] }[]
  otroCaso: PasoArtefacto[]
}

const esHoja = (p: PasoArtefacto) => !p.si?.length && !p.no?.length
const todoHoja = (l: PasoArtefacto[]) => l.every(esHoja)

export function plegar(p: PasoArtefacto): Plegado | null {
  if (p.tipo !== 'condition') return null
  const caminos: Plegado['caminos'] = []
  let actual: PasoArtefacto | undefined = p

  while (actual && actual.tipo === 'condition') {
    const si: PasoArtefacto[] = actual.si ?? []
    if (!todoHoja(si)) return null
    caminos.push({ pregunta: actual.resumen, pasos: si })
    const no: PasoArtefacto[] = actual.no ?? []
    // El NO lleva a otra pregunta y a nada más: sigue la cadena.
    if (no.length === 1 && no[0].tipo === 'condition') {
      actual = no[0]
      continue
    }
    if (!todoHoja(no)) return null
    return caminos.length > 1 ? { caminos, otroCaso: no } : null
  }
  return null
}

/** Una cadena de pasos que corren uno tras otro, de izquierda a derecha. */
function Tramo({ pasos }: { pasos: PasoArtefacto[] }) {
  const t = useT()
  if (pasos.length === 0) {
    return (
      <div className={cn('flex items-center', HEAD_H)}>
        <span className={cn('w-6', LINE)} style={{ height: 2 }} aria-hidden />
        <span className="rounded-lg border border-dashed border-border px-3 py-2 text-[11px] text-muted-foreground">
          {t('operation.lienzoNadaAqui')}
        </span>
      </div>
    )
  }

  return (
    <div className="flex items-start">
      {pasos.map((p, i) => {
        const plegado = plegar(p)
        const esCondicion = p.tipo === 'condition' && Boolean(p.si?.length || p.no?.length)
        return (
          <Fragment key={`${p.tipo}-${i}`}>
            <Cable />
            {plegado ? (
              <div className="z-10 flex items-start gap-2">
                <Tarjeta
                  paso={p}
                  titulo={t('automations.stepCondition')}
                  resumen={t('automations.switchCaseOther', {
                    n: plegado.caminos.length,
                  })}
                />
                <BranchFan
                  lanes={[
                    ...plegado.caminos.map((c, n) => ({
                      key: `c${n}`,
                      label: c.pregunta,
                      color: 'border-emerald-500/40 bg-emerald-500/10 text-accent-ink',
                      content: <Tramo pasos={c.pasos} />,
                    })),
                    {
                      key: 'otro',
                      label: t('automations.switchElse'),
                      color: 'border-slate-400/40 bg-slate-400/10 text-muted-foreground',
                      content: <Tramo pasos={plegado.otroCaso} />,
                    },
                  ]}
                />
              </div>
            ) : esCondicion ? (
              <div className="z-10 flex items-start gap-2">
                <Tarjeta paso={p} />
                <BranchFan
                  lanes={[
                    {
                      key: 'yes',
                      label: t('automations.branchYes'),
                      color: 'border-emerald-500/40 bg-emerald-500/10 text-accent-ink',
                      content: <Tramo pasos={p.si ?? []} />,
                    },
                    {
                      key: 'no',
                      label: t('automations.branchNo'),
                      color: 'border-rose-500/40 bg-rose-500/10 text-rose-600 dark:text-rose-400',
                      content: <Tramo pasos={p.no ?? []} />,
                    },
                  ]}
                />
              </div>
            ) : (
              <div className="z-10">
                <Tarjeta paso={p} />
              </div>
            )}
          </Fragment>
        )
      })}
    </div>
  )
}

/**
 * Una tarjeta de paso, en modo lectura.
 *
 * Misma caja, mismo borde de color, misma pastilla de icono y la misma
 * cabecera de 78 px que en el editor. Lo que cambia: el título sale del mapa
 * compartido y el renglón de abajo es el resumen que ya trae el artefacto —
 * «Espera 15 días», «¿Tiene la etiqueta «comprador»?»— en vez de recalcularlo.
 */
function Tarjeta({
  paso,
  titulo,
  resumen,
}: {
  paso: PasoArtefacto
  /** Para el nodo plegado, que no dice una pregunta sino cuántos caminos hay. */
  titulo?: string
  resumen?: string
}) {
  const t = useT()
  const meta = STEP_META[paso.tipo as BuilderStepType] ?? STEP_META.send_message
  const Icono = meta.icon
  const quitado = paso.cambio === 'quitado'

  return (
    <div className={cn('flex w-full max-w-[320px] flex-col sm:w-80', quitado && 'opacity-40')}>
      <div
        className={cn(
          'rounded-lg border border-border border-l-4 bg-card shadow-lg',
          meta.border,
          // El diff, con el lenguaje del artefacto: lo nuevo se destaca, lo que
          // se va queda tachado y a media luz.
          (paso.cambio === 'nuevo' || paso.cambio === 'editado') && 'ring-1 ring-accent-ink/40',
        )}
      >
        <div className="flex h-[78px] w-full items-center gap-3 px-4 py-3 text-left">
          <div
            className={cn(
              'flex h-9 w-9 items-center justify-center rounded-lg',
              meta.iconBg,
              meta.iconText,
            )}
          >
            {meta.brand === 'whatsapp' ? (
              <Image src="/channels/whatsapp.svg" alt="" width={20} height={20} />
            ) : meta.brand === 'shopify' ? (
              <Image src="/channels/shopify.svg" alt="" width={20} height={20} />
            ) : (
              <Icono className="h-4 w-4" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[11px] tracking-wide text-muted-foreground uppercase">
              {paso.tipo === 'condition'
                ? t('automations.kindCondition')
                : paso.tipo === 'wait'
                  ? t('automations.kindWait')
                  : t('automations.kindAction')}
            </div>
            <div className="truncate text-sm font-medium text-foreground">
              {titulo ?? t(meta.label)}
            </div>
            {paso.antes && (
              <div className="truncate text-[11px] text-muted-foreground line-through">
                {paso.antes}
              </div>
            )}
            <div className={cn('truncate text-[11px] text-muted-foreground', quitado && 'line-through')}>
              {resumen ?? paso.resumen}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

/**
 * El tramo entre dos tarjetas.
 *
 * En el editor este espacio lo ocupa el «+ Añadir», que además de botón es el
 * cable. Sin él las tarjetas quedaban sueltas y había que adivinar qué seguía a
 * qué, así que acá va el cable solo, del mismo grosor y del mismo color.
 */
function Cable() {
  return (
    <div className={cn('flex items-center', HEAD_H)} aria-hidden>
      <span className={cn('w-6', LINE)} style={{ height: 2 }} />
    </div>
  )
}
