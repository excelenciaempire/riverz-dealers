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

/**
 * Qué se le pide al visitante antes de escribir.
 *
 * `require_email` era un sí/no y sigue existiendo en las configuraciones ya
 * guardadas: un booleano viejo se lee como "pedir el correo". Lo nuevo se
 * guarda en `require_contact`, que manda cuando está.
 *
 * El teléfono no es un campo más: es lo que convierte a un anónimo que cierra
 * la pestaña en alguien a quien el comercio puede volver a escribirle.
 */
export type DatosPedidos = 'off' | 'email' | 'phone' | 'both';

export function datosPedidos(config: WebchatConfig): DatosPedidos {
  const v = config.require_contact;
  if (v === 'off' || v === 'email' || v === 'phone' || v === 'both') return v;
  return config.require_email ? 'email' : 'off';
}

/** Lo que el widget necesita saber para dibujarse. Nunca incluye los dominios
 *  ni el agente: eso es del comercio, no del visitante. */
export interface WebchatSettings {
  primary_color: string;
  position: 'right' | 'left';
  greeting: string;
  brand_name: string;
  avatar_url: string | null;
  require_email: boolean;
  /** Qué se pide antes de escribir: nada, correo, teléfono o los dos. */
  require_contact: DatosPedidos;
  /** Ofrecer "Seguir por WhatsApp". Sólo llega en true si además hay WhatsApp
   *  conectado: un botón que no lleva a ningún lado es peor que no tenerlo. */
  whatsapp_handoff: boolean;
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
  /** Preguntas sugeridas bajo el saludo. Vacío = ninguna. */
  quick_replies: string[];
  /** La invitación: texto de la burbuja, y cuándo aparece además del tiempo. */
  proactive_message: string;
  proactive_on_exit: boolean;
  proactive_scroll_percent: number;
  proactive_urls: string[];
}

/** El % de página a partir del cual se invita. Fuera de 10–100, no se invita. */
export function porcentajeDeScroll(valor: unknown): number {
  const n = Math.floor(Number(valor));
  if (!Number.isFinite(n) || n < 10) return 0;
  return Math.min(100, n);
}

/** Trozos de URL donde vale la invitación. Vacío = en todas. */
export function urlsDeInvitacion(valor: unknown): string[] {
  if (!Array.isArray(valor)) return [];
  const limpias = valor
    .map((v) => (typeof v === 'string' ? v.trim().slice(0, 120) : ''))
    .filter(Boolean);
  return Array.from(new Set(limpias)).slice(0, 10);
}

/**
 * Las preguntas sugeridas, acotadas.
 *
 * Se recorta al LEER además de al guardar, por lo mismo que
 * `segundosDeApertura`: la configuración la escriben también el Operador, el
 * MCP y las correcciones a mano, y ninguno de esos caminos pasa por el
 * validador del panel. Cuatro es el tope porque a partir de ahí dejan de ser
 * sugerencias y pasan a ser un menú, que es justo lo que un chat no es.
 */
export function preguntasSugeridas(valor: unknown): string[] {
  if (!Array.isArray(valor)) return [];
  const limpias = valor
    .map((v) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, 60) : ''))
    .filter(Boolean);
  return Array.from(new Set(limpias)).slice(0, 4);
}

/**
 * A los cuántos segundos se abre solo, dentro de lo razonable.
 *
 * El recorte estaba SÓLO al guardar desde el panel. Cualquier otro camino que
 * escriba la configuración —el Operator, el MCP, una importación, un arreglo a
 * mano— dejaba pasar un 1 (un pop-up encima de quien recién entró) o un 999
 * (que no ve nadie). Se recorta también al leer: así el número que llega al
 * navegador es siempre uno que tiene sentido, lo haya escrito quien lo haya
 * escrito. 0 sigue significando "no se abre solo".
 */
export function segundosDeApertura(valor: number | null | undefined): number {
  const n = Math.floor(Number(valor));
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(120, Math.max(3, n));
}

export function widgetSettings(
  config: WebchatConfig,
  fallbackName: string,
  extra?: {
    locale?: string | null;
    offline?: boolean;
    visitorLocale?: string | null;
    /** ¿El comercio tiene WhatsApp conectado? Lo resuelve quien llama. */
    hasWhatsApp?: boolean;
  },
): WebchatSettings {
  return {
    primary_color: config.primary_color || WEBCHAT_DEFAULTS.primary_color,
    position: config.position || WEBCHAT_DEFAULTS.position,
    greeting: config.greeting ?? '',
    brand_name: config.brand_name || fallbackName,
    avatar_url: config.avatar_url || null,
    require_email: config.require_email ?? WEBCHAT_DEFAULTS.require_email,
    require_contact: datosPedidos(config),
    // El botón sólo existe si hay a dónde ir. Ofrecer "Seguir por WhatsApp" sin
    // WhatsApp conectado es prometer un canal que no contesta.
    whatsapp_handoff: config.whatsapp_handoff === true && extra?.hasWhatsApp === true,
    auto_open_seconds: segundosDeApertura(config.auto_open_seconds),
    allow_uploads: config.allow_uploads ?? WEBCHAT_DEFAULTS.allow_uploads,
    ask_rating: config.ask_rating ?? WEBCHAT_DEFAULTS.ask_rating,
    // El idioma del agente manda; el del navegador del visitante es el
    // desempate cuando el comercio no fijó ninguno. Antes ese caso caía en
    // español pase lo que pase: una tienda sin agente configurado le mostraba
    // "Reanudar" a un cliente que lee en inglés. El dato ya viajaba desde el
    // cargador y no lo leía nadie.
    locale: (extra?.locale ?? extra?.visitorLocale ?? 'es').toLowerCase().startsWith('en')
      ? 'en'
      : 'es',
    // Sólo cuando de verdad está fuera de horario: mandarlo siempre y que el
    // chat decida sería contarle al visitante el horario del comercio.
    offline_message: extra?.offline ? (config.offline_message ?? '') : '',
    quick_replies: preguntasSugeridas(config.quick_replies),
    proactive_message: (config.proactive_message ?? '').slice(0, 200),
    proactive_on_exit: config.proactive_on_exit === true,
    proactive_scroll_percent: porcentajeDeScroll(config.proactive_scroll_percent),
    proactive_urls: urlsDeInvitacion(config.proactive_urls),
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
