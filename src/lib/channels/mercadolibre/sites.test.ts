import { describe, expect, it } from "vitest";

import { mercadoLibreWebOrigin } from "./sites";

describe("mercadoLibreWebOrigin", () => {
  it("links each seller to their own country's site", () => {
    expect(mercadoLibreWebOrigin("MCO")).toBe("https://www.mercadolibre.com.co");
    expect(mercadoLibreWebOrigin("MLM")).toBe("https://www.mercadolibre.com.mx");
    expect(mercadoLibreWebOrigin("mla")).toBe("https://www.mercadolibre.com.ar");
  });

  it("falls back to Argentina when the site is unknown", () => {
    expect(mercadoLibreWebOrigin(undefined)).toBe("https://www.mercadolibre.com.ar");
    expect(mercadoLibreWebOrigin("XYZ")).toBe("https://www.mercadolibre.com.ar");
  });
});
