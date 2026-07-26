import { describe, expect, it } from "vitest";
import { isUnsupportedMediaSnippet, isUnsupportedSnippet } from "./display";

describe("isUnsupportedSnippet", () => {
  it("reconoce los sentinelas que guardan los adaptadores", () => {
    expect(isUnsupportedSnippet("[unsupported]")).toBe(true);
    expect(isUnsupportedSnippet("[unsupported message type: poll]")).toBe(true);
    // El nuevo: Meta avisó que no entrega el contenido (nota de voz de IG).
    expect(isUnsupportedSnippet("[unsupported media]")).toBe(true);
  });

  it("no toca el texto real del cliente", () => {
    expect(isUnsupportedSnippet("¿tienen stock?")).toBe(false);
    expect(isUnsupportedSnippet("")).toBe(false);
  });
});

describe("isUnsupportedMediaSnippet", () => {
  it("sólo matchea el caso concreto de contenido retenido por la plataforma", () => {
    expect(isUnsupportedMediaSnippet("[unsupported media]")).toBe(true);
    expect(isUnsupportedMediaSnippet("[unsupported]")).toBe(false);
    expect(isUnsupportedMediaSnippet(null)).toBe(false);
  });
});
