/**
 * Dejar marcados los links que manda Riverz.
 *
 * El problema: una campaña de WhatsApp que dice "mirá la nueva colección" con
 * el link de la tienda genera ventas reales, pero el pedido que sale de ahí no
 * trae nada nuestro. La atribución sólo podía decir "le hablamos y compró",
 * que no prueba nada, y esa plata quedaba para siempre en «influidas».
 *
 * La solución es la misma que usa cualquier plataforma de anuncios: marcar el
 * link. La tienda guarda en el pedido la URL con la que la persona entró
 * (`landing_site` en Shopify), así que un `?riverz=whatsapp` en el link que
 * mandamos vuelve solo dentro del pedido. Eso ya no es una correlación: es la
 * huella de nuestro click en la compra.
 *
 * Dos reglas que no se negocian:
 *
 *   - No se pisa el `utm_source` del comercio. Si el comercio ya etiqueta sus
 *     links, sus informes son suyos; nosotros agregamos nuestro parámetro y
 *     completamos los UTM sólo cuando no hay ninguno.
 *   - No se tocan los links propios (riverz.co, riverzai.com) ni nada que no
 *     sea http(s): marcar un `tel:` o el panel del comercio no prueba ninguna
 *     venta y ensucia lo que la persona ve.
 */

/** El valor de `utm_source` con el que se reconoce un click nuestro. */
export const FUENTE = 'riverz';

/** El parámetro propio. Sobrevive aunque el comercio use sus propios UTM. */
export const PARAM = 'riverz';

/** Por dónde salió el link. Va en `utm_medium` y dentro de `riverz`. */
export type Medio =
  | 'whatsapp'
  | 'instagram'
  | 'messenger'
  | 'webchat'
  | 'email'
  | 'plantilla'
  | 'mercadolibre'
  | 'chat';

interface Marca {
  medio: Medio;
  /** Qué lo mandó: id de la campaña, del flujo o de la automatización. */
  campana?: string | null;
}

const DOMINIOS_PROPIOS = ['riverz.co', 'riverzai.com', 'localhost'];

function esPropio(host: string): boolean {
  const h = host.toLowerCase();
  return DOMINIOS_PROPIOS.some((d) => h === d || h.endsWith(`.${d}`));
}

/**
 * Un link marcado. Devuelve la URL tal cual si no es http(s), si es nuestra, o
 * si ya venía marcada — llamarla dos veces sobre el mismo link no la rompe.
 */
export function marcarEnlace(url: string, marca: Marca): string {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return url;
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return url;
  if (esPropio(u.hostname)) return url;
  if (u.searchParams.has(PARAM)) return url;

  const ref = marca.campana ? `${marca.medio}.${marca.campana}` : marca.medio;
  u.searchParams.set(PARAM, ref);
  // Los UTM son cortesía para el informe del comercio: sólo si no etiquetó él.
  if (!u.searchParams.has('utm_source')) {
    u.searchParams.set('utm_source', FUENTE);
    u.searchParams.set('utm_medium', marca.medio);
    if (marca.campana) u.searchParams.set('utm_campaign', marca.campana);
  }
  return u.toString();
}

// Links dentro de un texto suelto. Se corta en el primer carácter que no puede
// ser parte de una URL; los cierres de paréntesis y la puntuación final quedan
// afuera para no arrastrar el punto de la oración adentro del link.
const RE_URL = /https?:\/\/[^\s<>"']+/g;
const COLA = /[.,;:!?)\]}»"']+$/;

/**
 * De qué canal viene cada medio.
 *
 * Los canales que no venden por link (comentarios públicos, voz) no están: un
 * `?riverz=` a la vista de todos es ruido, y por teléfono no hay link.
 */
const MEDIO_DEL_CANAL: Record<string, Medio> = {
  whatsapp: 'whatsapp',
  instagram: 'instagram',
  messenger: 'messenger',
  webchat: 'webchat',
  gmail: 'email',
  outlook: 'email',
  zoho: 'email',
  mercadolibre: 'mercadolibre',
};

/** Medio atribuible del canal, o null cuando los enlaces no deben tocarse. */
export function medioParaCanal(canal: string): Medio | null {
  return MEDIO_DEL_CANAL[canal] ?? null;
}

/**
 * Marca los links de un mensaje que sale por un canal.
 *
 * Es el punto de entrada de todos los que envían. Devuelve el texto igual
 * cuando el canal no se marca, así quien llama no tiene que preguntarlo.
 *
 * Se aplica DOS veces por mensaje a propósito: una donde se compone el texto
 * —para que lo que se guarda en la bandeja sea exactamente lo que recibió el
 * cliente— y otra en el adaptador, de red de seguridad por si alguien agrega
 * un camino de envío nuevo. Marcar dos veces no cambia nada: es idempotente.
 */
export function marcarParaCanal(texto: string, canal: string): string {
  const medio = medioParaCanal(canal);
  return medio ? marcarEnlaces(texto, { medio }) : texto;
}

/** Marca todos los links de un mensaje. El resto del texto queda intacto. */
export function marcarEnlaces(texto: string, marca: Marca): string {
  if (!texto || !texto.includes('http')) return texto;
  return texto.replace(RE_URL, (bruto) => {
    const cola = bruto.match(COLA)?.[0] ?? '';
    const limpio = cola ? bruto.slice(0, -cola.length) : bruto;
    return marcarEnlace(limpio, marca) + cola;
  });
}

/**
 * ¿Esta persona entró por un link nuestro?
 *
 * Se le pasa el `landing_site` (o el `referring_site`) que la tienda guardó en
 * el pedido. Devuelve la marca cuando la encuentra: con eso la venta pasa de
 * «influida» a probada, y se sabe qué campaña la trajo.
 */
export function marcaDelLanding(
  landing: string | null | undefined,
): { medio: string; campana: string | null } | null {
  if (!landing) return null;
  // Shopify guarda `landing_site` como path relativo ("/products/x?..."), así
  // que hace falta una base cualquiera para poder parsearlo.
  let params: URLSearchParams;
  try {
    params = new URL(landing, 'https://tienda.invalid').searchParams;
  } catch {
    return null;
  }
  const ref = params.get(PARAM);
  if (ref) {
    const [medio, ...resto] = ref.split('.');
    return { medio, campana: resto.length > 0 ? resto.join('.') : null };
  }
  // Respaldo: un link viejo, o uno que el comercio copió a mano de una campaña.
  if (params.get('utm_source') === FUENTE) {
    return {
      medio: params.get('utm_medium') || 'chat',
      campana: params.get('utm_campaign'),
    };
  }
  return null;
}
