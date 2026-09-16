/**
 * Per-key rate limiter — Upstash Redis (distributed) with in-memory
 * fallback.
 *
 * If UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN are set,
 * `limitByKey` enforces the budget through Upstash's REST API
 * (INCR + EXPIRE NX, pipelined). One Redis round-trip per check; the
 * counter is shared across every replica that points at the same
 * Upstash database.
 *
 * If those env vars are missing, both `limitByKey` and the legacy
 * `checkRateLimit` fall back to a process-local Map. That mode is fine
 * for a single Node process but silently allows burst-over-limit on a
 * multi-replica deploy — we emit a one-time warning at module load so
 * the misconfiguration shows up in the logs.
 *
 * The in-memory Map self-drains via opportunistic sweeps (every
 * ~1 000th call) so no background timer is required and the limiter
 * works in serverless edge runtimes that don't keep timers alive
 * across requests.
 */

import { NextResponse } from 'next/server';

export interface RateLimitOptions {
  /** Max requests allowed in `windowMs`. */
  limit: number;
  /** Window size, milliseconds. */
  windowMs: number;
}

export interface RateLimitResult {
  success: boolean;
  /** Requests still allowed in the current window. */
  remaining: number;
  /** Unix ms when the bucket refills. */
  reset: number;
  limit: number;
}

