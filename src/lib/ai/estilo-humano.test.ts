import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ESTILO_HUMANO, estiloHumano, humanizarTexto, tieneEstiloHumano } from './estilo-humano'

it('owns customer service without unverified promises in both languages', () => {
  expect(estiloHumano('es')).toContain('Una escalada es interna');
  expect(estiloHumano('es')).toContain('no afirmes ser humano');
  expect(estiloHumano('en')).toContain('Escalation is internal');
  expect(estiloHumano('en')).toContain('Do not promise unconfirmed');
  expect(estiloHumano('es')).toContain('da sólo los datos del método elegido');
  expect(estiloHumano('en')).toContain('provide only the chosen method details');
  expect(estiloHumano('es')).toContain('Para Colombia usa tú');
  expect(ESTILO_HUMANO).toContain('¿Cuál prefieres?');
});

/**
 * Lo que el cliente no tiene que ver nunca.
 *
 * Tres cosas se prueban acá y son distintas:
 *
 *   1. Que el limpiador saque los tics de la máquina sin romper lo que dice el
 *      mensaje.
 *   2. Que las superficies que le hablan a una persona lleven la regla puesta
 *      en el prompt.
 *   3. Que el prompt no se contradiga a sí mismo. Es la misma lección que dejó
 *      el voseo (ver `sin-voseo.test.ts`): el modelo copia el registro de lo
 *      que lee antes que la instrucción sobre el registro, así que un prompt
 *      escrito con negritas y rayas largas es el que después las manda a un
 *      comentario de Instagram.
 */
describe('humanizarTexto', () => {
  it('quita marcadores del historial sin cambiar el contenido ni otros corchetes', () => {
    expect(humanizarTexto('[recién] La referencia cuesta $129.900.')).toBe('La referencia cuesta $129.900.')
    expect(humanizarTexto('[just now] Your order is ready.')).toBe('Your order is ready.')
    expect(humanizarTexto('Modelo [XL] disponible.')).toBe('Modelo [XL] disponible.')
  })
  it('saca las negritas y las itálicas de markdown', () => {
    expect(humanizarTexto('**Envío gratis** desde *hoy*')).toBe('Envío gratis desde hoy')
    expect(humanizarTexto('__importante__')).toBe('importante')
  })

  it('la raya larga pasa a ser una coma', () => {
    expect(humanizarTexto('Te llega mañana — sin costo')).toBe(
      'Te llega mañana, sin costo',
    )
    expect(humanizarTexto('El serum —el de 30ml— está en stock')).toBe(
      'El serum, el de 30ml, está en stock',
    )
    expect(humanizarTexto('Sale hoy–llega el martes')).toBe('Sale hoy, llega el martes')
  })

  it('no toca el guion normal ni los enlaces', () => {
    expect(humanizarTexto('La post-venta la ves en https://riverz.co/mi-pedido')).toBe(
      'La post-venta la ves en https://riverz.co/mi-pedido',
    )
  })

  it('no se come un asterisco suelto', () => {
    expect(humanizarTexto('Son 2 * 3 unidades')).toBe('Son 2 * 3 unidades')
  })

  it('deshace la lista: se va la viñeta, se queda la línea', () => {
    expect(humanizarTexto('- Uno\n- Dos')).toBe('Uno\nDos')
    expect(humanizarTexto('• Uno\n* Dos')).toBe('Uno\nDos')
  })

  it('saca títulos, citas y separadores', () => {
    expect(humanizarTexto('## Envíos\n---\n> texto')).toBe('Envíos\ntexto')
  })

  it('un enlace de markdown queda como la URL', () => {
    expect(humanizarTexto('Míralo [acá](https://riverz.co/p/1)')).toBe(
      'Míralo https://riverz.co/p/1',
    )
  })

  it('saca invisibles, controles y el carácter roto', () => {
    expect(humanizarTexto('Hola​mundo� ya')).toBe('Holamundo ya')
  })

  it('el código en comillas invertidas pierde las comillas', () => {
    expect(humanizarTexto('Tu código es `RIVERZ10`')).toBe('Tu código es RIVERZ10')
  })

  it('es idempotente', () => {
    const sucio = '**Hola** — mira [acá](https://riverz.co)\n- uno'
    const limpio = humanizarTexto(sucio)
    expect(humanizarTexto(limpio)).toBe(limpio)
  })

  it('no inventa nada con texto vacío', () => {
    expect(humanizarTexto(null)).toBe('')
    expect(humanizarTexto('   ')).toBe('')
  })
})

const RAIZ = join(process.cwd(), 'src')

