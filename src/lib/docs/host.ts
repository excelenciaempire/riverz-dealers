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
 * producto `/docs` y `/documentacion` no dejan de funcionar, redirigen. Un
 * enlace público que alguien ya guardó no se rompe, y al mismo tiempo la
 * documentación tiene una sola dirección: dos URLs que sirven lo mismo se
 * reparten el posicionamiento y confunden a quien comparte una.
 */

/** Host de la documentación. Configurable para poder probarlo en otro dominio. */
export function docsHost(): string {
  return (process.env.DOCS_HOST || 'docs.riverz.co').toLowerCase();
}

/** La dirección pública, para enlazar desde la app. */
export function docsUrl(path = ''): string {
  return `https://${docsHost()}${path}`;
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

/**
 * El camino inverso, para el dominio del producto: `/docs` y `/documentacion`
 * mandan al subdominio en lugar de servir una segunda copia.
 *
 * Devuelve la ruta que corresponde en el host de la documentación, o null si
 * este pedido no es de documentación. El fragmento (`#seguridad`) no viaja al
 * servidor, pero el navegador lo conserva al seguir la redirección, así que un
 * enlace a una sección sigue cayendo en la sección.
 */
export function docsRedirect(pathname: string): string | null {
  if (pathname === '/docs' || pathname === '/documentacion') return '/';
  if (pathname.startsWith('/docs/')) return pathname.slice('/docs'.length);
  if (pathname.startsWith('/documentacion/')) return pathname.slice('/documentacion'.length);
  return null;
}
