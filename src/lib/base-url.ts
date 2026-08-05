/**
 * A dónde tiene que entregarnos el mundo de afuera.
 *
 * Existe como módulo propio porque la respuesta la necesitan cosas que no se
 * conocen entre sí —Meta, Shopify, Tiendanube, WooCommerce— y todas cometen el
 * mismo error si cada una la calcula por su cuenta: guardar la URL una vez y no
 * volver a mirarla. Cuando el servicio cambia de dominio, el registro externo
 * sigue vivo, activo y apuntando a un servidor muerto; el proveedor entrega ahí
 * y nadie se entera. Pasó al mudar de servicio en Render y costó seis días de
 * comentarios de Instagram.
 *
 * El fallback a riverz.co es deliberado: sin `NEXT_PUBLIC_SITE_URL` es preferible
 * registrar el dominio real de producción que registrar `undefined`.
 */
export function publicBaseUrl(): string {
  return (process.env.NEXT_PUBLIC_SITE_URL || "https://riverz.co").replace(/\/+$/, "");
}

/** ¿Esta URL registrada afuera sigue apuntando a nosotros? */
export function pointsToUs(url: string, base = publicBaseUrl()): boolean {
  try {
    return new URL(url).origin === new URL(base).origin;
  } catch {
    return false;
  }
}

/** La misma ruta, en el dominio actual. Sólo cambia el origen: el path lo eligió
 *  quien registró el webhook y no es nuestro para reescribirlo. */
export function rebaseUrl(url: string, base = publicBaseUrl()): string {
  try {
    const u = new URL(url);
    return `${new URL(base).origin}${u.pathname}${u.search}`;
  } catch {
    return url;
  }
}
