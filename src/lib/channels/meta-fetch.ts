/** Estados que Meta documenta o usa para fallos transitorios de Graph. */
export function isRetryableMetaStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

/**
 * Cuatro intentos en total. El retraso completo es corto (5,2 s), pero alcanza
 * para absorber el 500 efímero que a veces devuelve Graph sin convertir una
 * corrida sana en una alarma ni esperar hasta el siguiente cron.
 */
export const META_RETRY_DELAYS_MS = [400, 1_200, 3_600] as const;

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_RETRY_AFTER_MS = 10_000;

type MetaFetchOptions = {
  /** Corte por intento. */
  timeoutMs?: number;
  /** Corte absoluto de la operación dueña (por ejemplo, el cron entero). */
  deadlineMs?: number;
  /** Inyectable para pruebas; producción usa la secuencia conservadora. */
  retryDelaysMs?: readonly number[];
};

/**
 * GET resiliente para Meta Graph.
 *
 * Reintenta únicamente errores recuperables: red/timeout, rate limit y 5xx.
 * Los 4xx funcionales vuelven de inmediato para que el llamador pueda marcar
 * permisos o token vencido sin castigar a Meta con llamadas inútiles.
 */
export async function fetchMetaGraph(
  url: string,
  init: RequestInit = {},
  options: MetaFetchOptions = {}
): Promise<Response> {
  const delays = options.retryDelaysMs ?? META_RETRY_DELAYS_MS;
  let lastError: unknown;

  for (let attempt = 0; attempt <= delays.length; attempt++) {
    if (init.signal?.aborted) throw init.signal.reason;

    const remaining = options.deadlineMs
      ? options.deadlineMs - Date.now()
      : Number.POSITIVE_INFINITY;
    if (remaining <= 0) {
      if (lastError) throw lastError;
      throw new DOMException('Meta Graph deadline exceeded', 'TimeoutError');
    }

    const timeoutMs = Math.max(
      1,
      Math.min(options.timeoutMs ?? DEFAULT_TIMEOUT_MS, remaining)
    );
    const timeoutSignal = AbortSignal.timeout(timeoutMs);
    const signal = init.signal
      ? AbortSignal.any([init.signal, timeoutSignal])
      : timeoutSignal;

    try {
      const response = await fetch(url, { ...init, signal });
      if (
        !isRetryableMetaStatus(response.status) ||
        attempt === delays.length
      ) {
        return response;
      }

      const waitMs = retryDelayMs(response, delays[attempt]);
      if (Date.now() + waitMs >= (options.deadlineMs ?? Infinity)) {
        return response;
      }
      await response.body?.cancel().catch(() => undefined);
      await wait(waitMs);
    } catch (error) {
      lastError = error;
      if (attempt === delays.length || init.signal?.aborted) throw error;
      const waitMs = delays[attempt];
      if (Date.now() + waitMs >= (options.deadlineMs ?? Infinity)) throw error;
      await wait(waitMs);
    }
  }

  // El bucle siempre devuelve o lanza; deja la garantía explícita para TS.
  throw lastError;
}

function retryDelayMs(response: Response, fallbackMs: number): number {
  const raw = response.headers.get('retry-after');
  if (!raw) return fallbackMs;
  const seconds = Number(raw);
  const parsed = Number.isFinite(seconds)
    ? seconds * 1_000
    : Date.parse(raw) - Date.now();
  if (!Number.isFinite(parsed) || parsed < 0) return fallbackMs;
  return Math.min(parsed, MAX_RETRY_AFTER_MS);
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
