/**
 * El primer nombre con el que se saluda a alguien, sacado del nombre que
 * tiene en WhatsApp (o en el canal que sea). Solo si parece un nombre de
 * persona: con emojis, números, siglas, un nombre de negocio o una palabra
 * genérica ("Cliente", "Ventas") se saluda sin nombre, que es mejor que
 * llamar a alguien "Hola, 🌸✨" o "Hola, Distribuidora".
 */

/** El cliente de las pruebas (Probar como cliente y el Tablero). */
export const CLIENTE_DE_PRUEBA = 'Juan Prueba';

const NO_ES_NOMBRE = new Set([
  'cliente', 'clienta', 'usuario', 'usuaria', 'user', 'whatsapp', 'wa', 'business',
  'tienda', 'shop', 'store', 'ventas', 'venta', 'oficina', 'empresa', 'negocio',
  'contacto', 'info', 'admin', 'soporte', 'hola', 'yo', 'mi', 'mama', 'mamá', 'papa',
  'papá', 'amor', 'bebe', 'bebé', 'señor', 'señora', 'sr', 'sra', 'don', 'doña',
  'dr', 'dra', 'lic', 'ing', 'unknown', 'desconocido', 'null', 'undefined', 'prueba', 'test',
]);

/** Letras (con tildes y ñ), y a lo sumo un guion o apóstrofo en el medio. */
const PALABRA_DE_NOMBRE = /^\p{L}+(?:['’-]\p{L}+)?$/u;

export function primerNombre(nombre: string | null | undefined): string | null {
  if (!nombre) return null;
  const limpio = nombre.normalize('NFC').trim().replace(/\s+/g, ' ');
  if (!limpio) return null;
  // Emojis, números o símbolos en cualquier parte: no es un nombre para saludar.
  if (/[\p{Extended_Pictographic}\d@#$%&*_=+<>{}[\]|\\/]/u.test(limpio)) return null;
  const palabras = limpio.split(' ');
  if (palabras.length > 5) return null;
  const primera = palabras[0].replace(/[.,;:!?¡¿"]+$/g, '');
  if (!PALABRA_DE_NOMBRE.test(primera)) return null;
  if (primera.length < 2 || primera.length > 20) return null;
  if (NO_ES_NOMBRE.has(primera.toLowerCase())) return null;
  // Siglas o todo en mayúsculas de 2-3 letras ("JP", "MRC"): no es un nombre.
  if (primera.length <= 3 && primera === primera.toUpperCase()) return null;
  // Sin vocales ("Xkrt") tampoco.
  if (!/[aeiouáéíóúüy]/i.test(primera)) return null;
  return primera.charAt(0).toLocaleUpperCase('es') + primera.slice(1).toLocaleLowerCase('es');
}
