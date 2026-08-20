import type { Capability } from '@/lib/capabilities/types'

/**
 * El nombre de un paso, para la pantalla.
 *
 * La pantalla tiene su propio diccionario de etiquetas cortas, escrito a mano
 * y con las dos lenguas. Pero ese diccionario se queda atrás —tiene veintipico
 * de entradas y el catálogo pasa las ochenta— y cuando falta una, lo que se
 * imprime es lo que le llegó del servidor.
 *
 * Por eso lo que le llega del servidor nunca puede ser la clave. Un
 * `integraciones.estado` en medio de la conversación es exactamente el
 * tecnicismo que no va: no significa nada para quien vende y encima parece un
 * error. La primera cláusula de la descripción de la capacidad ya es una frase
 * escrita para que la lea una persona, así que ése es el respaldo.
 *
 * Y va en el idioma de la cuenta: el catálogo trae las dos versiones.
 */
export function etiquetaDe(cap: Capability, locale = 'es'): string {
  const texto = locale === 'en' ? (cap.descriptionEn ?? cap.description) : cap.description
  const primera = texto.split(/[:.,;]/)[0].trim()
  if (!primera) return cap.key
  return primera.length > 60 ? `${primera.slice(0, 57)}…` : primera
}
