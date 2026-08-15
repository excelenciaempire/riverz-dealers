/**
 * La documentación en su propio host: docs.riverz.co.
 *
 * Mismo patrón que el panel de plataforma. Va aparte del dominio del producto
 * por dos motivos: es lo único de Riverz que se lee sin cuenta —y una URL
 * pública que cuelga de la app hace pensar que hace falta entrar— y porque el
 * que llega a la documentación viene de un buscador o de un README, no de la
 * bandeja.
 *
 * A diferencia del panel, acá no hay nada que esconder: en el dominio del
 * producto `/documentacion` sigue sirviendo siempre. No hay un
 * `DOCS_SUBDOMAIN_ONLY` porque cortar un enlace público que alguien ya guardó
 * no arregla nada.
 */

/** Host de la documentación. Configurable para poder probarlo en otro dominio. */
export function docsHost(): string {
  return (process.env.DOCS_HOST || 'docs.riverz.co').toLowerCase();
}

export function isDocsHost(host: string | null | undefined): boolean {
  if (!host) return false;
  return host.toLowerCase().split(':')[0] === docsHost();
}

/**
 * Lo que en el host de la documentación se sirve tal cual: lo interno de Next,
 * las APIs y los assets. Sin esto, la primera petición de un chunk termina
 * reescrita a una página y la pantalla queda en blanco.
 */
function passthrough(pathname: string): boolean {
  return (
    pathname.startsWith('/api/') ||
    pathname.startsWith('/_next/') ||
    pathname.startsWith('/.well-known/') ||
    pathname === '/favicon.ico' ||
    pathname === '/robots.txt' ||
    pathname === '/sitemap.xml'
  );
}

/**
 * Ruta interna para un pedido al host de la documentación.
 * `docs.riverz.co/` → `/documentacion`, `docs.riverz.co/mcp` → `/documentacion/mcp`.
 * Devuelve null cuando no hay que reescribir nada.
 */
export function docsRewrite(pathname: string): string | null {
  if (passthrough(pathname)) return null;
  if (pathname === '/documentacion' || pathname.startsWith('/documentacion/')) return null;
  if (pathname === '/') return '/documentacion';
  return `/documentacion${pathname}`;
}
