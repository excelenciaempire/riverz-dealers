import { describe, expect, it } from "vitest";
import {
  isUnsupportedMediaSnippet,
  isUnsupportedSnippet,
  stripLeadingMentions,
} from "./display";

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

describe("stripLeadingMentions", () => {
  it("saca la mención con la que IG encabeza una respuesta", () => {
    expect(stripLeadingMentions("@soyjuanrios winning")).toBe("winning");
  });

  it("saca varias menciones seguidas", () => {
    expect(stripLeadingMentions("@ana @luis_2 gracias!")).toBe("gracias!");
  });

  it("respeta un @ en medio de la frase", () => {
    expect(stripLeadingMentions("escribinos a @riverz por DM")).toBe(
      "escribinos a @riverz por DM",
    );
  });

  it("deja intacto un comentario que era sólo la mención", () => {
    expect(stripLeadingMentions("@soyjuanrios")).toBe("@soyjuanrios");
  });

  it("no toca un texto sin menciones ni un vacío", () => {
    expect(stripLeadingMentions("hola")).toBe("hola");
    expect(stripLeadingMentions(null)).toBe("");
  });
})
