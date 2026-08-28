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
  const limpio = humanizarTexto(entrada).trim();
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
  );
  if (frase > tope * 0.5) return cabe.slice(0, frase + 1).trim();
  const espacio = cabe.lastIndexOf(' ');
  const corte = espacio > tope * 0.5 ? espacio : tope - 1;
  return `${cabe.slice(0, corte).trimEnd()}…`;
}
