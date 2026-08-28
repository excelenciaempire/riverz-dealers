/**
 * La forma del cuerpo: bloques, no párrafo.
 *
 * El oficio (`oficio.ts`) se lo pide al modelo, y el modelo casi siempre lo
 * cumple. «Casi siempre» no alcanza: un mensaje que llega como un ladrillo de
 * seis renglones dentro de una burbuja de chat no se lee, se archiva, y eso
 * pasa después de que Meta aprobó la plantilla y ya no hay vuelta atrás barata.
 *
 * Así que la regla se cumple también del lado del código: todo cuerpo escrito
 * por Riverz pasa por acá antes de guardarse o de mostrarse para aprobar.
 *
 * Qué NO toca:
 *
 *  - Un cuerpo que YA trae saltos de línea. Quien lo escribió ya decidió su
 *    forma y no se le pisa.
 *  - Un cuerpo corto (hasta 120 caracteres). Un renglón se lee de un vistazo:
 *    partirlo es ruido, no ritmo.
 *  - Un cuerpo de una sola frase. No hay dónde cortar sin inventar puntuación.
 */

/** Debajo de esto, un renglón único se lee entero de un vistazo. */
const LARGO_MINIMO = 120

/** El tope duro de Meta para el cuerpo. Los saltos también ocupan. */
const MAX_BODY = 1024

/** Bloques a los que se apunta: dos o tres, como pide el oficio. */
const MAX_BLOQUES = 3

/**
 * Deja el cuerpo en dos o tres bloques separados por una línea en blanco.
 *
 * Es idempotente: aplicarlo dos veces da lo mismo que aplicarlo una.
 */
export function darFormaAlCuerpo(cuerpo: string): string {
  const texto = (cuerpo ?? '').replace(/\r\n/g, '\n').trim()
  if (!texto) return texto
  // Ya tiene forma: no se toca.
  if (texto.includes('\n')) return texto
  if (texto.length <= LARGO_MINIMO) return texto

  const frases = partirEnFrases(texto)
  if (frases.length < 2) return texto

  const armado = agrupar(frases).join('\n\n')
  // Los saltos suman caracteres: si el resultado no entra en Meta, vale más el
  // mensaje entero sin forma que uno cortado con forma.
  return armado.length <= MAX_BODY ? armado : texto
}

/**
 * Corta en frases por el punto (o el signo de cierre) seguido de espacio y de
 * algo que empieza una frase nueva.
 *
 * Pide mayúscula, número, apertura o variable después del espacio para no
 * partir en «1.500 pesos» ni en una abreviatura.
 */
function partirEnFrases(texto: string): string[] {
  return texto
    .split(/(?<=[.!?…])\s+(?=[¿¡"«(*\-\d\{\p{Lu}])/u)
    .map((f) => f.trim())
    .filter(Boolean)
}

/**
 * Reparte las frases en hasta tres bloques parejos por largo.
 *
 * Se reparte por caracteres y no por cantidad de frases porque lo que cansa de
 * leer es el alto del bloque, no cuántos puntos tiene.
 */
function agrupar(frases: string[]): string[] {
  if (frases.length <= MAX_BLOQUES) return frases

  const total = frases.reduce((n, f) => n + f.length, 0)
  const objetivo = total / MAX_BLOQUES
  const bloques: string[] = []
  let actual: string[] = []
  let acumulado = 0

  frases.forEach((frase, i) => {
    actual.push(frase)
    acumulado += frase.length
    const restantes = frases.length - i - 1
    // Cuántos bloques quedan por abrir después de cerrar éste: cada uno
    // necesita al menos una frase, o el último saldría vacío.
    const porAbrir = MAX_BLOQUES - 1 - bloques.length
    if (bloques.length < MAX_BLOQUES - 1 && acumulado >= objetivo && restantes >= porAbrir) {
      bloques.push(actual.join(' '))
      actual = []
      acumulado = 0
    }
  })
  if (actual.length > 0) bloques.push(actual.join(' '))
  return bloques
}
