/**
 * Segunda barrera del runner contra el contestador del cliente. La
 * implementación vive en `lib/channels/respuesta-automatica` (la comparte con
 * `inbox-writer`, que es la primera barrera y además conoce el momento en que
 * llegó el mensaje); acá sólo se mira el texto.
 */
export { esRespuestaAutomatica } from '@/lib/channels/respuesta-automatica';
