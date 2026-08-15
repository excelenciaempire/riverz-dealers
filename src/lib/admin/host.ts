/**
 * El panel de plataforma en su propio host: admin.riverz.co.
 *
 * Por qué separarlo del dominio del producto:
 *
 *  - Las cookies son por host. Con el panel colgando de riverz.co, la sesión
 *    del comercio y la del panel viven en el mismo origen: cualquier agujero
 *    en una pantalla de inquilino queda a un paso de las herramientas que
 *    afectan a todos. En otro host, no se tocan.
 *  - La superficie se achica: en riverz.co deja de existir una ruta que
 *    valga la pena adivinar.
 *
 * La migración es en dos tiempos a propósito. Mientras el DNS no resuelva,
 * `/admin` en el dominio principal SIGUE funcionando; el día que
 * admin.riverz.co esté arriba se prende `ADMIN_SUBDOMAIN_ONLY=1` y el
 * dominio viejo deja de servirlo. Al revés —cortar primero— dejaría al
 * equipo sin panel hasta que propague el DNS.
 */

/** Host del panel. Configurable para poder probarlo en otro dominio. */
export function adminHost(): string {
  return (process.env.ADMIN_HOST || 'admin.riverz.co').toLowerCase();
}

/** ¿El pedido entra por el host del panel? */
export function isAdminHost(host: string | null | undefined): boolean {
  if (!host) return false;
  const clean = host.toLowerCase().split(':')[0];
  return clean === adminHost();
}

/** ¿Ya cortamos /admin en el dominio principal? */
export function subdomainOnly(): boolean {
  return process.env.ADMIN_SUBDOMAIN_ONLY === '1';
}

/**
 * Rutas que en el host del panel se sirven tal cual, sin llevarlas a /admin:
 * el login (hay que poder entrar), las APIs y lo interno de Next.
 */
function passthrough(pathname: string): boolean {
  return (
    pathname.startsWith('/api/') ||
    pathname.startsWith('/_next/') ||
    pathname.startsWith('/ingresar') ||
    pathname.startsWith('/login') ||
    pathname.startsWith('/auth/') ||
    pathname === '/favicon.ico'
  );
}

/**
 * Secciones que existen dentro del panel. Se listan a mano y no se importan de
 * `sections.ts` porque eso arrastraría los iconos al bundle del proxy, que
 * corre en cada pedido.
 */
const SECTIONS = new Set([
  'auditoria',
  'canales',
  'comercios',
  'funcionalidades',
  'ia',
  'infra',
  'lista-espera',
  'logs',
  'operacion',
  'uso',
  'usuarios',
  'voz',
  'whatsapp',
]);

/**
 * Ruta interna que corresponde a un pedido al host del panel.
 * `admin.riverz.co/` → `/admin`, `admin.riverz.co/ia` → `/admin/ia`.
 * Devuelve null si no hay que reescribir nada.
 *
 * Lo que no es una sección del panel cae en su home en vez de reescribirse a
 * ciegas: el login termina mandando a `/panel` (la ruta del producto) y sin
 * esto el equipo aterrizaba en un 404 justo después de entrar.
 */
export function adminRewrite(pathname: string): string | null {
  if (passthrough(pathname)) return null;
  if (pathname === '/admin' || pathname.startsWith('/admin/')) return null;
  const first = pathname.split('/')[1] ?? '';
  if (!first) return '/admin';
  return SECTIONS.has(first) ? `/admin${pathname}` : '/admin';
}
