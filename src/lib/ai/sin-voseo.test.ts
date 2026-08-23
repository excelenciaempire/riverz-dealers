import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Nada de voseo en lo que lee el modelo ni en lo que lee el comercio.
 *
 * El prompt le ordena al agente "escribe en español neutro, nunca uses voseo
 * rioplatense" — y después se lo demostraba doce veces: en sus propios
 * párrafos, en las 31 descripciones de herramientas y en los mensajes que esas
 * herramientas devuelven ("Decile con honestidad que eso no lo sabés"). Una
 * regla contra doce ejemplos: así es como el voseo termina saliendo por el chat
 * a un cliente, que es el defecto que este proyecto viene corrigiendo desde
 * hace cinco commits.
 *
 * Se leen los archivos como texto en vez de importar las cadenas: muchas se
 * arman dentro de funciones con parámetros, y lo que importa es que no exista
 * la forma escrita en ningún lado.
 *
 * La única excepción es la línea que ENSEÑA cuál es la forma prohibida. Ahí el
 * voseo es el ejemplo, y corregirlo convertiría la instrucción en un sinsentido
 * que se prohíbe a sí misma.
 */

const RAIZ = join(process.cwd(), 'src', 'lib')

const ARCHIVOS = [
  'ai/tools.ts',
  'ai/runner.ts',
  'ai/postventa.ts',
  'approvals/ask.ts',
  'approvals/resolve.ts',
]

/** La línea que enseña qué NO escribir. */
const EXCEPCION = 'Nunca uses voseo rioplatense'

/**
 * Imperativos agudos y presentes voseantes. Se listan a mano en vez de usar una
 * regla morfológica: `está`, `además` y `acá` terminan igual y no son voseo, y
 * un falso positivo en un test que nadie puede arreglar rápido se termina
 * borrando.
 */
const FORMAS = [
  // presente
  'tenés', 'podés', 'querés', 'sabés', 'necesitás', 'venís', 'decís', 'hacés',
  'recibís', 'consultás', 'aceptás', 'confirmás', 'llamás', 'pasás', 'devolvés',
  // imperativo
  'buscá', 'usá', 'pedí', 'pasá', 'mandá', 'contá', 'decí', 'mirá', 'dejá',
  'seguí', 'volvé', 'ofrecé', 'avisá', 'anotá', 'cotizá', 'revisá', 'armá',
  'escribí', 'probá', 'marcá', 'sumá', 'elegí', 'poné', 'hacé', 'tomá', 'sacá',
  'reuní', 'confirmá', 'esperá', 'llamá', 'generá', 'registrá', 'cerrá',
  'programá', 'agregá', 'explicá', 'reconocé', 'cobrá', 'reusá', 'rechazá',
  'invitá', 'contestá', 'tratá', 'respondé', 'aclará', 'acordá', 'reconectá',
  // enclíticos
  'decile', 'pedile', 'contale', 'pasale', 'avisale', 'ponele', 'sacale',
  'usala', 'usalo', 'llamala', 'llamalo', 'mostrale', 'preguntale', 'pedilo',
  'deciselo', 'repetile', 'resolvelo', 'despedite', 'confirmaselo', 'fijate',
]

/** Se ignoran los comentarios: son para quien programa, no para nadie más. */
function lineasVivas(texto: string): { n: number; texto: string }[] {
  return texto
    .split('\n')
    .map((texto, i) => ({ n: i + 1, texto }))
    .filter(({ texto }) => {
      const t = texto.trim()
      return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*')
    })
}

describe('el prompt no se contradice a sí mismo', () => {
  for (const rel of ARCHIVOS) {
    it(`${rel} no tiene voseo`, () => {
      const contenido = readFileSync(join(RAIZ, rel), 'utf8')
      const encontrado: string[] = []

      for (const { n, texto } of lineasVivas(contenido)) {
        if (texto.includes(EXCEPCION)) continue
        const bajo = texto.toLowerCase()
        for (const forma of FORMAS) {
          // Con límites de palabra: "usá" no puede saltar dentro de "usuario".
          const re = new RegExp(`(^|[^a-záéíóúñ])${forma}($|[^a-záéíóúñ])`, 'i')
          if (re.test(bajo)) encontrado.push(`${rel}:${n} — "${forma}"`)
        }
      }

      expect(encontrado, encontrado.join('\n')).toEqual([])
    })
  }

  it('la instrucción que enseña la forma prohibida sigue mostrándola', () => {
    const runner = readFileSync(join(RAIZ, 'ai/runner.ts'), 'utf8')
    const linea = runner.split('\n').find((l) => l.includes(EXCEPCION)) ?? ''
    // Sin los ejemplos, la regla no le dice al modelo qué está prohibido.
    expect(linea).toContain('tenés')
    expect(linea).toContain('recibís')
    expect(linea).toContain('querés')
  })
})
