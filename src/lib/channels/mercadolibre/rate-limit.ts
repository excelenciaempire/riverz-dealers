/**
 * Mercado Libre respondió 429: la cuota es POR APLICACIÓN, no por comercio, así
 * que seguir pidiendo le saca llamadas a todos los demás.
 *
 * Es un tipo propio y no un `Error` con el código en el texto para que quien
 * recorre la historia pueda distinguirlo de un hilo roto: un hilo roto se
 * saltea y la corrida sigue; un 429 corta la corrida sin mover el cursor.
 */
export class MlRateLimitError extends Error {
  constructor(where: string) {
    super(`${where} HTTP 429`);
    this.name = "MlRateLimitError";
  }
}

export function isMlRateLimit(err: unknown): err is MlRateLimitError {
  return err instanceof MlRateLimitError;
}

/** Corta con {@link MlRateLimitError} si la respuesta es un 429. */
export function throwIfRateLimited(res: Pick<Response, "status">, where: string): void {
  if (res.status === 429) throw new MlRateLimitError(where);
}
