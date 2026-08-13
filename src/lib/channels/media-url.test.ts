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
