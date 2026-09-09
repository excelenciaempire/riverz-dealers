import { describe, expect, it } from 'vitest'

import { ALL_CAPABILITIES } from '@/lib/capabilities/registry'
import {
  ROSTER,
  SIN_DUENO,
  capacidadesDe,
  rosterComoTexto,
  specDe,
  subagentForCapability,
} from './roster'
import { SUBAGENT_IDS } from './types'

/**
 * El reparto del catálogo entre los catorce.
 *
 * Es la prueba que sostiene la promesa de "el modelo decide a quién le toca, el
 * código decide qué puede hacer cada uno". Si la partición se rompe, la segunda
 * mitad de esa frase deja de ser cierta y nadie se entera hasta que un
 * subagente hace algo que no le correspondía.
 */

describe('la partición del catálogo', () => {
  it('los especialistas también respetan las recetas de cada cuenta', () => {
    expect(capacidadesDe('automatizaciones', 'other').some(c => c.key.startsWith('rasmiaw.'))).toBe(false)
    expect(capacidadesDe('automatizaciones', 'b814e934-d832-4be9-bad4-79cca51c1e23').filter(c => c.key.startsWith('rasmiaw.'))).toHaveLength(3)
    expect(capacidadesDe('automatizaciones', 'legacy').some(c => c.key === 'automatizaciones.crear')).toBe(true)
  })
  it('toda capacidad tiene dueño, o está declarada sin dueño con su motivo', () => {
    for (const c of ALL_CAPABILITIES) {
      const dueno = subagentForCapability(c.key)
      if (dueno) continue
      expect(
        SIN_DUENO[c.key],
        `${c.key} no es de nadie y no dice por qué`,
      ).toBeDefined()
      expect(SIN_DUENO[c.key].length, c.key).toBeGreaterThan(20)
    }
  })

  it('ninguna capacidad tiene dos dueños', () => {
    // Peor que una huérfana: dos subagentes pisándose sobre lo mismo, sin que
    // nadie sepa cuál corrió.
    for (const c of ALL_CAPABILITIES) {
      const duenos = ROSTER.filter((s) =>
        s.capacidades.some((p) => (p.endsWith('.') ? c.key.startsWith(p) : p === c.key)),
      ).map((s) => s.id)
      expect(duenos.length, `${c.key} → ${duenos.join(', ')}`).toBeLessThanOrEqual(1)
    }
  })

  it('lo declarado sin dueño existe de verdad en el catálogo', () => {
    // Una clave mal escrita en SIN_DUENO deja pasar la capacidad real.
    for (const key of Object.keys(SIN_DUENO)) {
      expect(
        ALL_CAPABILITIES.some((c) => c.key === key),
        `${key} está en SIN_DUENO y no existe`,
      ).toBe(true)
    }
  })

  it('escribirle a un cliente es de la bandeja, y de nadie más', () => {
    // Un solo dueño: si dos subagentes pudieran escribirle al mismo cliente,
    // dos ramas de un plan podrían mandarle dos mensajes distintos sin que
    // ninguna sepa de la otra.
    expect(subagentForCapability('mensajes.enviar')).toBe('bandeja')
    for (const id of SUBAGENT_IDS) {
      if (id === 'bandeja') continue
      expect(
        capacidadesDe(id).some((c) => c.key === 'mensajes.enviar'),
        id,
      ).toBe(false)
    }
  })

  it('la bandeja diagnostica y también redacta', () => {
    const claves = capacidadesDe('bandeja').map((c) => c.key)
    expect(claves).toContain('mensajes.diagnostico')
    expect(claves).toContain('mensajes.enviar')
  })

  it('contactos y bandeja se reparten las de contacto sin pisarse', () => {
    // `contactos.buscar` es la ficha de UNA persona antes de escribirle: es de
    // la bandeja. `contactos.listar` es explorar la base: es de contactos.
    expect(subagentForCapability('contactos.buscar')).toBe('bandeja')
    expect(subagentForCapability('contactos.listar')).toBe('contactos')
    expect(subagentForCapability('contactos.etiquetar')).toBe('contactos')
  })
})

describe('quién le puede pedir a quién', () => {
  it('nadie se pide a sí mismo', () => {
    for (const s of ROSTER) expect(s.puedePedirle, s.id).not.toContain(s.id)
  })

  it('todo destinatario existe', () => {
    for (const s of ROSTER) {
      for (const otro of s.puedePedirle) {
        expect(() => specDe(otro), `${s.id} → ${otro}`).not.toThrow()
      }
    }
  })

  it('no hay ciclos, ni siquiera de dos', () => {
    // La profundidad uno los vuelve imposibles en ejecución (el hijo no recibe
    // la herramienta de pedir), pero un par que se apunta mutuamente es una
    // señal de que el reparto de responsabilidades está mal pensado.
    for (const s of ROSTER) {
      for (const otro of s.puedePedirle) {
        expect(specDe(otro).puedePedirle, `${s.id} ↔ ${otro}`).not.toContain(s.id)
      }
    }
  })

  it('el que arma automatizaciones puede pedir una plantilla', () => {
    // Es el caso que motiva toda la comunicación entre subagentes: una
    // automatización con `send_template` necesita una plantilla aprobada.
    expect(specDe('automatizaciones').puedePedirle).toContain('plantillas')
  })
})

describe('la forma de cada spec', () => {
  it('están los catorce, sin repetidos', () => {
    expect(ROSTER.length).toBe(SUBAGENT_IDS.length)
    expect(new Set(ROSTER.map((s) => s.id)).size).toBe(ROSTER.length)
  })

  it('todos dicen qué hacen Y qué no hacen', () => {
    // La frase negativa es la mitad que evita que el orquestador reparta mal.
    for (const s of ROSTER) {
      expect(s.alcance.length, s.id).toBeGreaterThan(80)
      expect(s.alcance, s.id).toMatch(/\bNO\b/)
    }
  })

  it('todos traen instrucciones y un nombre para la pantalla', () => {
    for (const s of ROSTER) {
      expect(s.instrucciones.length, s.id).toBeGreaterThan(40)
      expect(s.nombreKey, s.id).toMatch(/^operation\./)
      expect(s.maxIters, s.id).toBeGreaterThan(0)
      // Techo por especialista. El presupuesto del turno es el freno real
      // (`MAX_LLAMADAS_TURNO`); esto sólo evita que uno solo se lo coma entero.
      expect(s.maxIters, s.id).toBeLessThanOrEqual(8)
    }
  })
})

describe('el texto del roster', () => {
  it('es determinista', () => {
    // Se cachea junto con el prompt del sistema: un orden que cambia entre
    // llamadas hace que el caché no acierte nunca y nadie se entera, porque
    // funcionar, funciona igual.
    expect(rosterComoTexto()).toBe(rosterComoTexto())
  })

  it('nombra a los catorce', () => {
    const texto = rosterComoTexto()
    for (const id of SUBAGENT_IDS) expect(texto, id).toContain(`- ${id}:`)
  })
})
