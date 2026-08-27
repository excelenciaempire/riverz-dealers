import { createHmac, timingSafeEqual } from 'crypto';

/**
 * Las dos llaves del chat web. Ninguna se guarda en la base.
 *
 *   La llave de instalación (`widgetKey`) es la que el comercio pega en el
 *   HTML de su tienda. Va a la vista de cualquiera que mire el código fuente,
 *   así que no es un secreto y no pretende serlo: lo único que habilita es
 *   PEDIR una sesión, y eso sólo funciona desde los dominios que el comercio
 *   autorizó. Quien la copie a otro sitio no consigue nada.
 *
 *   El token de sesión (`sessionToken`) es el que sí manda: ata el workspace,
 *   el visitante y el origen validado, y caduca. Todo lo que el widget hace
 *   después —escribir, leer, identificarse— pasa por él, y el visitante nunca
 *   elige de qué conversación habla: sale del token.
 *
 * Las dos son firmas HMAC sobre `ENCRYPTION_KEY`, sin fila que crear ni que
 * revocar (mismo mecanismo que el hook de Klaviyo). Rotar la clave del
 * servidor invalida todo de una, que es la única revocación que hace falta.
 */

const KEY_DOMAIN = 'web-widget';
const SESSION_DOMAIN = 'web-widget-session';
const VISITOR_DOMAIN = 'web-widget-visitor';

/** Vida del token de sesión. Un día: lo suficiente para que quien vuelve por
 *  la tarde siga en el mismo hilo, poco para que uno filtrado sirva de algo.
 *  El loader lo renueva solo al abrir la página. */
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

function key(): Buffer {
  const k = process.env.ENCRYPTION_KEY;
  if (!k) throw new Error('ENCRYPTION_KEY not set — required to sign webchat tokens');
  return Buffer.from(k, 'hex');
}

function sign(domain: string, payload: string): string {
  return createHmac('sha256', key())
    .update(`${domain}:${payload}`)
    .digest('base64url')
    .slice(0, 32);
}

/** Comparación en tiempo constante que no lanza con largos distintos. */
function equals(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  if (x.length !== y.length) return false;
  return timingSafeEqual(x, y);
}

// ── Llave de instalación ─────────────────────────────────────────

/** La llave que va en el snippet: `<workspaceId>.<firma>`. */
export function widgetKey(workspaceId: string): string {
  return `${workspaceId}.${sign(KEY_DOMAIN, workspaceId)}`;
}

/** Workspace de la llave, o null si la firma no cierra. */
export function verifyWidgetKey(token: string): string | null {
  const at = token.lastIndexOf('.');
  if (at <= 0) return null;
  const workspaceId = token.slice(0, at);
  return equals(token, widgetKey(workspaceId)) ? workspaceId : null;
}

// ── Prueba de visitante ──────────────────────────────────────────

/** La forma que emitimos: `wv_` y un UUID de verdad. */
export const VISITOR_ID_RE =
  /^wv_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * El secreto que acompaña al id del visitante.
 *
 * El id NO es un secreto y no puede serlo: se estampa en el carrito de la
 * tienda (`attributes[riverz_wvid]`) para poder atribuir la venta, Shopify lo
 * arrastra hasta el pedido, y cualquier script de la página lo lee del
 * almacenamiento local. Aceptándolo pelado, quien lo viera se quedaba con el
 * hilo entero de esa persona: su conversación, los comprobantes que subió y la
 * posibilidad de escribir en su nombre.
 *
 * Así que el id sigue siendo público y esta firma es lo que prueba que es tuyo.
 * Vive junto al id en el dominio de la TIENDA, nunca viaja al pedido y no se
 * guarda en ninguna tabla.
 */
export function visitorProof(workspaceId: string, visitorId: string): string {
  return sign(VISITOR_DOMAIN, `${workspaceId}:${visitorId}`);
}

export function visitorProofValid(
  workspaceId: string,
  visitorId: string,
  proof: string | null | undefined,
): boolean {
  if (!proof) return false;
  return equals(proof, visitorProof(workspaceId, visitorId));
}

// ── Token de sesión ──────────────────────────────────────────────

