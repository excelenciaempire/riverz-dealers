import { describe, expect, it } from 'vitest'

import { ESCENARIOS } from './escenarios'
import { dominiosConSeñales, leerIntencion, normalizar, pistaComoTexto } from './intencion'
import { SUBAGENT_IDS } from './types'

/**
 * ¿Entiende lo que le piden?
 *
 * Cien escenarios contra una función pura: sin red, sin base y sin gastar un
 * token. Es la única forma de probar el entendimiento a esta escala — con
 * llamadas de verdad serían cien llamadas por corrida y el resultado cambiaría
 * cada vez, así que la suite se dejaría de correr en una semana.
 *
 * Lo que se afirma de cada escenario es lo que NO se puede errar: el verbo (si
 * pide mirar o pide construir) y que el dominio principal esté. Un dominio de
 * más no rompe nada, porque el orquestador lo descarta al repartir; el
 * principal ausente manda el pedido al equipo equivocado.
 */

describe('los cien escenarios', () => {
  it('son cien de verdad, sin repetidos', () => {
    expect(ESCENARIOS.length).toBeGreaterThanOrEqual(100)
    const textos = ESCENARIOS.map((e) => e.texto.trim().toLowerCase())
    expect(new Set(textos).size).toBe(textos.length)
  })

  it.each(ESCENARIOS.map((e) => [e.texto, e] as const))(
    'entiende: %s',
    (_texto, esperado) => {
      const i = leerIntencion(esperado.texto)

      expect(i.verbo, `verbo de "${esperado.texto}"`).toBe(esperado.verbo)

      for (const d of esperado.dominios) {
        expect(
          i.dominios,
          `"${esperado.texto}" tenía que reconocer ${d} y reconoció [${i.dominios.join(', ')}]`,
        ).toContain(d)
      }

      expect(i.complejo, `reparto de "${esperado.texto}"`).toBe(esperado.complejo)
    },
  )

  it('las consultas nunca piden reparto', () => {
    // Es la regla que mantiene rápida la pregunta simple. Si una lectura
    // termina delegando, "¿cómo viene la semana?" pasa de cuatro segundos a
    // quince y el chat se siente lento para lo que más se usa.
    for (const e of ESCENARIOS.filter((x) => x.verbo === 'consultar')) {
      expect(leerIntencion(e.texto).complejo, e.texto).toBe(false)
    }
  })

  it('los diagnósticos tampoco', () => {
    // Diagnosticar es leer varias cosas y explicar. Nunca construye.
    for (const e of ESCENARIOS.filter((x) => x.verbo === 'diagnosticar')) {
      expect(leerIntencion(e.texto).complejo, e.texto).toBe(false)
    }
  })

  it('lo que toca dos dominios siempre pide reparto', () => {
    for (const e of ESCENARIOS.filter((x) => x.dominios.length > 1)) {
      expect(leerIntencion(e.texto).complejo, e.texto).toBe(true)
    }
  })
})

describe('cómo lee el texto', () => {
  it('las tildes no cambian nada', () => {
    // Media base escribe sin acentos, y toda la base escribe sin acentos cuando
    // está apurada.
    expect(leerIntencion('crea una automatización').dominios).toEqual(
      leerIntencion('crea una automatizacion').dominios,
    )
    expect(leerIntencion('la campaña de ayer').dominios).toEqual(
      leerIntencion('la campana de ayer').dominios,
    )
  })

  it('las mayúsculas tampoco', () => {
    expect(leerIntencion('CREA UNA PLANTILLA').verbo).toBe('crear')
  })

  it('los signos y los espacios de más tampoco', () => {
    expect(leerIntencion('  ¿¿ crea   una  etiqueta ?? ').verbo).toBe('crear')
  })

  it('normalizar deja el texto con bordes, para poder buscar palabras sueltas', () => {
    // Sin los espacios de los extremos, buscar " pausa " no encontraría un
    // texto que empieza con "pausa".
    expect(normalizar('Pausa esto')).toBe(' pausa esto ')
  })
})

describe('las prioridades entre verbos', () => {
  it('diagnosticar le gana a consultar', () => {
    // "por qué no llegó el mensaje" también contiene "mensaje": clasificarlo
    // como consulta manda a alguien a mirar métricas cuando hay algo roto.
    expect(leerIntencion('porque no llego el mensaje').verbo).toBe('diagnosticar')
  })

  it('pausar le gana a editar', () => {
    // "cambiar el estado a pausada" es pausar, no editar.
    expect(leerIntencion('cambiar la automatizacion a pausada').verbo).toBe('pausar')
  })

  it('borrar le gana a todo lo demás', () => {
    expect(leerIntencion('borra y crea una nueva plantilla').verbo).toBe('borrar')
  })

  it('activar no se confunde con crear', () => {
    expect(leerIntencion('activa la automatizacion nueva').verbo).toBe('activar')
  })
})

describe('la pista para el orquestador', () => {
  it('con confianza baja no dice nada', () => {
    // Media pista es peor que ninguna: el modelo la toma en serio igual.
    const i = leerIntencion('hola')
    expect(i.confianza).toBe('baja')
    expect(pistaComoTexto(i)).toBe('')
  })

  it('avisa que es una pista y no una orden', () => {
    // Sin esto, un detector que se equivoca arrastra al orquestador al dominio
    // equivocado y nadie entiende por qué contestó cualquier cosa.
    const texto = pistaComoTexto(leerIntencion('crea una plantilla de bienvenida'))
    expect(texto.toLowerCase()).toContain('pista')
    expect(texto).toContain('decides tú')
  })

  it('nombra el dominio y el verbo', () => {
    const texto = pistaComoTexto(leerIntencion('crea una plantilla de bienvenida'))
    expect(texto).toContain('plantillas')
    expect(texto).toContain('crear')
  })
})

describe('la cobertura del detector', () => {
  it('los catorce dominios tienen señales', () => {
    // Un dominio sin palabras clave nunca se detecta, así que el orquestador
    // nunca recibe una pista sobre él y todo lo suyo cae al camino lento.
    const conSeñales = new Set(dominiosConSeñales())
    for (const id of SUBAGENT_IDS) {
      expect(conSeñales.has(id), `${id} no tiene ninguna señal`).toBe(true)
    }
  })
})
