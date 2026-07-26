import { beforeEach, describe, expect, it, vi } from "vitest";

// La descarga a Storage se simula: acá nos importa QUÉ se baja y qué texto
// queda cuando el adjunto no es un archivo bajable.
const downloads: string[] = [];
vi.mock("./media-ingest", () => ({
  ingestMetaAttachment: vi.fn(async (opts: { attachmentUrl: string }) => {
    downloads.push(opts.attachmentUrl);
    if (opts.attachmentUrl.includes("fails")) return null;
    return {
      publicUrl: `https://storage.test/${downloads.length}.bin`,
      mediaType: "image",
      mediaMime: opts.attachmentUrl.includes("html") ? "text/html" : "image/jpeg",
      mediaSize: 10,
    };
  }),
}));

import {
  composeMetaText,
  ingestMetaAttachments,
  META_UNSUPPORTED_LABEL,
  unwrapMetaLink,
} from "./meta-attachments";

const BASE = { workspaceId: "ws", externalContactId: "psid-1", externalMessageId: "mid-1" };

beforeEach(() => {
  downloads.length = 0;
});

describe("unwrapMetaLink", () => {
  it("devuelve el enlace real detrás del redirector de Facebook", () => {
    expect(
      unwrapMetaLink("https://l.facebook.com/l.php?u=https%3A%2F%2Fpilar.store%2Fserum&h=AT1"),
    ).toBe("https://pilar.store/serum");
  });

  it("deja intacto un enlace normal", () => {
    expect(unwrapMetaLink("https://pilar.store/serum")).toBe("https://pilar.store/serum");
  });
});

describe("ingestMetaAttachments", () => {
  it("baja imágenes y no agrega texto", async () => {
    const r = await ingestMetaAttachments({
      ...BASE,
      attachments: [{ type: "image", payload: { url: "https://cdn.test/foto.jpg" } }],
    });
    expect(r.media).toHaveLength(1);
    expect(r.descriptions).toEqual([]);
  });

  it("describe un enlace compartido (fallback) en vez de descartarlo", async () => {
    const r = await ingestMetaAttachments({
      ...BASE,
      attachments: [
        {
          type: "fallback",
          title: "PRELANDING SUIZA",
          payload: { url: "https://l.facebook.com/l.php?u=https%3A%2F%2Fpilar.store%2Fp" },
        },
      ],
    });
    expect(r.media).toEqual([]);
    expect(r.descriptions).toEqual(["PRELANDING SUIZA\nhttps://pilar.store/p"]);
    expect(downloads).toEqual([]); // nunca salimos a buscar sitios de terceros
  });

  it("baja la imagen de una tarjeta de producto y guarda su título y enlace", async () => {
    const r = await ingestMetaAttachments({
      ...BASE,
      attachments: [
        {
          type: "template",
          payload: {
            elements: [
              {
                title: "razones-serum-pilar oficial",
                image_url: "https://cdn.test/card.jpg",
                default_action: { url: "https://pilar.store/razones" },
              },
            ],
          },
        },
      ],
    });
    expect(downloads).toEqual(["https://cdn.test/card.jpg"]);
    expect(r.media).toHaveLength(1);
    expect(r.descriptions).toEqual([
      "razones-serum-pilar oficial\nhttps://pilar.store/razones",
    ]);
  });

  it("baja la mención en historia y la rotula", async () => {
    const r = await ingestMetaAttachments({
      ...BASE,
      attachments: [
        { type: "story_mention", payload: { url: "https://cdn.test/story.jpg" } },
      ],
    });
    expect(r.media).toHaveLength(1);
    expect(r.descriptions).toEqual(["[Mención en historia]"]);
  });

  it("deja rótulo cuando la descarga falla, para que el mensaje no quede vacío", async () => {
    const r = await ingestMetaAttachments({
      ...BASE,
      attachments: [{ type: "image", payload: { url: "https://cdn.test/fails.jpg" } }],
    });
    expect(r.media).toEqual([]);
    expect(r.descriptions).toEqual(["https://cdn.test/fails.jpg"]);
  });

  it("descarta lo bajado del CDN que no resulta ser media", async () => {
    const r = await ingestMetaAttachments({
      ...BASE,
      attachments: [
        { type: "share", title: "Reel", payload: { url: "https://lookaside.fbsbx.com/html" } },
      ],
    });
    expect(r.media).toEqual([]);
    expect(r.descriptions).toEqual(["Reel\nhttps://lookaside.fbsbx.com/html"]);
  });
});

describe("composeMetaText", () => {
  it("une el texto con la descripción sin repetir", () => {
    expect(composeMetaText("¿Precio?", ["¿Precio?", "https://pilar.store"], false)).toBe(
      "¿Precio?\nhttps://pilar.store",
    );
  });

  it("no inventa texto cuando hay archivo", () => {
    expect(composeMetaText("", [], true)).toBe("");
  });

  it("marca como no compatible lo que no dejó ni texto ni archivo", () => {
    expect(composeMetaText("", [], false)).toBe(META_UNSUPPORTED_LABEL);
  });
});
