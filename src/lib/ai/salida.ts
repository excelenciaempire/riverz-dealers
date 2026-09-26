import { humanizarTexto } from './estilo-humano';

/**
 * LA ÚNICA PUERTA POR LA QUE SALE UN TEXTO ESCRITO POR UN MODELO.
 *
 * `humanizarTexto` existía desde antes y funcionaba. El problema era otro:
 * llamarlo era una decisión de cada llamador. Cuando apareció una superficie
 * nueva —la que contesta comentarios con el agente completo— nadie se acordó,
 * y el 2026-08-28 se publicó debajo de una foto de Instagram:
 *
 *     El serum vale **$39.990** por 1 unidad.
 *
 * con los asteriscos a la vista. El mismo día se registraron mensajes
 * automáticos VACÍOS en webchat, WhatsApp e Instagram: el modelo devolvió nada
 * y se guardó igual, así que el comercio veía una burbuja en blanco.
 *
 * Ninguna de las dos cosas se arregla acordándose mejor. Se arreglan haciendo
 * que la salida de un modelo no pueda llegar a una persona sin pasar por acá,
 * y que una superficie que se olvide rompa un test en vez de romper un
 * comentario público. Eso último lo vigila `salida.test.ts`.
 *
 * Devuelve `null` cuando no quedó nada que valga la pena mandar. Es a
 * propósito: obliga a decidir qué hacer sin texto —callarse, reintentar, pasar
 * al respaldo— en vez de mandar el vacío.
 */
export function salidaParaCliente(entrada: string | null | undefined): string | null {
  const limpio = sinRestosDelModelo(humanizarTexto(entrada)).trim();
  if (!limpio) return null;
  // Un mensaje que sólo tiene signos no dice nada. Pasó con respuestas que se
  // quedaron en un "..." o en una comilla suelta cuando el modelo se cortó.
  if (!/[\p{L}\p{N}]/u.test(limpio)) return null;
  return limpio;
}

/**
 * Recorta sin partir una palabra.
 *
 * Cortar por número de caracteres a secas publicó "¿Hay algo del serum que
 * qui…" debajo de una foto. Se prefiere la última frase completa que entre; si
 * no entra ninguna, el último espacio.
 */
export function recortarSalida(texto: string, tope: number): string {
  const t = texto.trim();
  if (t.length <= tope) return t;
  const cabe = t.slice(0, tope);
  const frase = Math.max(
    cabe.lastIndexOf('. '),
    cabe.lastIndexOf('! '),
    cabe.lastIndexOf('? '),
    cabe.lastIndexOf('.\n'),
    cabe.lastIndexOf('!\n'),
    cabe.lastIndexOf('?\n'),
  );
  if (frase > tope * 0.5) return cabe.slice(0, frase + 1).trim();
  const renglon = cabe.lastIndexOf('\n');
  if (renglon > tope * 0.5) return cabe.slice(0, renglon).trim();
  const espacio = cabe.lastIndexOf(' ');
  const corte = espacio > tope * 0.5 ? espacio : tope - 1;
  return `${cabe.slice(0, corte).trimEnd()}…`;
}

/**
 * El largo de un mensaje de chat, sin cortarlo a la mitad.
 *
 * `max_response_chars` es el largo que se le PIDE al modelo, no un tope para
 * cortar. Cortarlo a secas mandó "desde la semana 8 empiezan a…" a clientes
 * (2026-09-26): el modelo se pasó unas palabras y la idea quedó por la mitad,
 * que es peor que un mensaje un poco más largo. Un chat no tiene el límite de
 * un comentario, así que el mensaje pasa entero hasta el doble de lo pedido;
 * sólo uno desbocado se recorta, y en la última frase completa.
 */
export function largoDeChat(texto: string, pedido: number | null | undefined): string {
  const tope = Math.max(400, (pedido || 500) * 2);
  return recortarSalida(texto, tope);
}

/**
 * Restos del modelo que no son parte del mensaje.
 *
 * Los dos aparecieron el 2026-08-28 en mensajes que llegaron a clientas:
 *
 *   "Lo dejo指 avisado para el envío"     ← un carácter chino en medio
 *   "[recién] ¿Está bien tu teléfono…"     ← un marcador entre corchetes
 *
 * Ninguno se puede explicar y los dos delatan a la máquina. Se sacan acá y no
 * en el prompt porque pedirle a un modelo que no alucine un carácter es pedirle
 * justamente lo que a veces no puede: esto lo tiene que arreglar el código.
 *
 * Se quitan SÓLO los caracteres que no pertenecen a un texto en español —CJK,
 * cirílico, árabe— y los marcadores de una palabra entre corchetes al empezar.
 * Un `[Imagen]` o un `[Audio]` del propio producto no empiezan el mensaje del
 * agente, así que no se tocan.
 */
