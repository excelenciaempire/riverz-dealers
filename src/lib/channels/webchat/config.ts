import type { WebchatConfig } from '@/types';

export const WEBCHAT_DEFAULTS: Required<
  Pick<
    WebchatConfig,
    | 'primary_color'
    | 'position'
    | 'require_email'
    | 'enabled'
    | 'auto_open_seconds'
    | 'allow_uploads'
    | 'ask_rating'
  >
> = {
  enabled: false,
  primary_color: '#A3E635',
  position: 'right',
  require_email: false,
  // Sin abrirse solo: un chat que salta encima de quien está leyendo la ficha
  // del producto interrumpe justo la parte que estaba funcionando.
  auto_open_seconds: 0,
  allow_uploads: true,
  ask_rating: true,
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
  auto_open_seconds: number;
  allow_uploads: boolean;
  ask_rating: boolean;
  /**
   * El idioma en que el CHAT se dibuja: los botones, "¿te sirvió?", el aviso
   * de sesión vencida.
   *
   * Sigue al agente y no al panel: quien lee esto es el cliente del comercio,
   * y el comercio ya eligió en qué idioma le habla. Sin esto el marco del chat
   * estaba cableado en español y una tienda inglesa le mostraba "Reanudar" a
   * sus clientes.
   */
  locale: 'es' | 'en';
  /** Qué se muestra cuando el agente está fuera de horario. Vacío = nada. */
  offline_message: string;
}

export function widgetSettings(
  config: WebchatConfig,
  fallbackName: string,
  extra?: { locale?: string | null; offline?: boolean },
): WebchatSettings {
  return {
    primary_color: config.primary_color || WEBCHAT_DEFAULTS.primary_color,
    position: config.position || WEBCHAT_DEFAULTS.position,
    greeting: config.greeting ?? '',
    brand_name: config.brand_name || fallbackName,
    avatar_url: config.avatar_url || null,
    require_email: config.require_email ?? WEBCHAT_DEFAULTS.require_email,
    auto_open_seconds: config.auto_open_seconds ?? WEBCHAT_DEFAULTS.auto_open_seconds,
    allow_uploads: config.allow_uploads ?? WEBCHAT_DEFAULTS.allow_uploads,
    ask_rating: config.ask_rating ?? WEBCHAT_DEFAULTS.ask_rating,
    locale: (extra?.locale ?? 'es').toLowerCase().startsWith('en') ? 'en' : 'es',
    // Sólo cuando de verdad está fuera de horario: mandarlo siempre y que el
    // chat decida sería contarle al visitante el horario del comercio.
    offline_message: extra?.offline ? (config.offline_message ?? '') : '',
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
 * `localhost` sólo entra fuera de producción.
 *
 * Entraba siempre, y eso anulaba la lista entera: la llave de instalación está
 * a la vista en el HTML de cualquier tienda, así que bastaba pedir la sesión
 * con `Origin: http://localhost` desde cualquier máquina del mundo para
 * conseguir un token bueno del comercio ajeno — y con él escribir en su bandeja
 * (cada mensaje dispara una respuesta del agente, que se paga), subir archivos
 * a su bucket y recorrerle el catálogo. Probar la instalación antes de
 * publicarla se hace en desarrollo, o agregando el dominio a la lista.
 */
const LOCAL = new Set(['localhost', '127.0.0.1', '[::1]']);

export function originAllowed(origin: string, domains: string[] | undefined): boolean {
  const host = normalizeOrigin(origin);
  if (!host) return false;
  // El puerto forma parte del host normalizado, así que hay que cortarlo: sin
  // esto `localhost:3000` pasaba y `127.0.0.1:3000` no, que es la misma máquina
  // escrita de las dos formas que usa cualquiera para levantar su tienda.
  const sinPuerto = host.split(':')[0];
  if (LOCAL.has(sinPuerto)) return process.env.NODE_ENV !== 'production';
  return (domains ?? []).some((d) => {
    const allowed = normalizeOrigin(d);
    if (!allowed) return false;
    return host === allowed || host.endsWith(`.${allowed}`);
  });
}
