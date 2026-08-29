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
    'plantillas.crear',
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

/**
 * Las que todavía no dibujan nada.
 *
 * El panel del Operador mostraba ocho de ciento diez capacidades: todo lo demás
 * contestaba un párrafo y dejaba el lienzo vacío. La lista de abajo es lo que
 * falta, y está para achicarse: cada vez que una capacidad aprende a dibujarse,
 * su clave sale de acá.
 *
 * Es una lista explícita y no un `.skip` a propósito. Un test salteado se
 * olvida; una lista que hay que editar para agregar una capacidad nueva obliga
 * a decidir, en ese momento, qué muestra el panel cuando alguien la llame.
 */
const SIN_DIBUJO = new Set<string>([
  'aprobaciones.pendientes',
  'aprobaciones.decidir',
  'bandeja.decidir_devolucion',
  'bandeja.reclamos',
  'bandeja.devoluciones',
  'bandeja.huecos',
  'bandeja.atajos',
  'bandeja.crear_atajo',
  'bandeja.filtros',
  'bandeja.reparto',
  'bandeja.activar_reparto',
  'campanas.enlaces',
  'campanas.lanzar',
  'campanas.detalle',
  'comentarios.activar_regla',
  'contactos.buscar',
  'flujos.corridas',
  'flujos.listar',
  'flujos.detalle',
  'flujos.activar',
  'conversaciones.detalle',
  'conversaciones.asignar',
  'conversaciones.cerrar',
  'conversaciones.ia',
  'conversaciones.aprobar_borrador',
  'conversaciones.pendientes',
  'integraciones.desconectar',
  'mensajes.diagnostico',
  'mensajes.enviar',
  'pedidos.entregas',
  'pedidos.carritos',
  'pedidos.pagos_rechazados',
  'pedidos.registrar_pago',
  'productos.responder_hueco',
  'prospeccion.campanas',
  'prospeccion.audiencia',
  'prospeccion.crear_campana',
  'prospeccion.lanzar',
])

describe('lo que el panel del Operador puede mostrar', () => {
  it('toda capacidad dibuja algo, o está declarada como pendiente', () => {
    const mudas = ALL_CAPABILITIES.filter((c) => {
      // Una LECTURA se dibuja desde su resultado (`vista`); lo que ESCRIBE se
      // dibuja desde sus argumentos (`artifact`), porque tiene que verse antes
      // de aprobarlo. No son intercambiables.
      const dibuja = c.risk === 'lectura' ? Boolean(c.vista) : Boolean(c.artifact)
      return !dibuja && !SIN_DIBUJO.has(c.key)
    }).map((c) => c.key)
    expect(mudas).toEqual([])
  })

  it('la lista de pendientes no tiene claves que ya no existen', () => {
    // Sin esto la lista sólo crece: una capacidad renombrada deja su clave
    // vieja adentro y tapa para siempre a la nueva.
    const claves = new Set(ALL_CAPABILITIES.map((c) => c.key))
    const fantasmas = [...SIN_DIBUJO].filter((k) => !claves.has(k))
    expect(fantasmas).toEqual([])
  })

  it('la lista de pendientes no tapa a una que ya dibuja', () => {
    const yaDibujan = ALL_CAPABILITIES.filter(
      (c) => SIN_DIBUJO.has(c.key) && (c.risk === 'lectura' ? c.vista : c.artifact),
    ).map((c) => c.key)
    expect(yaDibujan).toEqual([])
  })
})

describe('una vista no puede romperse con lo que le llegue', () => {
  /**
   * El modo real de romper el panel.
   *
   * `vistaDe` traga la excepción, así que una vista que revienta no se ve como
   * un error: se ve como un panel vacío, que es indistinguible de "no había
   * nada". Una cuenta sin pedidos, una consulta sin resultados y una tabla que
   * volvió `null` tienen que dibujar algo o devolver `null` a propósito.
   */
  const VACIOS: unknown[] = [null, undefined, {}, [], { filas: null }, { datos: [] }]

  it('sobrevive a un resultado vacío', () => {
    const ctx = { db: null, workspaceId: 'w', actor: { type: 'operator' as const }, locale: 'es' as const }
    const rotas: string[] = []
    for (const cap of ALL_CAPABILITIES) {
      if (!cap.vista) continue
      for (const v of VACIOS) {
        try {
          cap.vista(ctx as never, {}, v)
        } catch {
          rotas.push(`${cap.key} ← ${JSON.stringify(v) ?? 'undefined'}`)
        }
      }
    }
    expect(rotas).toEqual([])
  })
})
