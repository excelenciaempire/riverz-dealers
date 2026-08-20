import type { WebchatConfig } from '@/types';

export const WEBCHAT_DEFAULTS: Required<
  Pick<WebchatConfig, 'primary_color' | 'position' | 'require_email' | 'enabled'>
> = {
  enabled: false,
  primary_color: '#A3E635',
  position: 'right',
  require_email: false,
};

/** Lo que el widget necesita saber para dibujarse. Nunca incluye los dominios
 *  ni el agente: eso es del comercio, no del visitante. */
export interface WebchatSettings {
  primary_color: string;
  position: 'right' | 'left';
  greeting: string;
  brand_name: string;
  avatar_url: string | null;
  require_email: boolean;
}

export function widgetSettings(config: WebchatConfig, fallbackName: string): WebchatSettings {
  return {
    primary_color: config.primary_color || WEBCHAT_DEFAULTS.primary_color,
    position: config.position || WEBCHAT_DEFAULTS.position,
    greeting: config.greeting ?? '',
    brand_name: config.brand_name || fallbackName,
    avatar_url: config.avatar_url || null,
    require_email: config.require_email ?? WEBCHAT_DEFAULTS.require_email,
  };
}

/**
 * Normaliza un origen a "host" comparable: sin protocolo, sin `www.`, en
 * minúsculas, conservando el puerto sólo si no es el estándar.
 *
 * El comercio escribe su dominio como se le ocurre —"https://mitienda.com/",
 * "www.mitienda.com", "MiTienda.com"— y el navegador manda siempre la forma
 * canónica. Sin esto, la lista de dominios rechaza al propio dueño y el widget
 * no arranca en su tienda, que es el peor primer minuto posible.
 */
export function normalizeOrigin(value: string): string {
  const raw = (value ?? '').trim().toLowerCase();
  if (!raw) return '';
  let host: string;
  let port = '';
  try {
    const url = new URL(raw.includes('://') ? raw : `https://${raw}`);
    host = url.hostname;
    port = url.port;
  } catch {
    return '';
  }
  if (host.startsWith('www.')) host = host.slice(4);
  return port && port !== '443' && port !== '80' ? `${host}:${port}` : host;
}

/**
 * ¿Este origen puede abrir el widget?
 *
 * Un dominio autorizado cubre sus subdominios: quien pone "mitienda.com" da por
 * hecho que "tienda.mitienda.com" también es suyo, y hacerle enumerar cada uno
 * sólo produce widgets que no cargan. Lo que NO cubre es "otramitienda.com" —
 * de ahí que se compare contra el punto y no contra el sufijo pelado.
 *
 * `localhost` entra siempre: sin eso no hay forma de probar la instalación
 * antes de publicarla.
 */
export function originAllowed(origin: string, domains: string[] | undefined): boolean {
  const host = normalizeOrigin(origin);
  if (!host) return false;
  if (host === 'localhost' || host.startsWith('localhost:') || host === '127.0.0.1') return true;
  return (domains ?? []).some((d) => {
    const allowed = normalizeOrigin(d);
    if (!allowed) return false;
    return host === allowed || host.endsWith(`.${allowed}`);
  });
}
