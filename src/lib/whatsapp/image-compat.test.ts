import { describe, it, expect } from "vitest";
import sharp from "sharp";
import {
  isSendableImageMime,
  toSendableImage,
  toJpegFileName,
  renameForMime,
} from "./image-compat";

/** Imagen mínima en el formato pedido, generada al vuelo. */
async function makeImage(format: "webp" | "png" | "jpeg" | "gif"): Promise<Buffer> {
  const base = sharp({
    create: { width: 64, height: 64, channels: 3, background: "#84cc16" },
  });
  if (format === "webp") return base.webp().toBuffer();
  if (format === "png") return base.png().toBuffer();
  if (format === "gif") return base.gif().toBuffer();
  return base.jpeg().toBuffer();
}

describe("isSendableImageMime", () => {
  it("solo acepta los dos formatos que entrega WhatsApp", () => {
    expect(isSendableImageMime("image/jpeg")).toBe(true);
    expect(isSendableImageMime("image/png")).toBe(true);
    expect(isSendableImageMime("image/webp")).toBe(false);
    expect(isSendableImageMime("image/heic")).toBe(false);
    expect(isSendableImageMime(null)).toBe(false);
  });
});

describe("toSendableImage", () => {
  it("convierte WebP a JPEG (el caso del 131053)", async () => {
    const webp = await makeImage("webp");
    const out = await toSendableImage(webp, "image/webp");
    expect(out.converted).toBe(true);
    expect(out.mime).toBe("image/jpeg");
    expect((await sharp(out.buffer).metadata()).format).toBe("jpeg");
  });

  it("convierte GIF (WhatsApp no lo acepta como imagen)", async () => {
    // Sale PNG porque el GIF trae canal alfa: en JPEG el fondo saldría negro.
    const gif = await makeImage("gif");
    const out = await toSendableImage(gif, "image/gif");
    expect(out.converted).toBe(true);
    expect(out.mime).toBe("image/png");
    expect(isSendableImageMime(out.mime)).toBe(true);
  });

  it("deja pasar JPEG y PNG sin recomprimir", async () => {
    for (const [format, mime] of [
      ["jpeg", "image/jpeg"],
      ["png", "image/png"],
    ] as const) {
      const buf = await makeImage(format);
      const out = await toSendableImage(buf, mime);
      expect(out.converted).toBe(false);
      expect(out.buffer).toBe(buf);
      expect(out.mime).toBe(mime);
    }
  });

  it("decide por los bytes, no por el mime declarado", async () => {
    // Un WebP renombrado a .jpg fallaba igual en Meta: manda el contenido real.
    const webp = await makeImage("webp");
    const out = await toSendableImage(webp, "image/jpeg");
    expect(out.converted).toBe(true);
    expect(out.mime).toBe("image/jpeg");
    expect((await sharp(out.buffer).metadata()).format).toBe("jpeg");
  });

  it("no toca lo que no es una imagen", async () => {
    const pdf = Buffer.from("%PDF-1.7\n%fake");
    const out = await toSendableImage(pdf, "application/pdf");
    expect(out.converted).toBe(false);
    expect(out.buffer).toBe(pdf);
  });
});

describe("toJpegFileName", () => {
  it("reemplaza la extensión y respeta los puntos del nombre", () => {
    expect(toJpegFileName("foto.webp")).toBe("foto.jpg");
    expect(toJpegFileName("promo.v2.heic")).toBe("promo.v2.jpg");
    expect(toJpegFileName("sinextension")).toBe("sinextension.jpg");
    expect(toJpegFileName(undefined)).toBeUndefined();
  });
});

describe("toSendableImage — propiedades que Meta también mira", () => {
  it("convierte el PNG de 16 bits de una captura de iPhone", async () => {
    // El caso real del 131053 "Image is invalid…": PNG válido, pero
    // rgb16 / ushort. Meta solo acepta 8 bit por canal.
    const png16 = await sharp({
      create: { width: 64, height: 64, channels: 3, background: "#84cc16" },
    })
      .toColourspace("rgb16")
      .png()
      .toBuffer();
    expect((await sharp(png16).metadata()).depth).toBe("ushort");

    const out = await toSendableImage(png16, "image/png");
    expect(out.converted).toBe(true);
    const meta = await sharp(out.buffer).metadata();
    expect(meta.depth).toBe("uchar");
    expect(meta.space).toBe("srgb");
  });

  it("conserva la transparencia: un PNG raro sale PNG, no JPEG", async () => {
    const png16Alpha = await sharp({
      create: {
        width: 64,
        height: 64,
        channels: 4,
        background: { r: 132, g: 204, b: 22, alpha: 0.5 },
      },
    })
      .toColourspace("rgb16")
      .png()
      .toBuffer();
    const out = await toSendableImage(png16Alpha, "image/png");
    expect(out.converted).toBe(true);
    expect(out.mime).toBe("image/png");
    const meta = await sharp(out.buffer).metadata();
    expect(meta.depth).toBe("uchar");
    expect(meta.hasAlpha).toBe(true);
  });

  it("recomprime lo que pasa de 5 MB", async () => {
    // Ruido: no comprime, así que un PNG grande de verdad supera el tope.
    const px = 3000;
    const noise = Buffer.alloc(px * px * 3);
    for (let i = 0; i < noise.length; i++) noise[i] = (i * 2654435761) % 256;
    const gordo = await sharp(noise, { raw: { width: px, height: px, channels: 3 } })
      .png({ compressionLevel: 0 })
      .toBuffer();
    expect(gordo.length).toBeGreaterThan(5 * 1024 * 1024);

    const out = await toSendableImage(gordo, "image/png");
    expect(out.converted).toBe(true);
    expect(out.buffer.length).toBeLessThanOrEqual(5 * 1024 * 1024);
  }, 30000);
});

describe("renameForMime", () => {
  it("alinea la extensión con el formato real", () => {
    expect(renameForMime("captura.png", "image/jpeg")).toBe("captura.jpg");
    expect(renameForMime("logo.webp", "image/png")).toBe("logo.png");
    expect(renameForMime(undefined, "image/png")).toBeUndefined();
  });
});
