/**
 * Lo único que hay que preguntar, y cuándo.
 *
 * El prompt ya decía «no preguntes lo que puedes averiguar», y esa regla es
 * correcta: un Operador que pregunta el horario de atención cuando está escrito
 * en la cuenta es un formulario con otro nombre. Lo que faltaba era la mitad de
 * atrás. Sin ella, frente a un dato que NO está en ningún lado —cuál es la
 * condición mayorista, qué descuento se ofrece, a qué hora se puede llamar— el
 * modelo hacía una de dos cosas, las dos malas:
 *
 *  - se lo inventaba, y el comercio se enteraba cuando el mensaje ya había
 *    salido; o
 *  - abandonaba el encargo. Pasó en una cuenta real el 2026-08-26: de tres
 *    mensajes de recompra volvieron dos, y el tercero —el de quien compra 4 o
 *    más— se explicó al final como «necesito que me digas qué ofrecer». La
 *    automatización quedó con un camino sin mensaje y el turno siguiente
 *    empezó de cero.
 *
 * La salida no es preguntar más: es preguntar UNA cosa, tarde, y con el trabajo
 * ya entregado alrededor. Este archivo tiene esa regla y el catálogo de qué
 * cosas, por dominio, sólo las sabe la persona.
 *
 * **Qué NO va acá.** Nada que se pueda leer con una herramienta. Si un dato
 * está en el catálogo, en el mapa de la cuenta o en una automatización que ya
 * existe, preguntarlo es el error que la primera regla ya prohíbe.
 */
import type { SubagentId } from './types'

/**
 * Cómo se pregunta.
 *
 * Cinco reglas, y el orden importa: la primera es la que evita que una pregunta
 * reemplace al trabajo.
 */
export const CUANDO_PREGUNTAR = `CUÁNDO SÍ HAY QUE PREGUNTAR

Casi nunca. Antes de preguntar cualquier cosa, búscala: el mapa de la cuenta, el
catálogo y lo que ya existe contestan casi todo. Pero hay datos que no están en
ningún lado porque son una decisión del negocio, y ahí inventar es peor que
preguntar. Cuando te falte uno:

- **Primero entrega, después pregunta.** Nunca devuelvas sólo una pregunta si
  podías dejar algo hecho. Si te encargaron tres cosas y a una le falta un dato,
  entrega las tres —la incompleta sin ese dato— y pregunta al final. Abandonar
  una pieza deja un camino muerto y el trabajo entero para el turno siguiente.
- **Una sola pregunta, la que más cambia el resultado.** Dos preguntas juntas se
  contestan a medias. Lo demás lo eliges tú y lo dices.
- **Pregunta con una respuesta ya puesta.** «Para quien lleva 4 o más pongo un
  15% por volumen, ¿va?» se contesta con un sí. «¿Qué condición mayorista
  ofreces?» es un formulario y se queda sin contestar.
- **Va al final y en una línea.** Nunca antes de lo que hiciste.
- **Nunca preguntes por permiso.** Aprobar tiene su botón: preguntar «¿lo creo?»
  sobre algo que ya dejaste propuesto es pedir el mismo sí dos veces.`

/**
 * Lo que sólo sabe la persona, por dominio.
 *
 * Cada línea es un dato que NO se puede leer de la cuenta y que cambia lo que
 * sale. Están escritos como «si falta, haz X y pregunta Y» y no como «pregunta
 * Y» a propósito: la mitad del valor está en qué entregar mientras tanto.
 */
