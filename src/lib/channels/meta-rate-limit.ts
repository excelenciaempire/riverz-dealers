/**
 * Límites de uso de Graph durante las importaciones de historia (DM y
 * comentarios).
 *
 * Meta no siempre responde 429 cuando frena: lo normal es un 400/403 con el
 * código en el cuerpo — `(#4)` límite de la app, `(#17)` del usuario, `(#32)`
 * de la página, `(#613)` llamadas por hora, y los 800xx del límite por caso de
 * uso (80001 páginas, 80002 Instagram, 80006 Messenger). Tratarlo como un
 * error cualquiera tenía dos costos: la conexión quedaba marcada en error por
 * algo que se cura solo, y el paso siguiente seguía golpeando a Graph y
 * estiraba el castigo. Ante un límite la importación se detiene, guarda el
 * cursor y sigue en la corrida siguiente.
 */

const CODIGOS_DE_LIMITE = new Set([4, 17, 32, 613]);

function esCodigoDeLimite(code: unknown): boolean {
  const n = Number(code);
  if (!Number.isInteger(n)) return false;
  return CODIGOS_DE_LIMITE.has(n) || (n >= 80_000 && n < 80_100);
}

/** ¿La respuesta de Graph es un límite de uso? `body` es el texto crudo o ya
 *  parseado; un cuerpo ilegible sólo cuenta si el estado es 429. */
export function isMetaRateLimited(status: number, body: unknown): boolean {
  if (status === 429) return true;
  let parsed: unknown = body;
  if (typeof body === 'string') {
    try {
      parsed = JSON.parse(body);
    } catch {
      return /^\s*\(#(4|17|32|613)\)/.test(body);
    }
  }
  const err = (parsed as { error?: { code?: unknown; message?: unknown } } | null)?.error;
  if (!err) return false;
  if (esCodigoDeLimite(err.code)) return true;
  return typeof err.message === 'string' && /^\s*\(#(4|17|32|613)\)/.test(err.message);
}

/** Lee el cuerpo sin consumir la respuesta original. */
export async function isMetaRateLimitedResponse(response: Response): Promise<boolean> {
  if (response.ok) return false;
  if (response.status === 429) return true;
  if (typeof response.clone !== 'function') return false;
  const body = await response.clone().text().catch(() => '');
  return isMetaRateLimited(response.status, body);
}

/** Graph pidió frenar. Quien la atrapa no marca la pasada como terminada ni
 *  la conexión en error: guarda el cursor y deja el resto para la próxima. */
export class MetaRateLimitError extends Error {
  constructor(message = 'meta_rate_limited') {
    super(message);
    this.name = 'MetaRateLimitError';
  }
}

export function isMetaRateLimitError(err: unknown): err is MetaRateLimitError {
  return err instanceof MetaRateLimitError;
}
