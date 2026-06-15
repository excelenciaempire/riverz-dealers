import { describe, expect, it, vi } from "vitest";

// next/headers is only callable inside a request scope. The verify
// function reads the cookie from the raw Cookie header first, so we
// only need to stub cookies() for the "no header, fall back to jar"
// branch.
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: () => undefined,
    set: () => {},
  }),
}));

import { generateCsrfToken, verifyCsrfHeader } from "./csrf";

function reqWithCookieAndHeader(cookie: string | null, header: string | null) {
  const headers = new Headers();
  if (cookie !== null) headers.set("cookie", `csrf=${cookie}`);
  if (header !== null) headers.set("x-csrf-token", header);
  return new Request("https://example.com/api/x", { method: "POST", headers });
}

describe("generateCsrfToken", () => {
  it("returns a 64-char hex string", () => {
    const t = generateCsrfToken();
    expect(t).toMatch(/^[a-f0-9]{64}$/);
  });
  it("returns distinct tokens across calls", () => {
    expect(generateCsrfToken()).not.toBe(generateCsrfToken());
  });
});

describe("verifyCsrfHeader", () => {
  it("accepts when cookie and header match", async () => {
    const t = generateCsrfToken();
    const ok = await verifyCsrfHeader(reqWithCookieAndHeader(t, t));
    expect(ok).toBe(true);
  });

  it("rejects when cookie and header differ", async () => {
    const a = generateCsrfToken();
    const b = generateCsrfToken();
    const ok = await verifyCsrfHeader(reqWithCookieAndHeader(a, b));
    expect(ok).toBe(false);
  });

  it("rejects when the x-csrf-token header is missing", async () => {
    const t = generateCsrfToken();
    const ok = await verifyCsrfHeader(reqWithCookieAndHeader(t, null));
    expect(ok).toBe(false);
  });

  it("rejects when the csrf cookie is missing", async () => {
    const t = generateCsrfToken();
    const ok = await verifyCsrfHeader(reqWithCookieAndHeader(null, t));
    expect(ok).toBe(false);
  });

  it("rejects when lengths differ even if prefix matches", async () => {
    const t = generateCsrfToken();
    const ok = await verifyCsrfHeader(reqWithCookieAndHeader(t, t.slice(0, 32)));
    expect(ok).toBe(false);
  });
});
