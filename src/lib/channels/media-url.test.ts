import { describe, expect, it, vi } from "vitest";

vi.mock("./admin-client", () => ({
  supabaseAdmin: () => ({
    storage: {
      from: () => ({
        createSignedUrl: async (path: string) => ({
          data: { signedUrl: `https://ref.supabase.co/signed/${path}?token=abc` },
          error: null,
        }),
      }),
    },
  }),
}));

import {
  appMediaUrl,
  isManagedMediaUrl,
  resolveMediaFetchUrl,
  storagePathFromSegments,
  storagePathFromUrl,
} from "./media-url";

const PATH = "11111111-1111-1111-1111-111111111111/22222222-2222-2222-2222-222222222222/foto.jpg";

describe("storagePathFromUrl", () => {
  it("reconoce la forma de la app, relativa", () => {
    expect(storagePathFromUrl(`/api/media/${PATH}`)).toBe(PATH);
  });

  it("reconoce la forma de la app, absoluta", () => {
    expect(storagePathFromUrl(`https://riverz.co/api/media/${PATH}`)).toBe(PATH);
  });

  it("reconoce la URL pública vieja de Supabase", () => {
    const legacy = `https://ref.supabase.co/storage/v1/object/public/message-media/${PATH}`;
    expect(storagePathFromUrl(legacy)).toBe(PATH);
  });

  it("descarta la query al quedarse con la ruta", () => {
    expect(storagePathFromUrl(`/api/media/${PATH}?v=2`)).toBe(PATH);
  });

  it("deja pasar lo que es de otro dominio", () => {
    expect(storagePathFromUrl("https://cdn.shopify.com/s/files/1/producto.jpg")).toBeNull();
    expect(isManagedMediaUrl("https://cdn.shopify.com/s/files/1/producto.jpg")).toBe(false);
  });

  it("no confunde el vacío con una ruta", () => {
    expect(storagePathFromUrl("")).toBeNull();
    expect(storagePathFromUrl(null)).toBeNull();
    expect(storagePathFromUrl("/api/media/")).toBeNull();
  });
});

describe("appMediaUrl", () => {
  it("arma la forma que se guarda en la base", () => {
    expect(appMediaUrl(PATH)).toBe(`/api/media/${PATH}`);
  });

  it("ida y vuelta", () => {
    expect(storagePathFromUrl(appMediaUrl(PATH))).toBe(PATH);
  });
});

describe("resolveMediaFetchUrl", () => {
  it("firma un adjunto propio", async () => {
    const out = await resolveMediaFetchUrl(`/api/media/${PATH}`);
    expect(out).toBe(`https://ref.supabase.co/signed/${PATH}?token=abc`);
  });

  it("firma también las filas viejas que quedaron con la URL pública", async () => {
    const legacy = `https://ref.supabase.co/storage/v1/object/public/message-media/${PATH}`;
    const out = await resolveMediaFetchUrl(legacy);
    expect(out).toBe(`https://ref.supabase.co/signed/${PATH}?token=abc`);
  });

  it("no toca una URL ajena", async () => {
    const external = "https://cdn.shopify.com/s/files/1/producto.jpg";
    expect(await resolveMediaFetchUrl(external)).toBe(external);
  });
});

describe("storagePathFromSegments", () => {
  const WS = "11111111-1111-1111-1111-111111111111";
  const CONV = "22222222-2222-2222-2222-222222222222";

  it("arma la ruta de un adjunto normal", () => {
    expect(storagePathFromSegments([WS, CONV, "foto.jpg"])).toBe(`${WS}/${CONV}/foto.jpg`);
  });

  it("no deja subir de directorio", () => {
    // Next entrega los segmentos YA decodificados y las dos rutas de lectura
    // los decodificaban otra vez: `%252e%252e` llegaba como `%2e%2e`, el
    // segundo decode lo volvía `..` y el parser de URL lo colapsaba dentro del
    // enlace firmado. Con eso, los dos primeros segmentos —justo los que se
    // comparan contra la sesión— dejaban de decidir nada: bastaba poner los
    // propios y trepar hasta el adjunto de otra cuenta.
    expect(storagePathFromSegments([WS, CONV, "..", "..", "otro", "x.jpg"])).toBeNull();
    expect(storagePathFromSegments([WS, "%2e%2e", "x.jpg"])).toBeNull();
    expect(storagePathFromSegments([WS, "..%2f..", "x.jpg"])).toBeNull();
  });

  it("rechaza separadores y segmentos vacíos", () => {
    expect(storagePathFromSegments([WS, "a/b", "x.jpg"])).toBeNull();
    expect(storagePathFromSegments([WS, String.raw`a\b`, "x.jpg"])).toBeNull();
    expect(storagePathFromSegments([WS, "", "x.jpg"])).toBeNull();
    expect(storagePathFromSegments([])).toBeNull();
  });
});