export function sinRestosDelModelo(texto: string): string {
  return texto
    .replace(FUERA_DEL_ESPANOL, '')
    .replace(/^\s*\[[a-záéíóúñ]{1,12}\]\s*/i, '')
    .replace(/[^\S\r\n]{2,}/g, ' ')
    .trim();
}

/**
 * ¿ESTE MENSAJE PROMETE AVERIGUAR Y VOLVER?
 *
 * El 2026-08-28 alguien preguntó por Instagram si el sérum era argentino y la
 * respuesta fue:
 *
 *     "El dato del país de fabricación no lo tengo a mano, así que no te lo
 *      quiero afirmar de memoria. Lo confirmo y te lo digo acá mismo."
 *
 * Trece horas después no había vuelto nadie. No existía nada que cumpliera esa
 * promesa: ni recordatorio, ni cola, ni aviso. La persona quedó esperando algo
 * que el sistema no podía dar, en el medio de una compra.
 *
 * La regla del dueño: la IA contesta con lo que sabe, y si no sabe **no dice
 * nada** y entra una persona. Prometer que vuelve es lo peor de los dos
 * mundos: la clienta se queda esperando y además cree que alguien está
 * trabajando en su pregunta.
 *
 * Por eso donde esto da verdadero el mensaje NO SALE: el hilo queda marcado
 * para una persona, sale el aviso por WhatsApp y la pregunta se anota como
 * hueco de conocimiento.
 *
 * **La precisión importa más que la cobertura.** Un falso positivo silencia
 * una respuesta buena y llama a una persona al pedo, así que sólo entran dos
 * cosas que no admiten otra lectura: que admita no saber, y que aplace
 * explícitamente. Queda AFUERA "voy a verificar tu pedido", que muchas veces
 * lo verifica y contesta en el mismo mensaje; y "te confirmo cuando salga el
 * envío", que es una promesa que el sistema cumple solo.
 */
const PROMESAS_DE_VOLVER: RegExp[] = [
  // 1. ADMITE QUE NO SABE. Es la señal más limpia que existe: nadie escribe
  //    "no tengo ese dato" cuando lo tiene.
  //    "no lo tengo a mano", "no tengo ese dato", "no lo sé con certeza"
  /\bno\s+(lo\s+|la\s+|te\s+lo\s+)?(tengo|s[ée]|se|puedo\s+confirmar(te)?)\b[^.!?]{0,25}\b(a mano|ese dato|el dato|esa informaci[óo]n|con certeza|con exactitud|de memoria|con seguridad)\b/i,
  // "no te lo quiero afirmar", "prefiero no afirmarte"
  /\b(no\s+te\s+lo\s+quiero|prefiero\s+no)\s+(afirmar|asegurar|confirmar|decir)/i,

  // 2. LO DEJA PARA DESPUÉS, explícitamente. Ojo: acá NO entra "voy a
  //    verificar tu pedido", que muchas veces lo verifica y contesta en el
  //    mismo mensaje. Sólo lo que aplaza sin lugar a dudas.
  //    "lo confirmo y te lo digo", "eso lo averiguo y te aviso"
  /\b(lo|te lo|eso|esto)\s+(consulto|verifico|chequeo|confirmo|averiguo|pregunto)\b[^.!?]{0,40}\b(te\s+)?(aviso|digo|confirmo|respondo|comento|escribo|paso)\b/i,
  // "estoy averiguando", "me estoy fijando"
  /\b(estoy|me estoy)\s+(consultando|averiguando|verificando|chequeando|fij[áa]ndome)\b/i,
  // "te vuelvo a escribir con el dato"
  /\bte\s+(vuelvo a escribir|escribo de nuevo|contesto)\b[^.!?]{0,25}\b(con|apenas|cuando)\b[^.!?]{0,25}\b(dato|informaci[óo]n|respuesta|confirmaci[óo]n)\b/i,
];

export function prometeAveriguar(texto: string | null | undefined): boolean {
  const t = (texto ?? '').normalize('NFC');
  if (!t.trim()) return false;
  return PROMESAS_DE_VOLVER.some((re) => re.test(t));
}

/**
 * Alfabetos que no tienen nada que hacer en un mensaje en español: CJK,
 * cirílico y árabe. El resto no se toca: acentos, ñ y emojis son parte de
 * cómo escribe cualquiera.
 */
const FUERA_DEL_ESPANOL = new RegExp(
  '[' +
    '\u3000-\u303f\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff' +
    '\u0400-\u04ff\u0600-\u06ff' +
    ']',
  'g',
);
