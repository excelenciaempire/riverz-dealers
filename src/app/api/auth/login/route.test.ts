import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// signInWithPassword behaviour is swapped per-test via this shared
// reference so we can simulate "no such email", "wrong password" and
// success without rebuilding the module under test each time.
const signInResult = { error: null as null | { message: string } };

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      signInWithPassword: vi.fn(async () => signInResult),
    },
  }),
}));

// La ruta resuelve el idioma del mensaje con `cookies()`, que fuera de un
// request de Next lanza. Sin cookie de idioma la app cae al español, que es
// justo lo que afirman las aserciones de abajo.
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
}));

import { POST } from "./route";
import { __resetRateLimitForTests } from "@/lib/rate-limit";

function loginRequest(body: unknown, ip = "203.0.113.10") {
  return new Request("https://example.com/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify(body),
  });
}

const GENERIC_FAIL = {
  error: "credenciales_invalidas",
  message: "Email o contraseña incorrectos.",
};

beforeEach(() => {
  __resetRateLimitForTests();
  signInResult.error = null;
});

afterEach(() => {
  __resetRateLimitForTests();
});

describe("POST /api/auth/login — anti-enumeration", () => {
  it("returns the generic body when the email does not exist", async () => {
    signInResult.error = { message: "Email not confirmed" };
    const res = await POST(
      loginRequest({ email: "ghost@example.com", password: "whatever123" }),
    );
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual(GENERIC_FAIL);
  });

  it("returns the SAME generic body when the password is wrong", async () => {
    signInResult.error = { message: "Invalid login credentials" };
    const res = await POST(
      loginRequest(
        { email: "real@example.com", password: "wrongpass" },
        "203.0.113.11",
      ),
    );
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual(GENERIC_FAIL);
  });

  it("returns the same shape for the missing-fields branch", async () => {
    const res = await POST(loginRequest({ email: "", password: "" }));
    expect(await res.json()).toEqual(GENERIC_FAIL);
  });

  it("waits at least ~300ms before responding on failure", async () => {
    signInResult.error = { message: "Invalid login credentials" };
    const t0 = Date.now();
    await POST(
      loginRequest(
        { email: "slow@example.com", password: "wrong" },
        "203.0.113.12",
      ),
    );
    // Some slack for CI jitter; the floor is the contract.
    expect(Date.now() - t0).toBeGreaterThanOrEqual(290);
  });
});
