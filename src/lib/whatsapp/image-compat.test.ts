import { describe, it, expect } from "vitest";
import sharp from "sharp";
import { isSendableImageMime, toSendableImage, toJpegFileName } from "./image-compat";

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

  it("convierte GIF a JPEG (WhatsApp no lo acepta como imagen)", async () => {
    const gif = await makeImage("gif");
    const out = await toSendableImage(gif, "image/gif");
    expect(out.converted).toBe(true);
    expect(out.mime).toBe("image/jpeg");
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
