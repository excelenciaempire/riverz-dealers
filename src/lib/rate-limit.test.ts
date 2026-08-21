import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __resetRateLimitForTests,
  checkRateLimit,
  clientIp,
  limitByKey,
  rateLimitResponse,
} from "./rate-limit";

const OPTS = { limit: 3, windowMs: 60_000 };

describe("checkRateLimit", () => {
  beforeEach(() => {
    __resetRateLimitForTests();
  });

  it("permits the first request and decrements remaining", () => {
    const result = checkRateLimit("user:1", OPTS);
    expect(result).toMatchObject({
      success: true,
      remaining: 2,
      limit: 3,
    });
    expect(result.reset).toBeGreaterThan(Date.now());
  });

  it("permits exactly `limit` requests then rejects the next", () => {
    expect(checkRateLimit("user:1", OPTS).success).toBe(true);
    expect(checkRateLimit("user:1", OPTS).success).toBe(true);
    expect(checkRateLimit("user:1", OPTS).success).toBe(true);
    const over = checkRateLimit("user:1", OPTS);
    expect(over.success).toBe(false);
    expect(over.remaining).toBe(0);
  });

  it("keeps separate counters per key", () => {
    checkRateLimit("user:1", OPTS);
    checkRateLimit("user:1", OPTS);
    checkRateLimit("user:1", OPTS);
    // user:1 is at the cap, user:2 should still be unaffected.
    const other = checkRateLimit("user:2", OPTS);
    expect(other.success).toBe(true);
    expect(other.remaining).toBe(2);
  });

  it("opens a fresh window after `windowMs` elapses", () => {
    vi.useFakeTimers();
    try {
      const t0 = new Date("2026-05-01T00:00:00Z").getTime();
      vi.setSystemTime(t0);
      __resetRateLimitForTests();

      checkRateLimit("user:1", OPTS);
      checkRateLimit("user:1", OPTS);
      checkRateLimit("user:1", OPTS);
      expect(checkRateLimit("user:1", OPTS).success).toBe(false);

      // Jump just past the window.
      vi.setSystemTime(t0 + OPTS.windowMs + 1);
      const refreshed = checkRateLimit("user:1", OPTS);
      expect(refreshed.success).toBe(true);
      expect(refreshed.remaining).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("rateLimitResponse", () => {
  it("returns a 429 with retry / X-RateLimit headers", async () => {
    const reset = Date.now() + 30_000;
    const res = rateLimitResponse({
      success: false,
      remaining: 0,
      reset,
      limit: 60,
    });
    expect(res.status).toBe(429);
    expect(res.headers.get("X-RateLimit-Limit")).toBe("60");
    expect(res.headers.get("X-RateLimit-Remaining")).toBe("0");
    expect(Number(res.headers.get("Retry-After"))).toBeGreaterThan(0);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/rate limit/i);
  });

  it("clamps Retry-After to a minimum of 1 second", () => {
    // Reset already in the past — the ceiling math would otherwise give 0.
    const res = rateLimitResponse({
      success: false,
      remaining: 0,
      reset: Date.now() - 5_000,
      limit: 10,
    });
    expect(Number(res.headers.get("Retry-After"))).toBeGreaterThanOrEqual(1);
  });
});

describe("RATE_LIMITS presets", () => {
  it("send and broadcast budgets are independent", async () => {
    __resetRateLimitForTests();
    // Importing here so the presets stay close to their assertions.
    const { RATE_LIMITS } = await import("./rate-limit");
    expect(RATE_LIMITS.send.limit).toBeGreaterThan(RATE_LIMITS.broadcast.limit);
    expect(RATE_LIMITS.send.windowMs).toBe(60_000);
    expect(RATE_LIMITS.broadcast.windowMs).toBe(60_000);
  });
});

describe("limitByKey (in-memory fallback when Upstash env missing)", () => {
  const ORIGINAL_URL = process.env.UPSTASH_REDIS_REST_URL;
  const ORIGINAL_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

  beforeEach(() => {
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    __resetRateLimitForTests();
  });

  afterEach(() => {
    if (ORIGINAL_URL === undefined) delete process.env.UPSTASH_REDIS_REST_URL;
    else process.env.UPSTASH_REDIS_REST_URL = ORIGINAL_URL;
    if (ORIGINAL_TOKEN === undefined) delete process.env.UPSTASH_REDIS_REST_TOKEN;
    else process.env.UPSTASH_REDIS_REST_TOKEN = ORIGINAL_TOKEN;
  });

  it("falls back to in-memory and enforces the limit", async () => {
    const a = await limitByKey("fallback:1", OPTS);
    const b = await limitByKey("fallback:1", OPTS);
    const c = await limitByKey("fallback:1", OPTS);
    const d = await limitByKey("fallback:1", OPTS);
    expect(a.success).toBe(true);
    expect(b.success).toBe(true);
    expect(c.success).toBe(true);
    expect(d.success).toBe(false);
    expect(d.remaining).toBe(0);
  });

  it("does NOT call fetch when env is missing", async () => {
    const spy = vi.spyOn(globalThis, "fetch");
    try {
      await limitByKey("fallback:nofetch", OPTS);
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });
});

describe("limitByKey (distributed Upstash path)", () => {
  const ORIGINAL_URL = process.env.UPSTASH_REDIS_REST_URL;
  const ORIGINAL_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

  beforeEach(() => {
    process.env.UPSTASH_REDIS_REST_URL = "https://fake-upstash.example.com";
    process.env.UPSTASH_REDIS_REST_TOKEN = "fake-token";
    __resetRateLimitForTests();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (ORIGINAL_URL === undefined) delete process.env.UPSTASH_REDIS_REST_URL;
    else process.env.UPSTASH_REDIS_REST_URL = ORIGINAL_URL;
    if (ORIGINAL_TOKEN === undefined) delete process.env.UPSTASH_REDIS_REST_TOKEN;
    else process.env.UPSTASH_REDIS_REST_TOKEN = ORIGINAL_TOKEN;
  });

  it("returns success while the mocked counter is at or below the limit, then false past it", async () => {
    let count = 0;
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (input, init) => {
        const url = typeof input === "string" ? input : input.toString();
        expect(url).toBe("https://fake-upstash.example.com/pipeline");
        const headers = (init?.headers ?? {}) as Record<string, string>;
        expect(headers.Authorization).toBe("Bearer fake-token");
        count += 1;
        const body: Array<{ result: unknown }> = [
          { result: count },
          { result: count === 1 ? 1 : 0 },
          { result: 42_000 },
        ];
        return new Response(JSON.stringify(body), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      });

    const r1 = await limitByKey("dist:1", OPTS);
    const r2 = await limitByKey("dist:1", OPTS);
    const r3 = await limitByKey("dist:1", OPTS);
    const r4 = await limitByKey("dist:1", OPTS);

    expect(r1.success).toBe(true);
    expect(r1.remaining).toBe(2);
    expect(r2.success).toBe(true);
    expect(r2.remaining).toBe(1);
    expect(r3.success).toBe(true);
    expect(r3.remaining).toBe(0);
    expect(r4.success).toBe(false);
    expect(r4.remaining).toBe(0);

    expect(fetchSpy).toHaveBeenCalledTimes(4);
  });

  it("falls back to in-memory if the Upstash fetch throws", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network down"));
    // Silence the warn we expect during fallback.
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const a = await limitByKey("dist:fallback", OPTS);
    const b = await limitByKey("dist:fallback", OPTS);
    const c = await limitByKey("dist:fallback", OPTS);
    const d = await limitByKey("dist:fallback", OPTS);
    expect(a.success).toBe(true);
    expect(b.success).toBe(true);
    expect(c.success).toBe(true);
    expect(d.success).toBe(false);
  });
});

afterEach(() => {
  __resetRateLimitForTests();
});

describe('clientIp detrás de Cloudflare', () => {
  const req = (headers: Record<string, string>) =>
    new Request('https://riverz.co/x', { headers });

  it('usa cf-connecting-ip cuando está', () => {
    // La que pone Cloudflare es la del cliente de verdad; el último token de
    // x-forwarded-for es el nodo de borde, y esos rotan — con él, cada
    // petición estrenaba cupo y el límite por IP no frenaba nada.
    expect(
      clientIp(
        req({
          'cf-ray': 'abc-MIA',
          'cf-connecting-ip': '203.0.113.7',
          'x-forwarded-for': '203.0.113.7, 172.71.1.9',
        }),
      ),
    ).toBe('203.0.113.7');
  });

  it('la misma IP de cliente da la misma clave aunque rote el borde', () => {
    const a = clientIp(req({ 'cf-ray': 'r1', 'cf-connecting-ip': '203.0.113.7', 'x-forwarded-for': '203.0.113.7, 172.71.1.9' }));
    const b = clientIp(req({ 'cf-ray': 'r2', 'cf-connecting-ip': '203.0.113.7', 'x-forwarded-for': '203.0.113.7, 172.68.44.2' }));
    expect(a).toBe(b);
  });

  it('acepta true-client-ip como alternativa, si viene por Cloudflare', () => {
    expect(clientIp(req({ 'cf-ray': 'abc-MIA', 'true-client-ip': '198.51.100.4' }))).toBe(
      '198.51.100.4',
    );
  });

  it('IGNORA la cabecera si la peticion no paso por Cloudflare', () => {
    // El host del origen sigue siendo alcanzable: sin esto, pegandole directo
    // con una `cf-connecting-ip` distinta en cada llamada, cada una estrenaba
    // su propio cupo — el mismo agujero que este arreglo vino a cerrar.
    expect(clientIp(req({ 'cf-connecting-ip': '203.0.113.7' }))).toBe('unknown');
    expect(
      clientIp(req({ 'cf-connecting-ip': '203.0.113.7', 'x-forwarded-for': '1.2.3.4, 10.0.0.1' })),
    ).toBe('10.0.0.1');
  });

  it('sin Cloudflare sigue leyendo x-forwarded-for como antes', () => {
    expect(clientIp(req({ 'x-forwarded-for': '203.0.113.7, 10.0.0.1' }))).toBe('10.0.0.1');
  });

  it('sin ninguna cabecera no inventa una IP', () => {
    expect(clientIp(req({}))).toBe('unknown');
  });
})
