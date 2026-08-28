import type Anthropic from '@anthropic-ai/sdk'

/**
 * Buscar en internet, cuando la respuesta no está en el negocio.
 *
 * Un agente de comercio contesta casi todo con lo que el comercio le cargó —el
 * `training_material` del producto, el catálogo, el pedido—. Pero hay una clase
 * de pregunta que llega todos los días y que no está en ninguna de esas
 * fuentes: si el ingrediente sirve para la piel del cliente, si el modelo del
 * teléfono es compatible, cuánto tarda esa transportadora, qué significa una
 * norma del país. Hasta acá el agente sólo podía decir que no sabía.
 *
 * La búsqueda la hace ANTHROPIC, no nosotros: es una herramienta de servidor,
 * se declara en `tools` y los resultados vuelven en la misma respuesta. No hay
 * bucle que escribir ni clave de un buscador que administrar. Lo que sí hay que
 * manejar es `pause_turn` — ver `runWithTools`.
 *
 * **Nace apagada.** Es la única del tablero que no describe algo que el agente
 * ya hacía: le abre una fuente que el comercio no escribió. Y cada búsqueda se
 * cobra. Se enciende en la pizarra de herramientas, a sabiendas.
 */

/**
 * Cuántas búsquedas puede hacer en UNA respuesta.
 *
 * Tres alcanza para contrastar un dato; a partir de ahí el modelo está
 * investigando en vez de contestando, y quien espera del otro lado ve el chat
 * en silencio. El tope lo aplica Anthropic, no nosotros.
 */
const MAX_BUSQUEDAS = 3

/**
 * La variante nueva —con filtrado dinámico— sólo corre en los modelos de 2026.
 * Un agente en Haiku 4.5 la rechaza, así que ahí va la básica. Es el mismo
 * problema que ya nos comió ocho especialistas cuando `thinking: adaptive` se
 * mandó a un modelo que no lo aceptaba: una capacidad nueva no puede apagar
 * agentes que venían andando.
 */
const MODELOS_CON_FILTRADO = /^claude-(opus-(5|4-8|4-7|4-6)|sonnet-(5|4-6)|fable-5|mythos-5)/

export function soportaFiltradoDinamico(model: string): boolean {
  return MODELOS_CON_FILTRADO.test((model ?? '').trim())
}

/**
 * La herramienta, en la variante que ese modelo acepta.
 *
 * `allowed_domains` / `blocked_domains` quedan afuera a propósito: son una
 * lista que alguien tendría que mantener, y una lista de dominios permitidos
 * mal armada convierte "buscá en internet" en "no encontré nada" sin decir por
 * qué. Si un comercio pide acotarlo, ahí se agrega con su pantalla.
 */
export function herramientaDeBusqueda(
  model: string,
): Anthropic.WebSearchTool20260209 | Anthropic.WebSearchTool20250305 {
  return soportaFiltradoDinamico(model)
    ? { type: 'web_search_20260209', name: 'web_search', max_uses: MAX_BUSQUEDAS }
    : { type: 'web_search_20250305', name: 'web_search', max_uses: MAX_BUSQUEDAS }
}

/**
 * La misma capacidad, pero POR TELÉFONO.
 *
 * Arriba es una herramienta de servidor: se declara y Anthropic la resuelve
 * dentro del mismo turno. El agente de voz no habla con Anthropic —corre sobre
 * otro modelo, en el worker— así que por ese camino no le llega, y el teléfono
 * era el único canal que no podía mirar afuera. Un canal no puede saber menos
 * que otro por un detalle de quién ejecuta la búsqueda.
 *
 * Acá se da vuelta: la búsqueda la corre el servidor en una llamada aparte y
 * devuelve texto, así que para el worker es una herramienta común más — entra
 * por el mismo puente que las demás (`POST /voice/tool`).
 *
 * Una sola búsqueda, no tres: del otro lado hay alguien esperando en silencio
 * al teléfono, y tres rondas de búsqueda son medio minuto de nada.
 */
