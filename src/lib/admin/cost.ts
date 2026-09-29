/**
 * Costo estimado de la IA a partir de los tokens.
 *
 * `ai_replies` guarda `prompt_tokens` y `completion_tokens` en cada despacho
 * desde la migración 024 — y hasta ahora nadie los leyó nunca. Con eso y la
 * tarifa del modelo sale el costo real por comercio.
 *
 * Es una ESTIMACIÓN: son los precios de lista de la API de Anthropic, sin
 * descuentos por caché de prompts (que abarata las lecturas ~10x) ni por lote.
 * Sirve para comparar comercios entre sí y ver la tendencia, no para facturar.
 */

/** USD por millón de tokens, por modelo. */
interface Rate {
  input: number;
  output: number;
}

/**
 * Lo que cuesta la caché, en proporción al token de entrada.
 *
 * Leer de la caché sale una décima parte, con cualquier TTL. Escribirla
 * depende de cuánto dura: un 25% más con la caché de 5 minutos, el doble con
 * la de 1 hora. Del 2026-09-17 al 29 el asistente escribió su prompt entero
 * con la de 1 hora, aunque llevaba datos de cada cliente y no se compartía
 * entre chats: pagar el doble salía más caro que no cachear. Desde entonces va
 * por capas (ver `SystemPorCapas`): lo compartido con la de 1 hora y lo de
 * cada persona con la de 5 minutos.
 */
const CACHE_READ = 0.1;
const CACHE_WRITE_5M = 1.25;
const CACHE_WRITE_1H = 2;
export type CacheTtl = '5m' | '1h';

/**
 * Con qué caché se escribió una respuesta del asistente, según cuándo salió.
 *
 * Para las filas de `ai_replies` anteriores a la migración 300, que guardan un
 * solo número de escritura y no dicen de qué TTL era. Antes de esas dos
 * semanas fue la de cinco minutos; tarifar esas filas al doble inflaría un 60%
 * la parte de escritura. Las filas nuevas traen `cache_write_1h_tokens`.
 */
const CACHE_1H_DESDE = Date.UTC(2026, 8, 17);
const CACHE_1H_HASTA = Date.UTC(2026, 8, 30);
export function ttlDeCacheDelAsistente(createdAt: string | Date | null | undefined): CacheTtl {
  if (!createdAt) return '5m';
  const t = createdAt instanceof Date ? createdAt.getTime() : Date.parse(createdAt);
  return Number.isFinite(t) && t >= CACHE_1H_DESDE && t < CACHE_1H_HASTA ? '1h' : '5m';
}

const RATES: Record<string, Rate> = {
  'claude-haiku-4-5': { input: 1, output: 5 },
  'claude-sonnet-5-5': { input: 2, output: 10 },
  'claude-sonnet-5': { input: 2, output: 10 },
  'claude-sonnet-4-6': { input: 3, output: 15 },
  'claude-sonnet-4-5': { input: 3, output: 15 },
  'claude-opus-5': { input: 5, output: 25 },
  'claude-opus-4-8': { input: 5, output: 25 },
  'claude-opus-4-7': { input: 5, output: 25 },
  'claude-opus-4-6': { input: 5, output: 25 },
  'claude-fable-5': { input: 10, output: 50 },

  // ── Los proveedores de RESPALDO ──────────────────────────────────────────
  //
  // `completeText` cae a Groq, OpenRouter o Gemini cuando Anthropic no
  // responde. Sin sus precios acá, `rateFor` devolvía la tarifa de Haiku para
  // todos: al comercio se le cobraba entre 2 y 13 veces lo que la llamada
  // costó de verdad. Cobrar de más es tan malo como cobrar de menos cuando lo
  // que se prometió es pasar el costo tal cual.
  'llama-3.3-70b-versatile': { input: 0.59, output: 0.79 },
  'llama-3.1-8b-instant': { input: 0.05, output: 0.08 },
  'gemini-2.0-flash': { input: 0.1, output: 0.4 },
  'google/gemini-2.0-flash-001': { input: 0.1, output: 0.4 },

  // ── Jev (TypeSafe) ───────────────────────────────────────────────────────
  //
  // El clasificador: escalar o no, qué intención, spam o no. Cobra sólo la
  // entrada; la salida es gratis porque no genera texto, devuelve
  // probabilidades. Ver `src/lib/ai/jev.ts`.
  'jev-1.13.0': { input: 0.042, output: 0 },
  'jev-latest': { input: 0.042, output: 0 },
};

/** El modelo por defecto de los agentes (migración 024). */
const DEFAULT_MODEL = 'claude-haiku-4-5';

/**
 * Los ids llevan sufijo de fecha (`claude-haiku-4-5-20251001`); la tarifa está
 * indexada por el alias. Se recorta el sufijo antes de buscar.
 */
export function rateFor(model: string | null | undefined): Rate {
  const id = (model ?? DEFAULT_MODEL).trim();
  const overrides = JSON.parse(
    process.env.AI_MODEL_USAGE_RATES_JSON || '{}'
  ) as Record<string, Rate>;
  const custom = overrides[id];
  if (custom) {
    if (
      ![custom.input, custom.output].every((n) => Number.isFinite(n) && n >= 0)
    )
      throw new Error('wallet_invalid_model_rate');
    return custom;
  }
  if (RATES[id]) return RATES[id];
  const withoutDate = id.replace(/-\d{8}$/, '');
  const rate = RATES[withoutDate];
  if (!rate) throw new Error(`wallet_unknown_model_rate: ${id}`);
  return rate;
}

export function costForModel(
  model: string | null | undefined,
  promptTokens: number,
  completionTokens: number,
  /**
   * Los tokens de caché, que NO vienen dentro de `promptTokens`.
   *
   * Omitirlos devuelve el número de antes, que es un PISO y no el costo: el
   * prompt del sistema va cacheado, así que en una conversación con historia la
   * lectura de caché es la mayor parte de lo que se paga. Se dejan opcionales
   * porque las filas anteriores a la migración 215 no los tienen y no se pueden
   * inventar.
   *
   * `write1h` es la parte de `write` que se escribió con la caché de una hora,
   * cuando se sabe (migración 300). Si no, `ttl` dice de cuál fue toda.
   */
  cache?: { read?: number; write?: number; ttl?: CacheTtl; write1h?: number }
): number {
  const rate = rateFor(model);
  const write = cache?.write ?? 0;
  const write1h = Math.min(write, cache?.write1h ?? (cache?.ttl === '1h' ? write : 0));
  return (
    (promptTokens / 1_000_000) * rate.input +
    (completionTokens / 1_000_000) * rate.output +
    ((cache?.read ?? 0) / 1_000_000) * rate.input * CACHE_READ +
    ((write - write1h) / 1_000_000) * rate.input * CACHE_WRITE_5M +
    (write1h / 1_000_000) * rate.input * CACHE_WRITE_1H
  );
}
