import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Nada de voseo en el camino del agente.
 *
 * El prompt le ordena "escribe en español neutro, nunca uses voseo rioplatense"
 * — y después se lo demostraba doce veces: en sus propios párrafos, en las 31
 * descripciones de herramientas y en los mensajes que esas herramientas
 * devuelven ("Dile con honestidad que eso no lo sabes"). Una regla contra doce
 * ejemplos: así es como el voseo termina saliendo por el chat a un cliente.
 *
 * Se leen los archivos como texto en vez de importar las cadenas: muchas se
 * arman dentro de funciones con parámetros, y lo que importa es que la forma
 * escrita no exista en ningún lado.
 *
 * **Por qué una lista y no todo `src`.** Barrer el repo entero rompe tres cosas
 * que NO son descuidos:
 *
 *   - `lib/voice/**` tiene un modo rioplatense deliberado, con su propio test
 *     que exige el voseo (`voice/rioplatense.test.ts`). Es una variante, no un
 *     error.
 *   - `operator/fleet/intencion.ts` y `channels/email/automated-sender.ts` no
 *     ESCRIBEN texto: LEEN el que escribió otro. Sacarles el voseo de las
 *     listas es dejar de entender a quien lo usa.
 *   - Las capacidades del Operator todavía tienen voseo. Está anotado; no entra
 *     acá hasta que se limpie, porque un test que falla desde el día uno se
 *     termina borrando.
 *
 * Los catálogos de i18n SÍ entran, desde el 2026-08-26: estaban en esa misma
 * lista de deuda y resultaron ser cinco cadenas. Ver el bloque de abajo.
 */

const RAIZ = join(process.cwd(), 'src', 'lib')

const ARCHIVOS = [
  // El prompt y las herramientas del agente
  'ai/tools.ts',
  'ai/runner.ts',
  'ai/postventa.ts',
  'ai/bandeja.ts',
  'ai/answer-gaps.ts',
  'ai/guardrails.ts',
  'ai/roles.ts',
  'ai/tool-labels.ts',
  // Lo que devuelven las herramientas de comercio y postventa
  'returns/open.ts',
  'shopify/create-checkout.ts',
  'shopify/create-order.ts',
  // Lo que lee el COMERCIO cuando le piden aprobar algo
  'approvals/ask.ts',
  'approvals/resolve.ts',
]

/** La línea que enseña qué NO escribir. Ahí el voseo es el ejemplo, y
 *  corregirlo convertiría la instrucción en un sinsentido que se prohíbe a sí
 *  misma — cosa que pasó en la primera barrida. */
const EXCEPCION = 'Nunca uses voseo rioplatense'

/**
 * Se listan a mano en vez de usar una regla morfológica: `está`, `además` y
 * `acá` terminan igual y no son voseo, y un falso positivo en un test que nadie
 * puede arreglar rápido se termina borrando.
 */
const FORMAS = [
  // presente
  'tenés', 'podés', 'querés', 'sabés', 'necesitás', 'venís', 'decís', 'hacés',
  'recibís', 'consultás', 'aceptás', 'confirmás', 'llamás', 'pasás', 'devolvés',
  'mandás',
  // imperativo
  'buscá', 'usá', 'pedí', 'pasá', 'mandá', 'contá', 'decí', 'mirá', 'dejá',
  'seguí', 'volvé', 'ofrecé', 'avisá', 'anotá', 'cotizá', 'revisá', 'armá',
  'escribí', 'probá', 'marcá', 'sumá', 'elegí', 'poné', 'hacé', 'tomá', 'sacá',
  'reuní', 'confirmá', 'esperá', 'llamá', 'generá', 'registrá', 'cerrá',
  'programá', 'agregá', 'explicá', 'reconocé', 'cobrá', 'reusá', 'rechazá',
  'invitá', 'contestá', 'tratá', 'respondé', 'aclará', 'acordá', 'reconectá',
  'sugerí', 'conectá', 'recomendá',
  // enclíticos
  'decile', 'pedile', 'contale', 'pasale', 'avisale', 'ponele', 'sacale',
  'usala', 'usalo', 'llamala', 'llamalo', 'mostrale', 'preguntale', 'pedilo',
  'deciselo', 'repetile', 'resolvelo', 'despedite', 'confirmaselo', 'fijate',
  'ofrecele', 'mandale', 'contestale', 'decime',
]

/**
 * Palabra entera a los dos lados.
 *
 * Sin esto, "automática" contiene "tomá" y una barrida por subcadena la
 * convirtió en "automatica" — que rompió la detección de autorespuestas de
 * correo. El límite no es un detalle: es lo que separa corregir de romper.
 */
const REGLAS = FORMAS.map((f) => ({
  forma: f,
  re: new RegExp(`(?<![a-záéíóúñ])${f}(?![a-záéíóúñ])`, 'i'),
}))

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
        for (const { forma, re } of REGLAS) {
          if (re.test(bajo)) encontrado.push(`${rel}:${n} — "${forma}"`)
        }
      }

      expect(encontrado, encontrado.join('\n')).toEqual([])
    })
  }

  /**
   * Los catálogos de i18n, que es TODO lo que lee el comercio en pantalla.
   *
   * Estaban anotados como deuda: "todavía tienen voseo, no entra acá hasta que
   * se limpie, porque un test que falla desde el día uno se termina borrando".
   * Se limpió el 2026-08-26 —eran cinco cadenas— así que ya puede entrar.
   *
   * Se listan por barrido y no a mano: un catálogo nuevo tiene que quedar
   * cubierto sin que nadie se acuerde de agregarlo.
   */
  const MENSAJES = join(process.cwd(), 'src', 'lib', 'i18n', 'messages')
  // Las dos landings traen un chat de mentira donde una clienta dice "¡Te
  // escribí por DM!". Eso es pretérito de primera persona, no voseo — pero la
  // lista no puede distinguirlos, y cambiarlo rompería el diálogo.
  const SIN_REVISAR = new Set(['landing.ts', 'landingV2.ts'])

  for (const nombre of readdirSync(MENSAJES).filter((f) => f.endsWith('.ts'))) {
    if (SIN_REVISAR.has(nombre)) continue
    it(`i18n/messages/${nombre} no tiene voseo`, () => {
      const contenido = readFileSync(join(MENSAJES, nombre), 'utf8')
      const encontrado: string[] = []
      for (const { n, texto } of lineasVivas(contenido)) {
        const bajo = texto.toLowerCase()
        for (const { forma, re } of REGLAS) {
          if (re.test(bajo)) encontrado.push(`${nombre}:${n} — "${forma}"`)
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

  it('el modo rioplatense de voz sigue intacto: es una variante, no un descuido', () => {
    const constantes = readFileSync(join(RAIZ, 'voice/constants.ts'), 'utf8')
    // Si alguien barre el repo entero, esto se cae antes que un cliente
    // argentino escuche a su asistente hablándole de "tú".
    expect(constantes).toMatch(/vos|tenés|podés|decí/i)
  })
})