export const BUSCAR_EN_INTERNET_TOOL: Anthropic.Tool = {
  name: 'buscar_en_internet',
  description:
    'Busca un dato en internet cuando la respuesta no está en el negocio (si un ingrediente sirve para algo, si un modelo es compatible, qué dice una norma). NO la uses para precios, stock, plazos ni políticas de este negocio: eso ya lo tenés. Tarda unos segundos: decile al cliente que lo estás buscando antes de llamarla, y no te quedes callado.',
  input_schema: {
    type: 'object' as const,
    properties: {
      consulta: {
        type: 'string',
        description: 'Qué buscar, en una frase. Como lo escribirías en un buscador.',
      },
    },
    required: ['consulta'],
  },
}

/** Cuántas búsquedas en la variante hablada. Ver arriba. */
const MAX_BUSQUEDAS_EN_LLAMADA = 1

/**
 * Corre la búsqueda del lado del servidor y devuelve texto plano.
 *
 * `pause_turn` se maneja igual que en `runWithTools`: el modelo se detiene a
 * mitad de la herramienta de servidor y hay que devolverle lo que lleva para
 * que siga. Sin eso vuelve media frase.
 *
 * Nunca tira: el que llama está a mitad de una llamada telefónica y un error
 * acá no puede cortarla. Devuelve una frase que el agente puede decir.
 */
export async function buscarEnInternet(args: {
  client: Anthropic
  model: string
  consulta: string
  /** Idioma en el que tiene que volver el resumen. */
  idioma?: string
}): Promise<string> {
  const consulta = (args.consulta ?? '').trim()
  if (!consulta) return 'No hay nada que buscar.'

  const herramienta = { ...herramientaDeBusqueda(args.model), max_uses: MAX_BUSQUEDAS_EN_LLAMADA }
  const sistema = [
    'Buscás un dato en internet y lo resumís para que otra persona lo diga en voz alta por teléfono.',
    'Contestá en 2 o 3 frases cortas, sin listas, sin links y sin markdown: se va a leer en voz alta.',
    'Nombrá la fuente en una frase ("según la web del correo", "según el fabricante").',
    'Si no encontrás algo claro, decí exactamente eso. Inventar es peor que no saber.',
    args.idioma ? `Respondé en ${args.idioma}.` : '',
  ]
    .filter(Boolean)
    .join('\n')

  let messages: Anthropic.MessageParam[] = [{ role: 'user', content: consulta }]
  try {
    // Dos vueltas alcanzan: la que pausa para buscar y la que redacta.
    for (let i = 0; i < 4; i++) {
      const res = await args.client.messages.create({
        model: args.model,
        max_tokens: 700,
        system: sistema,
        tools: [herramienta as Anthropic.ToolUnion],
        messages,
      })
      if (res.stop_reason === 'pause_turn') {
        messages = [...messages, { role: 'assistant', content: res.content }]
        continue
      }
      const texto = res.content
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('')
        .trim()
      return texto || 'No encontré nada claro sobre eso.'
    }
    return 'La búsqueda tardó demasiado. Mejor lo revisa una persona.'
  } catch (e) {
    console.warn('[busqueda-web] falló la búsqueda en llamada', e)
    return 'No pude buscarlo ahora. Decile al cliente que lo revisa una persona y seguí.'
  }
}

/**
 * Lo que el agente tiene que saber sobre cuándo usarla.
 *
 * Sin esto el modelo busca de más: contrasta en internet un precio que tiene
 * en el catálogo, y termina cotizándole al cliente el de otra tienda. El orden
 * de las fuentes no es un detalle de estilo — es de quién es la información
 * que sale por el chat.
 */
export const REGLAS_DE_BUSQUEDA = [
  'Puedes buscar en internet, pero es el ÚLTIMO recurso.',
  '- Primero mira lo que ya tienes: la ficha del producto, el catálogo, el pedido del cliente y las reglas del negocio. Lo del comercio siempre gana sobre lo que encuentres afuera.',
  '- No busques NUNCA precios, stock, plazos de envío ni políticas de este negocio: eso sale de acá, y lo de internet estaría mal.',
  '- Busca sólo cuando la pregunta es sobre el mundo y no sobre el negocio: si un ingrediente sirve para algo, si un modelo es compatible, qué dice una norma, el estado de un envío en la web del correo.',
  '- Di de dónde sacaste el dato cuando lo tomaste de internet, y no lo presentes como si lo afirmara el comercio.',
  '- Si la búsqueda no aclara nada, dilo y deja la pregunta para una persona. Inventar es peor que no saber.',
].join('\n')