describe('la regla viaja en los prompts que le hablan a una persona', () => {
  it('la regla se reconoce a sí misma', () => {
    expect(tieneEstiloHumano(ESTILO_HUMANO)).toBe(true)
    expect(tieneEstiloHumano('cualquier otra cosa')).toBe(false)
  })

  /**
   * Se lee el archivo como texto en vez de armar el prompt: `buildSystemPrompt`
   * pide una docena de argumentos y lo que importa es que la línea esté puesta.
   *
   * `voice/context.ts` no está en la lista y no es un olvido: el agente de
   * teléfono arma su prompt con `buildSystemPrompt` del runner, así que hereda
   * la regla de ahí.
   */
  const SUPERFICIES = [
    'lib/ai/runner.ts',
    'lib/ai/borrador.ts',
    'lib/ai/followup.ts',
    'lib/instagram-agent/personalize-dm.ts',
    'lib/operator/prompt.ts',
    'lib/operator/fleet/prompts.ts',
    'app/api/ai/improve-text/route.ts',
    'app/api/flows/[id]/assist/route.ts',
  ]

  for (const rel of SUPERFICIES) {
    it(`${rel} carga el estilo humano`, () => {
      const contenido = readFileSync(join(RAIZ, rel), 'utf8')
      expect(
        /ESTILO_HUMANO|estiloHumano\(/.test(contenido),
        `${rel} no trae la regla de estilo`,
      ).toBe(true)
    })
  }

  /** El Operator sí se puede armar sin base de datos: se arma y se mira. */
  it('el prompt del Operator la trae ya interpolada', async () => {
    const { systemPrompt } = await import('@/lib/operator/prompt')
    expect(tieneEstiloHumano(systemPrompt())).toBe(true)
  })
})

describe('el prompt no se contradice a sí mismo', () => {
  /**
   * Los archivos que ESCRIBEN prompts. No entra todo `src`: hay texto de
   * interfaz, documentación y landings donde una raya larga es tipografía
   * correcta y nadie la copia.
   */
  const PROMPTS = [
    'lib/ai/runner.ts',
    'lib/ai/borrador.ts',
    'lib/ai/followup.ts',
    'lib/ai/tools.ts',
    'lib/ai/roles.ts',
    'lib/ai/guardrails.ts',
    'lib/ai/summarize.ts',
    'lib/channels/publicacion.ts',
    'lib/instagram-agent/personalize-dm.ts',
    'lib/operator/prompt.ts',
    'lib/operator/fleet/prompts.ts',
    'lib/operator/fleet/orchestrator-tools.ts',
    'lib/operator/fleet/preguntas.ts',
    'lib/voice/context.ts',
  ]

  /** Los comentarios son para quien programa: el modelo no los lee. */
  function lineasVivas(texto: string): { n: number; texto: string }[] {
    return texto
      .split('\n')
      .map((texto, i) => ({ n: i + 1, texto }))
      .filter(({ texto }) => {
        const t = texto.trim()
        return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*')
      })
  }

  const RAYAS = /[‒–—―]/

  /**
   * El Operador y su equipo escriben en el panel, y el panel SÍ interpreta la
   * negrita (`ui/texto-rico.tsx`). Ahí queda, por pedido del dueño. La raya
   * larga no: ésa se va en todos lados.
   */
  const CON_NEGRITA = new Set([
    'lib/operator/prompt.ts',
    'lib/operator/fleet/prompts.ts',
    'lib/operator/fleet/orchestrator-tools.ts',
    'lib/operator/fleet/preguntas.ts',
  ])

  for (const rel of PROMPTS) {
    it(`${rel} no tiene rayas largas ni negritas`, () => {
      const contenido = readFileSync(join(RAIZ, rel), 'utf8')
      const encontrado: string[] = []
      for (const { n, texto } of lineasVivas(contenido)) {
        if (RAYAS.test(texto)) encontrado.push(`${rel}:${n} raya larga`)
        if (!CON_NEGRITA.has(rel) && texto.includes('**')) {
          encontrado.push(`${rel}:${n} negrita`)
        }
      }
      expect(encontrado, encontrado.join('\n')).toEqual([])
    })
  }

  /**
   * Y la negrita del panel no se puede colar en un mensaje para un cliente: la
   * regla del panel tiene que decirlo con todas las letras, porque el mismo
   * equipo que escribe en pantalla es el que redacta las plantillas.
   */
  it('la regla del panel prohíbe la negrita dentro de lo que lee un cliente', async () => {
    const { ESTILO_HUMANO_PANEL } = await import('./estilo-humano')
    expect(ESTILO_HUMANO_PANEL).toMatch(/plantilla/)
    expect(ESTILO_HUMANO_PANEL).toMatch(/Nunca uses negritas/)
  })
})
