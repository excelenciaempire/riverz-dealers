import { describe, expect, it } from 'vitest'

import { KINDS_ARTEFACTO, esArtefacto, type Artefacto } from './artifacts'
import { conDiff } from './artifacts-diff'

/**
 * El diff que hace útil al panel derecho.
 *
 * Lo que se prueba no es que marque cosas: es que marque POCAS. Un diff que
 * ante un cambio chico enciende medio árbol es peor que no tener diff, porque
 * obliga a leer todo igual y además miente sobre cuánto se tocó.
 */

const auto = (pasos: { tipo: string; resumen: string }[]): Artefacto => ({
  kind: 'automatizacion',
  nombre: 'Carrito abandonado',
  cuando: 'alguien deja un carrito',
  pasos,
})

describe('cuando no hay con qué comparar', () => {
  it('una creación no marca nada', () => {
    // Marcar todo como nuevo es tanto ruido como no marcar nada.
    const nuevo = auto([{ tipo: 'wait', resumen: 'Espera 1 h' }])
    expect(conDiff(null, nuevo)).toEqual(nuevo)
  })

  it('comparar cosas de distinto tipo no marca nada', () => {
    const plantilla: Artefacto = {
      kind: 'plantilla',
      nombre: 'carrito_v1',
      categoria: 'Marketing',
      idioma: 'es',
      cuerpo: 'Hola',
    }
    expect(conDiff(auto([]), plantilla)).toEqual(plantilla)
  })
})

describe('automatizaciones', () => {
  it('un paso agregado al medio marca sólo ese paso', () => {
    // Es la prueba central. Emparejar por posición marcaría dos cambios donde
    // hubo uno, y el que mira tendría que releer el árbol entero.
    const previo = auto([
      { tipo: 'wait', resumen: 'Espera 1 h' },
      { tipo: 'send_template', resumen: 'Manda carrito_v1' },
    ])
    const nuevo = auto([
      { tipo: 'wait', resumen: 'Espera 1 h' },
      { tipo: 'add_tag', resumen: 'Etiqueta carrito-abandonado' },
      { tipo: 'send_template', resumen: 'Manda carrito_v1' },
    ])
    const r = conDiff(previo, nuevo)
    expect(r.kind === 'automatizacion' && r.pasos.map((p) => p.cambio)).toEqual([
      'igual',
      'nuevo',
      'igual',
    ])
  })

  it('un texto cambiado queda editado y conserva lo que decía', () => {
    const previo = auto([{ tipo: 'send_message', resumen: 'Dice: hola' }])
    const nuevo = auto([{ tipo: 'send_message', resumen: 'Dice: buenas' }])
    const r = conDiff(previo, nuevo)
    if (r.kind !== 'automatizacion') throw new Error('tipo inesperado')
    expect(r.pasos[0].cambio).toBe('editado')
    expect(r.pasos[0].antes).toBe('Dice: hola')
  })

  it('un paso borrado queda al final, tachado', () => {
    // Al final para no correr de lugar lo que sigue existiendo: la lista tiene
    // que leerse como el resultado, con lo borrado colgando.
    const previo = auto([
      { tipo: 'wait', resumen: 'Espera 1 h' },
      { tipo: 'add_tag', resumen: 'Etiqueta vip' },
    ])
    const nuevo = auto([{ tipo: 'wait', resumen: 'Espera 1 h' }])
    const r = conDiff(previo, nuevo)
    if (r.kind !== 'automatizacion') throw new Error('tipo inesperado')
    expect(r.pasos.map((p) => p.cambio)).toEqual(['igual', 'quitado'])
    expect(r.pasos[1].resumen).toBe('Etiqueta vip')
  })

  it('un paso que se mueve de lugar no cuenta como cambio', () => {
    const previo = auto([
      { tipo: 'add_tag', resumen: 'Etiqueta vip' },
      { tipo: 'wait', resumen: 'Espera 1 h' },
    ])
    const nuevo = auto([
      { tipo: 'wait', resumen: 'Espera 1 h' },
      { tipo: 'add_tag', resumen: 'Etiqueta vip' },
    ])
    const r = conDiff(previo, nuevo)
    if (r.kind !== 'automatizacion') throw new Error('tipo inesperado')
    expect(r.pasos.every((p) => p.cambio === 'igual')).toBe(true)
  })

  it('dos esperas iguales no se cruzan entre sí', () => {
    // Del mismo contenido se elige la más cercana en posición; si no, cambiar
    // la segunda marcaría la primera.
    const previo = auto([
      { tipo: 'wait', resumen: 'Espera 1 h' },
      { tipo: 'send_message', resumen: 'Dice: hola' },
      { tipo: 'wait', resumen: 'Espera 1 h' },
    ])
    const nuevo = auto([
      { tipo: 'wait', resumen: 'Espera 1 h' },
      { tipo: 'send_message', resumen: 'Dice: buenas' },
      { tipo: 'wait', resumen: 'Espera 1 h' },
    ])
    const r = conDiff(previo, nuevo)
    if (r.kind !== 'automatizacion') throw new Error('tipo inesperado')
    expect(r.pasos.map((p) => p.cambio)).toEqual(['igual', 'editado', 'igual'])
  })

  it('sin cambios, nada se enciende', () => {
    const pasos = [
      { tipo: 'wait', resumen: 'Espera 1 h' },
      { tipo: 'send_template', resumen: 'Manda carrito_v1' },
    ]
    const r = conDiff(auto(pasos), auto(pasos))
    if (r.kind !== 'automatizacion') throw new Error('tipo inesperado')
    expect(r.pasos.every((p) => p.cambio === 'igual')).toBe(true)
  })

  it('las ramas de un condicional se comparan entre sí', () => {
    const previo: Artefacto = {
      kind: 'automatizacion',
      nombre: 'x',
      cuando: 'y',
      pasos: [
        {
          tipo: 'condition',
          resumen: '¿Compró?',
          si: [{ tipo: 'add_tag', resumen: 'Etiqueta comprador' }],
          no: [{ tipo: 'wait', resumen: 'Espera 1 h' }],
        },
      ],
    }
    const nuevo: Artefacto = {
      kind: 'automatizacion',
      nombre: 'x',
      cuando: 'y',
      pasos: [
        {
          tipo: 'condition',
          resumen: '¿Compró?',
          si: [
            { tipo: 'add_tag', resumen: 'Etiqueta comprador' },
            { tipo: 'send_message', resumen: 'Dice: gracias' },
          ],
          no: [{ tipo: 'wait', resumen: 'Espera 1 h' }],
        },
      ],
    }
    const r = conDiff(previo, nuevo)
    if (r.kind !== 'automatizacion') throw new Error('tipo inesperado')
    expect(r.pasos[0].cambio).toBe('igual')
    expect(r.pasos[0].si?.map((p) => p.cambio)).toEqual(['igual', 'nuevo'])
    expect(r.pasos[0].no?.map((p) => p.cambio)).toEqual(['igual'])
  })
})