export const PREGUNTAS_POR_DOMINIO: Record<SubagentId, string[]> = {
  plantillas: [
    'El descuento, el precio o la condición exacta de una oferta (mayorista, pack, reventa, cupón). Si no está en el catálogo: escribe el mensaje SIN la cifra, que igual funciona, y pregunta la cifra.',
    'La fecha hasta la que vale una promoción. Sin ella el mensaje no lleva urgencia; escríbelo sin plazo antes que inventar un viernes.',
    'El código de un cupón. Nunca lo inventes: un código que no existe hace que el cliente escriba enojado.',
  ],
  automatizaciones: [
    'Cuánto esperar, cuando ni el pedido ni el producto lo sugieren. Elige un tiempo razonable, dilo, y pregunta sólo si el producto no da ninguna pista de cada cuánto se repone.',
    'Qué hacer con quien tiene algo abierto (un pago rechazado, un reclamo, una devolución). Si el pedido no lo dice, no le escribas y avísalo: escribirle a alguien con un problema sin resolver es la queja más cara.',
    'Si al terminar la conversación se cierra o queda abierta para que alguien la mire.',
  ],
  campanas: [
    'Cuándo sale. Un envío sin fecha se queda preparado para siempre.',
    'Cuánta gente es demasiada. Un envío de marketing por WhatsApp se cobra por conversación: si el público pasa de mil, di el número y pregunta antes de dejarlo listo.',
    'A quién exactamente, cuando el público que piden no existe como segmento y hay más de una forma razonable de armarlo.',
  ],
  contactos: [
    'Qué significa en números un criterio en palabras: «los que compran seguido», «los buenos clientes», «los que se enfriaron». Propón una definición concreta con el conteo al lado y pregunta si va ésa.',
    'Si una etiqueta parecida a otra que ya existe es la misma o una nueva. Dos etiquetas por una letra parten la base en dos.',
  ],
  bandeja: [
    'A quién asignar, cuando hay varias personas en el equipo y nada dice de quién es.',
    'Qué decirle a un cliente cuando la respuesta depende de algo que el negocio decide (un reintegro, una excepción, una fecha). Redacta la versión sin ese dato y pregúntalo.',
  ],
  productos: [
    'El precio o el stock de algo que no está en la tienda conectada.',
    'Lo que el producto NO hace o no puede prometer (contraindicaciones, resultados, plazos). Es lo que evita que un agente prometa de más, y no está escrito en ningún lado.',
    'Si dos productos que se parecen son el mismo en dos presentaciones o dos distintos.',
  ],
  pedidos: [
    'Los datos que no constan en un pedido a mano: a nombre de quién, a dónde va, cómo paga. Nunca los completes tú.',
    'Si un pago informado se da por bueno. No lo marques pagado si no te consta; pregúntalo con el monto y la fecha a la vista.',
  ],
  agentes: [
    'Qué deriva a una persona y qué contesta solo. Es la decisión que define al agente y no se puede deducir de la cuenta.',
    'Si puede ofrecer descuentos o excepciones, y hasta cuánto.',
    'Qué NO debe decir nunca. Propón lo obvio del rubro y pregunta si falta algo.',
  ],
  comentarios: [
    'Si el precio se contesta en público o se pasa a privado. Cambia con cada marca y las dos son defendibles.',
    'Qué hacer con un comentario negativo: contestar, pasar a privado u ocultar. Ocultar nunca es tu decisión.',
  ],
  voz: [
    'En qué franja horaria se puede llamar. Nunca la asumas: una llamada a las once de la noche pierde al cliente.',
    'Qué se dice si atiende un contestador.',
  ],
  prospeccion: [
    'Cuántos mensajes por día está dispuesto a mandar. Escribirle a quien no pidió nada se arruina por volumen antes que por texto.',
    'Qué se ofrece en el primer mensaje. Sin una razón concreta el mensaje es spam, por bien escrito que esté.',
  ],
  flujos: [
    'Qué opciones ve el cliente y a dónde lleva cada una, cuando el pedido nombra el menú pero no lo enumera. Propón el menú completo y pregunta si falta una salida.',
  ],
  integraciones: [
    'Cuál de dos cuentas conectadas usar, cuando hay más de una y ninguna es obviamente la del caso.',
  ],
  ajustes: [
    'El rol exacto de alguien a quien se invita. «Que entre al equipo» no dice si puede ver la facturación.',
    'La zona horaria, antes de cambiarla: mueve de golpe todos los horarios de la cuenta, incluidos los de las automatizaciones que ya están corriendo.',
  ],
}

/** El bloque que se le pega al prompt de un especialista. */
export function preguntasDe(id: SubagentId): string {
  const propias = PREGUNTAS_POR_DOMINIO[id] ?? []
  if (propias.length === 0) return CUANDO_PREGUNTAR
  return `${CUANDO_PREGUNTAR}

LO QUE EN TU DOMINIO SÓLO SABE LA PERSONA
${propias.map((p) => `- ${p}`).join('\n')}`
}

/**
 * La versión del orquestador.
 *
 * No lleva el catálogo por dominio —no es él quien construye— sino qué hacer
 * con la pregunta que le devuelve un especialista. Sin esto quedaba enterrada
 * en el medio de un párrafo que también resumía lo hecho, y una pregunta que no
 * se ve no se contesta.
 */
export const PREGUNTAR_ORQUESTADOR = `${CUANDO_PREGUNTAR}

- Cuando un especialista te devuelve una pregunta, esa pregunta ES tu respuesta:
  va en la última línea, sola, y con la opción que propones ya puesta. Lo que se
  hizo ya está en la tarjeta.
- Si dos especialistas preguntan, elige la que bloquea más y guarda la otra para
  después. Dos preguntas en un mensaje se contestan a medias.`