export interface WebchatSession {
  workspaceId: string;
  /** Id del visitante que el loader guarda en el dominio de la tienda. */
  visitorId: string;
  /** Origen validado contra la lista de dominios al abrir la sesión. */
  origin: string;
  /** Vencimiento, epoch ms. */
  exp: number;
  /**
   * Las señales que Meta necesita para atribuir la venta a un anuncio.
   *
   * Viajan en el token y no en una tabla porque se leen ANTES de que exista la
   * conversación —el widget las captura al abrir la sesión, en la página de la
   * tienda— y se necesitan cuando llega el primer mensaje, que es cuando la
   * conversación se crea. Guardarlas aparte obligaba a una tabla de paso y a
   * una carrera entre las dos escrituras.
   *
   * No son un secreto: identifican al navegador de quien las trae. Van dentro
   * de la firma igual, para que nadie pueda atribuirle su compra a la campaña
   * de otro.
   */
  mk?: { fbp?: string; fbc?: string; url?: string };
  /**
   * Idioma del navegador del VISITANTE, dos letras.
   *
   * Sólo se usa cuando el comercio no fijó el idioma de su agente: ahí el
   * marco del chat caía en español pase lo que pase, así que una tienda sin
   * agente configurado le mostraba "Reanudar" a un cliente inglés. Viaja en el
   * token porque el único momento en que se puede leer es al abrir la sesión
   * desde la página de la tienda; después el chat corre en un iframe y las
   * llamadas siguientes no lo traen.
   */
  lc?: string;
}

/**
 * Firma una sesión. El payload va en claro (base64url de JSON) porque no hay
 * nada que esconder ahí: el visitante ya sabe quién es y en qué sitio está.
 * Lo que no puede es cambiarlo.
 */
export function mintSession(
  input: Omit<WebchatSession, 'exp'> & { exp?: number },
): string {
  const session: WebchatSession = {
    workspaceId: input.workspaceId,
    visitorId: input.visitorId,
    origin: input.origin,
    exp: input.exp ?? Date.now() + SESSION_TTL_MS,
    // Sólo si vinieron: un token con `mk: {}` en cada visita engorda todas las
    // peticiones a cambio de nada.
    ...(input.mk && Object.keys(input.mk).length > 0 ? { mk: input.mk } : {}),
    ...(input.lc ? { lc: input.lc } : {}),
  };
  const payload = Buffer.from(JSON.stringify(session)).toString('base64url');
  return `${payload}.${sign(SESSION_DOMAIN, payload)}`;
}

/** La sesión del token, o null si la firma no cierra o ya venció. */
export function verifySession(token: string | null | undefined): WebchatSession | null {
  if (!token) return null;
  const at = token.lastIndexOf('.');
  if (at <= 0) return null;
  const payload = token.slice(0, at);
  if (!equals(token.slice(at + 1), sign(SESSION_DOMAIN, payload))) return null;
  let session: WebchatSession;
  try {
    session = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (!session?.workspaceId || !session?.visitorId) return null;
  if (!Number.isFinite(session.exp) || session.exp < Date.now()) return null;
  return session;
}

/**
 * Lee el `Authorization: Bearer …` de un request del widget.
 *
 * `permitirQuery` lo acepta además como `?t=`, y existe por una sola razón:
 * un `<img src>` no manda cabeceras. Los adjuntos se dibujan con `<img>`,
 * `<video>` y `<audio>`, así que exigir la cabecera hacía que TODA foto que
 * mandaba el comercio —y la que acababa de subir el visitante— respondiera 401
 * y se viera como una burbuja rota. Sólo lo habilita la ruta de lectura de
 * archivos; para escribir sigue haciendo falta la cabecera, que no queda en el
 * historial del navegador ni en el `Referer`.
 */
export function sessionFromRequest(
  req: Request,
  opciones?: { permitirQuery?: boolean },
): WebchatSession | null {
  const header = req.headers.get('authorization') ?? '';
  const bearer = header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : '';
  const desdeHeader = verifySession(bearer);
  if (desdeHeader || !opciones?.permitirQuery) return desdeHeader;
  try {
    return verifySession(new URL(req.url).searchParams.get('t'));
  } catch {
    return null;
  }
}