interface Entry {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Entry>();

const LIGHT_SWEEP_EVERY = 1000;
let callsSinceSweep = 0;

function sweepExpired(now: number) {
  for (const [k, v] of buckets) {
    if (v.resetAt <= now) buckets.delete(k);
  }
}

function checkRateLimitInMemory(
  key: string,
  { limit, windowMs }: RateLimitOptions,
): RateLimitResult {
  const now = Date.now();

  callsSinceSweep += 1;
  if (callsSinceSweep >= LIGHT_SWEEP_EVERY) {
    callsSinceSweep = 0;
    sweepExpired(now);
  }

  const entry = buckets.get(key);

  if (!entry || entry.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { success: true, remaining: limit - 1, reset: now + windowMs, limit };
  }

  if (entry.count >= limit) {
    return { success: false, remaining: 0, reset: entry.resetAt, limit };
  }

  entry.count += 1;
  return {
    success: true,
    remaining: limit - entry.count,
    reset: entry.resetAt,
    limit,
  };
}

function upstashConfig(): { url: string; token: string } | null {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  return { url: url.replace(/\/+$/, ''), token };
}

let warnedInMemory = false;
function warnInMemoryOnce() {
  if (warnedInMemory) return;
  warnedInMemory = true;
  if (process.env.NODE_ENV === 'test') return;
  console.warn(
    'Rate limit is in-memory; multi-replica deploys WILL allow burst over the limit. ' +
      'Set UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN for distributed enforcement.',
  );
}

if (!upstashConfig()) {
  warnInMemoryOnce();
}

type PipelineReply = Array<{ result?: unknown; error?: string }>;

async function checkRateLimitUpstash(
  key: string,
  { limit, windowMs }: RateLimitOptions,
  cfg: { url: string; token: string },
): Promise<RateLimitResult> {
  const windowSec = Math.max(1, Math.ceil(windowMs / 1000));
  const now = Date.now();

  const body = JSON.stringify([
    ['INCR', key],
    ['EXPIRE', key, String(windowSec), 'NX'],
    ['PTTL', key],
  ]);

  const res = await fetch(`${cfg.url}/pipeline`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${cfg.token}`,
      'Content-Type': 'application/json',
    },
    body,
    cache: 'no-store',
  });

  if (!res.ok) {
    throw new Error(`Upstash rate-limit pipeline failed: ${res.status}`);
  }

  const replies = (await res.json()) as PipelineReply;
  const incrReply = replies[0];
  if (!incrReply || incrReply.error || typeof incrReply.result !== 'number') {
    throw new Error(
      `Upstash INCR returned an unexpected reply: ${JSON.stringify(incrReply)}`,
    );
  }
  const count = incrReply.result;

  const pttlReply = replies[2];
  const pttl =
    pttlReply && typeof pttlReply.result === 'number' ? pttlReply.result : -1;
  const reset = pttl > 0 ? now + pttl : now + windowSec * 1000;

  if (count > limit) {
    return { success: false, remaining: 0, reset, limit };
  }
  return {
    success: true,
    remaining: Math.max(0, limit - count),
    reset,
    limit,
  };
}

/**
 * Synchronous, in-memory only. Kept for backward compatibility with
 * existing call sites. Use `limitByKey` (async) on new code paths so
 * the limit is enforced across replicas when Upstash is configured.
 */
export function checkRateLimit(
  key: string,
  opts: RateLimitOptions,
): RateLimitResult {
  return checkRateLimitInMemory(key, opts);
}

/**
 * Distributed-when-configured rate limit check. Falls back to the
 * in-memory store when Upstash env is missing, or when the Upstash
 * round-trip throws (fail-open: a Redis blip should not lock users out).
 */
export async function limitByKey(
  key: string,
  opts: RateLimitOptions,
): Promise<RateLimitResult> {
  const cfg = upstashConfig();
  if (!cfg) {
    return checkRateLimitInMemory(key, opts);
  }
  try {
    return await checkRateLimitUpstash(key, opts, cfg);
  } catch (err) {
    console.warn('Upstash rate-limit unavailable, falling back to in-memory:', err);
    return checkRateLimitInMemory(key, opts);
  }
}

/**
 * Standard 429 response with the headers clients expect (RFC 6585 +
 * draft-ietf-httpapi-ratelimit-headers). Callers just `return` this.
 */
export function rateLimitResponse(result: RateLimitResult): NextResponse {
  const retryAfterSec = Math.max(1, Math.ceil((result.reset - Date.now()) / 1000));
  return NextResponse.json(
    {
      error: 'Rate limit exceeded',
      retry_after_seconds: retryAfterSec,
    },
    {
      status: 429,
      headers: {
        'Retry-After': String(retryAfterSec),
        'X-RateLimit-Limit': String(result.limit),
        'X-RateLimit-Remaining': String(result.remaining),
        'X-RateLimit-Reset': String(Math.ceil(result.reset / 1000)),
      },
    },
  );
}

/** Preconfigured budgets, tweak here not at call sites. */
export const RATE_LIMITS = {
  send: { limit: 60, windowMs: 60_000 },
  broadcast: { limit: 5, windowMs: 60_000 },
  react: { limit: 120, windowMs: 60_000 },
  auth: { limit: 5, windowMs: 5 * 60_000 },
  // Iniciar sesión tiene su propio presupuesto, más holgado que el de
  // registro y recuperación (decidido por el dueño el 2026-09-16): con 5 cada
  // 5 minutos, un comercio que se equivocaba la contraseña un par de veces —o
  // dos personas del mismo local detrás de la misma IP— veía "vuelve a probar
  // en 156 segundos" y se quedaba afuera. Diez cada tres minutos sigue
  // frenando un ataque de fuerza bruta (Supabase Auth además limita por IP
  // del lado suyo) y casi ninguna persona real lo ve.
  login: { limit: 10, windowMs: 3 * 60_000 },
} as const;

/** Best-effort client IP from common proxy headers, falling back to
 *  a literal so the limiter still works on a single tenant.
 *
 *  X-Forwarded-For lo APPENDEA el proxy confiable (Render) al final; lo que
 *  el cliente pone llega a la izquierda. Tomar el primer token dejaba que un
 *  atacante falsificara su IP rotando el header y evadiera el rate-limit
 *  per-IP de auth. Tomamos el token a `TRUSTED_PROXY_HOPS` posiciones desde
 *  el final (default 1 = un único proxy frontal), que el cliente no puede
 *  falsificar. */
export function clientIp(req: Request): string {
  // El proxy que sí sabe quién llama.
  //
  // Detrás de Cloudflare, `x-forwarded-for` termina en la IP del nodo de borde
  // que atendió la petición — y esos rotan. Tomando el token desde el final se
  // obtenía una IP distinta casi en cada request, así que cada una estrenaba su
  // propio cupo y el límite por IP no frenaba nada: medido en producción el
  // 2026-08-20, 100 peticiones seguidas contra un endpoint con tope de 30
  // pasaron las 100. (Lo que sí frenaba era el límite por correo del login, que
  // usa una clave estable — por eso el agujero no se veía.)
  //
  // `cf-connecting-ip` la pone Cloudflare y no la puede falsear quien entra por
  // ahí: si el cliente manda una, Cloudflare la reemplaza.
  //
  // Pero sólo vale si la petición pasó por Cloudflare, y el host del origen
  // sigue siendo alcanzable: pegándole directo con una `cf-connecting-ip`
  // distinta en cada llamada, cada una estrenaría cupo — el mismo agujero que
  // esto vino a cerrar. `cf-ray` es un identificador que Cloudflare agrega a
  // TODA petición que atraviesa: exigirlo hace que la cabecera sólo se crea
  // cuando viene acompañada de la huella del proxy.
  //
  // Lo que esto NO puede arreglar solo: que el host del origen esté abierto.
  // Cerrarlo es del lado de la plataforma.
  const porCloudflare = req.headers.get("cf-ray");
  if (porCloudflare) {
    const cf = req.headers.get("cf-connecting-ip") ?? req.headers.get("true-client-ip");
    if (cf?.trim()) return cf.trim();
  }

  const trustedHops = Math.max(
    1,
    Number(process.env.TRUSTED_PROXY_HOPS ?? "1") || 1,
  );
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) {
    const parts = fwd
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean);
    if (parts.length) {
      const idx = Math.max(0, parts.length - trustedHops);
      const ip = parts[idx];
      if (ip) return ip;
    }
  }
  const real = req.headers.get("x-real-ip");
  if (real) return real.trim();
  return "unknown";
}

/** Test-only helper. Clears the in-memory state so unit tests don't
 *  leak buckets across files. Not wired up in production code. */
export function __resetRateLimitForTests() {
  buckets.clear();
  callsSinceSweep = 0;
  warnedInMemory = false;
}
