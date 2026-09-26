/**
 * Un proveedor de correo que dice "ahora no" (429, 5xx, la red cortada).
 *
 * Antes el recorrido trataba esa respuesta como "este correo no existe": lo
 * salteaba, avanzaba el cursor y el mensaje no volvía a pedirse nunca. En la
 * importación del historial —cientos de pedidos seguidos— un límite de tasa
 * pasaba a ser correo perdido en silencio.
 *
 * Ahora es un error: corta la corrida ANTES de guardar el cursor, y la
 * siguiente corrida del cron repite el tramo. Lo ya guardado no se repite
 * (se busca por id externo antes de bajar nada).
 */
export class FallaTransitoria extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'FallaTransitoria';
  }
}

/** El 403 de Google cuando lo que se agotó es la cuota, no el permiso. */
export function esCuotaAgotada(detalle: string): boolean {
  return /quota exceeded|ratelimitexceeded|userratelimitexceeded|rate limit/i.test(detalle);
}

/** 429 y 5xx: el proveedor va a contestar si se le vuelve a preguntar. */
export function esEstadoTransitorio(status: number): boolean {
  return status === 429 || status >= 500;
}

/**
 * `fetch` que convierte una respuesta transitoria o una caída de red en
 * {@link FallaTransitoria}. Cualquier otra respuesta vuelve tal cual para que
 * quien llama decida (un 404 es un correo borrado, no un reintento).
 */
export async function pedirAlProveedor(
  url: string | URL,
  init: RequestInit,
  contexto: string,
): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch (err) {
    const detalle = err instanceof Error ? err.message : String(err);
    throw new FallaTransitoria(`${contexto}: ${detalle}`);
  }
  if (esEstadoTransitorio(res.status)) {
    const detalle = await res.text().catch(() => '');
    throw new FallaTransitoria(`${contexto} ${res.status}: ${detalle.slice(0, 300)}`, res.status);
  }
  // Gmail avisa la cuota agotada con un 403 ("Quota exceeded", "rate limit"),
  // no con un 429: es un "ahora no", no un permiso que falta.
  if (res.status === 403) {
    const detalle = await res.clone().text().catch(() => '');
    if (esCuotaAgotada(detalle)) {
      throw new FallaTransitoria(`${contexto} 403: ${detalle.slice(0, 300)}`, 429);
    }
  }
  return res;
}
