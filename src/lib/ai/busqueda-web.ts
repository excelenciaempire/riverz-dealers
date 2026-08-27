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
