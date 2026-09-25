/**
 * Dominio web de cada sitio de Mercado Libre. La cuenta del vendedor es de
 * su país, así que sus enlaces (ventas, reclamos) van al dominio de ese país.
 *
 * Brasil no está: sus rutas son en portugués.
 */
const SITE_DOMAINS: Record<string, string> = {
  MLA: "mercadolibre.com.ar",
  MBO: "mercadolibre.com.bo",
  MLC: "mercadolibre.cl",
  MCO: "mercadolibre.com.co",
  MCR: "mercadolibre.co.cr",
  MRD: "mercadolibre.com.do",
  MEC: "mercadolibre.com.ec",
  MGT: "mercadolibre.com.gt",
  MLM: "mercadolibre.com.mx",
  MPA: "mercadolibre.com.pa",
  MPE: "mercadolibre.com.pe",
  MPY: "mercadolibre.com.py",
  MLU: "mercadolibre.com.uy",
  MLV: "mercadolibre.com.ve",
};

/** `https://www.mercadolibre.com.co` para `MCO`; sin sitio conocido, Argentina. */
export function mercadoLibreWebOrigin(siteId: unknown): string {
  const domain = SITE_DOMAINS[String(siteId ?? "").toUpperCase()] ?? SITE_DOMAINS.MLA;
  return `https://www.${domain}`;
}