describe('flujos y segmentos', () => {
  it('un nodo nuevo se marca y uno borrado queda colgando', () => {
    const previo: Artefacto = {
      kind: 'flujo',
      nombre: 'Menú',
      nodos: [
        { clave: 'inicio', tipo: 'menu', resumen: 'Elegí una opción' },
        { clave: 'envios', tipo: 'texto', resumen: 'Info de envíos' },
      ],
    }
    const nuevo: Artefacto = {
      kind: 'flujo',
      nombre: 'Menú',
      nodos: [
        { clave: 'inicio', tipo: 'menu', resumen: '¿Qué necesitas?' },
        { clave: 'pagos', tipo: 'texto', resumen: 'Medios de pago' },
      ],
    }
    const r = conDiff(previo, nuevo)
    if (r.kind !== 'flujo') throw new Error('tipo inesperado')
    expect(r.nodos.map((n) => [n.clave, n.cambio])).toEqual([
      ['inicio', 'editado'],
      ['pagos', 'nuevo'],
      ['envios', 'quitado'],
    ])
  })

  it('una regla agregada a un segmento se marca sola', () => {
    const previo: Artefacto = {
      kind: 'segmento',
      nombre: 'Recurrentes',
      reglas: [{ campo: 'pedidos', op: 'gte', valor: '2' }],
    }
    const nuevo: Artefacto = {
      kind: 'segmento',
      nombre: 'Recurrentes',
      reglas: [
        { campo: 'pedidos', op: 'gte', valor: '2' },
        { campo: 'pais', op: 'is', valor: 'Argentina' },
      ],
    }
    const r = conDiff(previo, nuevo)
    if (r.kind !== 'segmento') throw new Error('tipo inesperado')
    expect(r.reglas.map((x) => x.cambio)).toEqual(['igual', 'nuevo'])
  })
})

describe('el reconocedor de artefactos', () => {
  it('acepta todos los tipos de la unión', () => {
    // Agregar un tipo a la unión y olvidarse del conjunto da un artefacto que
    // existe, viaja, se guarda y no se dibuja nunca.
    for (const kind of KINDS_ARTEFACTO) {
      expect(esArtefacto({ kind }), kind).toBe(true)
    }
  })

  it('rechaza lo que no es', () => {
    expect(esArtefacto(null)).toBe(false)
    expect(esArtefacto({ kind: 'inventado' })).toBe(false)
    expect(esArtefacto('automatizacion')).toBe(false)
  })
})
