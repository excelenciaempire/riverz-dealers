import { describe, expect, it } from "vitest";
import { esArchivoReal, mimeToCategory, resolveMime, sniffMime } from "./media-ingest";

/** Arma un buffer con una firma en texto plano en el offset pedido. */
function bytes(sig: string, at = 0, size = 64): Buffer {
  const b = Buffer.alloc(size);
  b.write(sig, at, "latin1");
  return b;
}

/** mp4 mínimo con los `hdlr` de las pistas que se pidan — así se ve el
 *  contenedor real de una nota de voz (solo 'soun') vs un video. */
function isoMp4(tracks: { soun?: boolean; vide?: boolean }): Buffer {
  const parts = [Buffer.alloc(4), Buffer.from("ftypisom", "latin1")];
  for (const kind of ["soun", "vide"] as const) {
    if (!tracks[kind]) continue;
    const box = Buffer.alloc(24);
    box.write("hdlr", 4, "latin1");
    box.write(kind, 16, "latin1");
    parts.push(box);
  }
  return Buffer.concat(parts);
}

describe("sniffMime", () => {
  it("reconoce la nota de voz de WhatsApp (ogg/opus)", () => {
    expect(sniffMime(bytes("OggS"))).toBe("audio/ogg");
  });

  it("distingue audio de video en un contenedor mp4 según el adjunto anunciado", () => {
    const mp4 = bytes("ftyp", 4);
    mp4.write("isom", 8, "latin1");
    expect(sniffMime(mp4, "voice")).toBe("audio/mp4");
    expect(sniffMime(mp4, "video")).toBe("video/mp4");
  });

  it("reconoce la nota de voz de Instagram: mp4 con pista de audio y ninguna de video", () => {
    // Es lo que entrega el CDN de Meta — brand `isom`, un solo track 'soun'.
    expect(sniffMime(isoMp4({ soun: true }))).toBe("audio/mp4");
    expect(sniffMime(isoMp4({ soun: true, vide: true }))).toBe("video/mp4");
  });

  it("reconoce m4a por el brand aunque no haya hint", () => {
    const m4a = bytes("ftyp", 4);
    m4a.write("M4A ", 8, "latin1");
    expect(sniffMime(m4a)).toBe("audio/mp4");
  });

  it("reconoce mp3, wav, amr e imágenes", () => {
    expect(sniffMime(bytes("ID3"))).toBe("audio/mpeg");
    const wav = bytes("RIFF");
    wav.write("WAVE", 8, "latin1");
    expect(sniffMime(wav)).toBe("audio/wav");
    expect(sniffMime(bytes("#!AMR"))).toBe("audio/amr");
    const jpg = Buffer.alloc(32);
    jpg[0] = 0xff;
    jpg[1] = 0xd8;
    jpg[2] = 0xff;
    expect(sniffMime(jpg)).toBe("image/jpeg");
  });

  it("devuelve null cuando no reconoce la firma", () => {
    expect(sniffMime(bytes("zzzz"))).toBeNull();
  });
});

describe("resolveMime", () => {
  it("respeta el mime declarado cuando dice algo", () => {
    expect(resolveMime("audio/ogg", bytes("OggS"), "voice")).toBe("audio/ogg");
  });

  it("corrige el video/mp4 que el CDN pone en las notas de voz de Instagram", () => {
    // El header decía video/mp4 y la nota de voz se veía como una burbuja de
    // video negra y muda. El contenedor manda.
    const nota = isoMp4({ soun: true });
    expect(resolveMime("video/mp4", nota, "audio")).toBe("audio/mp4");
    expect(mimeToCategory(resolveMime("video/mp4", nota, "audio"))).toBe("audio");
    // Un video de verdad sigue siendo video, aunque el adjunto venga sin hint.
    expect(resolveMime("video/mp4", isoMp4({ soun: true, vide: true }))).toBe("video/mp4");
  });

  it("mira los bytes cuando el CDN declara octet-stream", () => {
    // Este es el caso que dejaba la nota de voz como "documento" y la bandeja
    // la mostraba como enlace de descarga en vez de reproductor.
    expect(resolveMime("application/octet-stream", bytes("OggS"), "voice")).toBe(
      "audio/ogg",
    );
    expect(mimeToCategory(resolveMime("application/octet-stream", bytes("OggS"), "voice"))).toBe(
      "voice",
    );
  });

  it("cae al tipo que anunció el canal cuando los bytes no dicen nada", () => {
    expect(resolveMime("", bytes("zzzz"), "audio")).toBe("audio/mp4");
    expect(resolveMime(null, bytes("zzzz"), "image")).toBe("image/jpeg");
  });

  it("deja el documento como está cuando no hay pista alguna", () => {
    expect(resolveMime("application/octet-stream", bytes("zzzz"))).toBe(
      "application/octet-stream",
    );
  });
});

describe("mimeToCategory", () => {
  it("trata como nota de voz el ogg/opus con parámetros de codec", () => {
    expect(mimeToCategory("audio/ogg; codecs=opus")).toBe("voice");
    expect(mimeToCategory("audio/mp4")).toBe("audio");
  });
});

describe("esArchivoReal", () => {
  // El 2026-09-15 el CDN de Instagram devolvió 200 con una página de Facebook
  // para cada foto de los clientes de un comercio; se guardó como "Archivo" y
  // la IA dijo que el comprobante "no llegó". Una página no es un adjunto.
  it("descarta una página HTML aunque venga con 200", () => {
    const html = Buffer.from('<!DOCTYPE html>\n<html lang="en" id="facebook">', "utf8");
    expect(esArchivoReal({ buffer: html, mime: 'text/html; charset="utf-8"' })).toBeNull();
  });

  it("descarta el HTML también cuando el Content-Type miente", () => {
    const html = Buffer.from("  <html><head></head><body></body></html>", "utf8");
    expect(esArchivoReal({ buffer: html, mime: "application/octet-stream" })).toBeNull();
  });

  it("deja pasar una imagen real", () => {
    const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(32)]);
    const fetched = { buffer: jpeg, mime: "image/jpeg" };
    expect(esArchivoReal(fetched)).toBe(fetched);
  });

  it("propaga el null de una descarga fallida", () => {
    expect(esArchivoReal(null)).toBeNull();
  });
});
