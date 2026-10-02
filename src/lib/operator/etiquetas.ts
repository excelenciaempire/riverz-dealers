import { translate } from '@/lib/i18n/translate'
import type { Locale } from '@/lib/i18n/config'
import type { Capability } from '@/lib/capabilities/types'

/**
 * El nombre de un paso, para la pantalla: lo que TOCÓ, sin verbo.
 *
 * Antes esto devolvía la primera cláusula de la descripción de la capacidad —un
 * texto escrito para el modelo— y la pantalla tenía además su propio diccionario
 * de 31 etiquetas escritas a mano. Convivían tres personas gramaticales en la
 * misma lista, seguidas: «Revisando las plantillas» (gerundio), «Leo la
 * plantilla» (primera), «Escribe una plantilla de WhatsApp» (tercera, el
 * respaldo, que alcanzaba a 41 de las 72 capacidades). Y el respaldo cortaba en
 * el primer signo de puntuación, así que salían frases partidas a media palabra
 * y un paréntesis abierto que nunca cerraba.
 *
 * Un sustantivo no tiene persona: no puede quedar mal. Y el estado ya lo dice el
 * icono —girando, tilde, cruz—, con lo cual el verbo era justo la parte que
 * sobraba. Veinte nombres, uno por dominio, cubren el catálogo entero y no hay
 * forma de sumar una capacidad y dejar un hueco.
 */
const DOMINIO: Record<string, string> = {
  dealers:'dealers.bdc',
  chatweb: 'webchat.title',
  agentes: 'operation.domAgentes',
  ajustes: 'operation.domAjustes',
  aprobaciones: 'operation.domAprobaciones',
  automatizaciones: 'operation.domAutomatizaciones',
  bandeja: 'operation.domBandeja',
  campanas: 'operation.domCampanas',
  comentarios: 'operation.domComentarios',
  contactos: 'operation.domContactos',
  conversaciones: 'operation.domConversaciones',
  etiquetas: 'operation.domEtiquetas',
  flujos: 'operation.domFlujos',
  integraciones: 'operation.domIntegraciones',
  mensajes: 'operation.domMensajes',
  metricas: 'operation.domMetricas',
  operacion: 'operation.domOperacion',
  pedidos: 'operation.domPedidos',
  plantillas: 'operation.domPlantillas',
  productos: 'operation.domProductos',
  prospeccion: 'operation.domProspeccion',
  rasmiaw: 'operation.domRasmiaw',
  segmentos: 'operation.domSegmentos',
  voz: 'operation.domVoz',
}

export function etiquetaDe(cap: Capability, locale: string = 'es'): string {
  const clave = DOMINIO[cap.key.split('.')[0]]
  if (clave) return translate(locale as Locale, clave)
  // Un dominio nuevo sin entrada acá. La clave cruda no va nunca a la pantalla:
  // `integraciones.estado` en medio de una conversación no significa nada para
  // quien vende y encima parece un error.
  const texto = locale === 'en' ? (cap.descriptionEn ?? cap.description) : cap.description
  const primera = texto.split(/[:.,;]/)[0].trim()
  return primera.length > 60 ? `${primera.slice(0, 57)}…` : primera || cap.key
}
