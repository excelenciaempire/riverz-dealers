import { describe, expect, it } from "vitest";
import { mimeToCategory, resolveMime, sniffMime } from "./media-ingest";

/** Arma un buffer con una firma en texto plano en el offset pedido. */
function bytes(sig: string, at = 0, size = 64): Buffer {
  const b = Buffer.alloc(size);
  b.write(sig, at, "latin1");
  return b;
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
