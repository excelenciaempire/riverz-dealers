import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { ROSTER, SIN_DUENO } from '@/lib/operator/fleet/roster'
import { KINDS_ARTEFACTO } from '@/lib/operator/artifacts'
import { AUTOMATION_TEMPLATES } from '@/lib/automations/templates'
import type { PasoArtefacto } from '@/lib/operator/artifacts'
import { ALL_CAPABILITIES } from './registry'

/** Cuenta el árbol entero, ramas incluidas. */
function contar(pasos: PasoArtefacto[]): number {
  return pasos.reduce((n, p) => n + 1 + contar(p.si ?? []) + contar(p.no ?? []), 0)
}

/**
 * El contrato que hace usable una capacidad desde el Operador.
 *
 * Son tres cosas y las tres se rompieron en producción al menos una vez:
 *
 *  1. Si cambia algo, tiene que poder DESCRIBIR lo que haría. Es lo que la
 *     persona lee antes de aprobar.
 *  2. Esa descripción nunca puede ser una excusa. Una vista previa que explica
 *     por qué no se puede igual termina en una tarjeta con botón de aprobar, y
 *     quien la mira no tiene forma de saber que ese botón no hace nada. Hubo
 *     dos así en una cuenta real y 36 caminos que podían producirlas.
 *  3. Tiene que ser de alguien del equipo, o estar declarada huérfana a
 *     propósito. Una capacidad sin dueño no la puede llamar nadie.
 */

const DIR = 'src/lib/capabilities'

const fuentes = readdirSync(DIR)
  .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
  .map((f) => [f, readFileSync(join(DIR, f), 'utf8')] as const)

describe('el contrato de una capacidad', () => {
  it('todo lo que escribe sabe decir qué haría', () => {
    const mudas = ALL_CAPABILITIES.filter((c) => c.risk !== 'lectura' && !c.preview).map(
      (c) => c.key,
    )
    expect(mudas).toEqual([])
  })

  it('una lectura no propone nada, así que no necesita vista previa', () => {
    const sobra = ALL_CAPABILITIES.filter((c) => c.risk === 'lectura' && c.preview).map(
      (c) => c.key,
    )
    expect(sobra).toEqual([])
  })

  it('cada una es de alguien del equipo', () => {
    const prefijos = ROSTER.flatMap((s) => s.capacidades)
    const huerfanas = ALL_CAPABILITIES.filter(
      (c) => !SIN_DUENO[c.key] && !prefijos.some((p) => c.key.startsWith(p)),
    ).map((c) => c.key)
    expect(huerfanas).toEqual([])
  })
})

/**
 * Ninguna vista previa devuelve una excusa.
 *
 * Se lee el código y no se ejecuta a propósito: correr las 37 contra una cuenta
 * vacía las llevaría a pedirle cosas a Shopify y a Meta, y una prueba que
 * depende de la red no dice nada el día que falla.
 */
describe('las vistas previas', () => {
  const NEGACION =
    /^(no |nada |todav[íi]a no|ese |esa |eso |falta|hace falta|primero |sin |«?…»? (no|todav))/i

  it('describen lo que pasaría, nunca por qué no se puede', () => {
    const malas: string[] = []
    for (const [archivo, src] of fuentes) {
      const lineas = src.split('\n')
      for (const m of src.matchAll(
        /^(\s*)(?:async )?(preview\w*)\(|^async function (preview\w+)\(/gm,
      )) {
        const ini = src.slice(0, m.index).split('\n').length - 1
        const sangria = (m[1] ?? '').length
        let fin = ini + 1
        while (fin < lineas.length) {
          const l = lineas[fin]
          if (l.trim() && l.length - l.trimStart().length <= sangria && l.trim().startsWith('}')) break
          fin++
        }
        for (let n = ini; n <= Math.min(fin, lineas.length - 1); n++) {
          const r = lineas[n].match(/\breturn (?:\(e as Error\)\.message|[`'"](.+))/)
          if (!r) continue
          if (r[1] === undefined) {
            malas.push(`${archivo}:${n + 1} devuelve el mensaje de una excepción`)
            continue
          }
          const plano = r[1].replace(/\$\{[^}]*\}/g, '…').trim().replace(/[`'"]$/, '')
          if (NEGACION.test(plano) || /no se puede/i.test(plano)) {
            malas.push(`${archivo}:${n + 1} «${plano.slice(0, 60)}»`)
          }
        }
      }
    }
    expect(malas).toEqual([])
  })
})

/**
 * Un tipo de pieza que nadie produce es un dibujo que no se ve nunca.
 *
 * `campana` estuvo así desde el primer día: declarado en la unión, dibujable
 * por el banco, y sin una sola capacidad que lo llenara. Armar una campaña
 * dejaba el panel vacío.
 */
describe('las piezas que el banco sabe dibujar', () => {
  /**
   * Lo que deja una pieza, la dibuja.
   *
   * La asimetría estaba al revés de lo que sirve: `editar` dibujaba y `crear`
   * no, cuando el momento en que más falta hace ver qué te van a dejar es
   * justo el de crearlo. Elegir una lista para usar, armar un agente, guardar
   * un segmento o armar una campaña dejaban el panel vacío.
   */
  const DEJAN_PIEZA = [
    'automatizaciones.crear',
    'automatizaciones.crear_desde_receta',
    'automatizaciones.editar',
    'automatizaciones.editar_espera',
    'comentarios.crear_regla',
    'agentes.crear_borrador',
    'agentes.editar',
    'segmentos.crear',
    'segmentos.editar',
    'plantillas.crear_borrador',
    'plantillas.enviar_a_meta',
    'campanas.crear',
    'flujos.editar',
  ]

  it('lo que deja una pieza sabe dibujarla', () => {
    const mudas = DEJAN_PIEZA.filter(
      (k) => !ALL_CAPABILITIES.find((c) => c.key === k)?.artifact,
    )
    expect(mudas).toEqual([])
  })

  it('una lista para usar se dibuja entera, con sus ramas', () => {
    // Las semillas de una receta se guardan planas, apuntando a su condición
    // padre por índice. El dibujo necesita el árbol.
    const cap = ALL_CAPABILITIES.find((c) => c.key === 'automatizaciones.crear_desde_receta')!
    const ctx = { workspaceId: 'ws', locale: 'es' } as never
    for (const [slug, receta] of Object.entries(AUTOMATION_TEMPLATES)) {
      const art = cap.artifact!(ctx, { receta: slug }, undefined)
      expect(art, slug).toBeTruthy()
      expect(art!.kind, slug).toBe('automatizacion')
      const { pasos } = art as { pasos: PasoArtefacto[] }
      // El tronco tiene al menos un paso, y ninguna semilla se pierde en el
      // camino de lista plana a árbol.
      expect(pasos.length, slug).toBeGreaterThan(0)
      expect(contar(pasos), slug).toBe(receta.steps.length)
    }
  })

  it('todas tienen quién las produzca', () => {
    // Se busca en las capacidades y en los constructores que usan: el árbol de
    // una automatización lo arma `ai-steps`, no el archivo de la capacidad.
    const juntas = [
      ...fuentes.map(([, s]) => s),
      ...['ai-steps.ts', 'ai-patches.ts'].map((f) =>
        readFileSync(join('src/lib/automations', f), 'utf8'),
      ),
    ].join('\n')
    const sinProductor = [...KINDS_ARTEFACTO].filter(
      (k) => !juntas.includes(`kind: '${k}'`),
    )
    expect(sinProductor).toEqual([])
  })
})
