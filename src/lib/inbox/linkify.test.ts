import { describe, expect, it } from "vitest";
import { findLinks } from "./linkify";

/** Atajo: [texto mostrado, destino] de cada enlace detectado. */
function links(text: string): Array<[string, string]> {
  return findLinks(text).map((l) => [l.text, l.href]);
}

describe("findLinks", () => {
  it("detecta una URL con esquema", () => {
    expect(links("Mirá https://pilar.store/serum ahí está")).toEqual([
      ["https://pilar.store/serum", "https://pilar.store/serum"],
    ]);
  });

  it("detecta un enlace escrito sin https ni www", () => {
    expect(links("comprá en pilarargentina.store/razones")).toEqual([
      ["pilarargentina.store/razones", "https://pilarargentina.store/razones"],
    ]);
  });

  it("detecta www sin esquema", () => {
    expect(links("www.pilar.store")).toEqual([["www.pilar.store", "https://www.pilar.store"]]);
  });

  it("deja el punto final de la oración fuera del enlace", () => {
    const text = "Está en pilar.store.";
    const [link] = findLinks(text);
    expect(link.text).toBe("pilar.store");
    expect(text.slice(link.end)).toBe("."); // el punto queda como texto

    const [conRuta] = findLinks("Mirá https://pilar.store/serum.");
    expect(conRuta.text).toBe("https://pilar.store/serum");
    expect(conRuta.trailing).toBe(".");
  });

  it("convierte un correo en mailto sin partirlo en dominio", () => {
    expect(links("escribime a juan@pilar.com")).toEqual([
      ["juan@pilar.com", "mailto:juan@pilar.com"],
    ]);
  });

  it("encuentra varios enlaces en el mismo mensaje", () => {
    expect(links("pilar.store y https://otra.com/x")).toEqual([
      ["pilar.store", "https://pilar.store"],
      ["https://otra.com/x", "https://otra.com/x"],
    ]);
  });

  it("no toma por enlace un precio ni una frase con punto", () => {
    expect(links("Sale 3.99 hoy")).toEqual([]);
    expect(links("Gracias.Hasta luego")).toEqual([]);
    expect(links("listo.ya te paso todo")).toEqual([]);
  });

  it("no re-detecta el dominio dentro de una URL ya detectada", () => {
    expect(links("https://pilar.store/a/b?x=pilar.com")).toEqual([
      ["https://pilar.store/a/b?x=pilar.com", "https://pilar.store/a/b?x=pilar.com"],
    ]);
  });

  it("respeta las posiciones para poder reconstruir el texto", () => {
    const text = "andá a pilar.store ahora";
    const [link] = findLinks(text);
    expect(text.slice(link.start, link.end)).toBe("pilar.store");
    expect(text.slice(0, link.start)).toBe("andá a ");
    expect(text.slice(link.end)).toBe(" ahora");
  });

  it("no rompe con texto vacío ni sin enlaces", () => {
    expect(findLinks("")).toEqual([]);
    expect(findLinks("hola, ¿cuánto sale?")).toEqual([]);
  });
});
