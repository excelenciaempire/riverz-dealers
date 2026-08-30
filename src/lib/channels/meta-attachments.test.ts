import { beforeEach, describe, expect, it, vi } from "vitest";

// La descarga a Storage se simula: acá nos importa QUÉ se baja y qué texto
// queda cuando el adjunto no es un archivo bajable.
const downloads: string[] = [];
const tokens: Array<string | undefined> = [];
vi.mock("./media-ingest", () => ({
  ingestMetaAttachment: vi.fn(async (opts: { attachmentUrl: string; accessToken?: string }) => {
    downloads.push(opts.attachmentUrl);
    tokens.push(opts.accessToken);
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
  META_UNSUPPORTED_MEDIA_LABEL,
  isStoryMentionOrShareOnly,
  unwrapMetaLink,
} from "./meta-attachments";

const BASE = { workspaceId: "ws", externalContactId: "psid-1", externalMessageId: "mid-1" };

beforeEach(() => {
  downloads.length = 0;
  tokens.length = 0;
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

  it("baja el audio de una nota de voz con el token de la conexión", async () => {
    const r = await ingestMetaAttachments({
      ...BASE,
      accessToken: "PAGE_TOKEN",
      attachments: [
        { type: "audio", payload: { url: "https://lookaside.fbsbx.com/ig_messaging_cdn/?a=1" } },
      ],
    });
    expect(r.media).toHaveLength(1);
    expect(r.descriptions).toEqual([]);
    expect(tokens).toEqual(["PAGE_TOKEN"]);
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

  it("distingue el contenido que Meta retuvo (nota de voz de IG)", () => {
    expect(composeMetaText("", [], false, true)).toBe(META_UNSUPPORTED_MEDIA_LABEL);
    // Con texto o archivo, la bandera no cambia nada.
    expect(composeMetaText("hola", [], false, true)).toBe("hola");
    expect(composeMetaText("", [], true, true)).toBe("");
  });
});

describe("ver-una-vez de Instagram (`ephemeral`)", () => {
  it("no deja descripción: deja la bandera, y el texto sale como retenido", async () => {
    const r = await ingestMetaAttachments({ ...BASE, attachments: [{ type: "ephemeral" }] });
    expect(r.media).toEqual([]);
    // Si dejara una descripción, `composeMetaText` la devolvería tal cual y
    // nunca miraría la bandera: por eso la rama corta antes de describir.
    expect(r.descriptions).toEqual([]);
    expect(r.unsupported).toBe(true);
    expect(composeMetaText("", r.descriptions, false, r.unsupported)).toBe(
      META_UNSUPPORTED_MEDIA_LABEL,
    );
  });

  it("un tipo desconocido sigue siendo el sentinela genérico", async () => {
    const r = await ingestMetaAttachments({ ...BASE, attachments: [{ type: "algo_nuevo" }] });
    expect(r.descriptions).toEqual([META_UNSUPPORTED_LABEL]);
    expect(r.unsupported).toBe(false);
  });
});

describe("isStoryMentionOrShareOnly", () => {
  it("es vitrina cuando el DM es sólo la mención o el post compartido", () => {
    expect(isStoryMentionOrShareOnly("[Mención en historia]")).toBe(true);
    expect(isStoryMentionOrShareOnly("[Publicación compartida]")).toBe(true);
    expect(isStoryMentionOrShareOnly("[Mención en historia]\n[Publicación compartida]")).toBe(
      true,
    );
  });

  it("NO es vitrina nada de lo que hay que contestar", () => {
    // Los cuatro que el gate viejo silenciaba en Instagram, y por los que una
    // clienta se quedó sin respuesta el 2026-08-30.
    expect(isStoryMentionOrShareOnly(META_UNSUPPORTED_LABEL)).toBe(false);
    expect(isStoryMentionOrShareOnly(META_UNSUPPORTED_MEDIA_LABEL)).toBe(false);
    expect(isStoryMentionOrShareOnly("[Ubicación]")).toBe(false);
    expect(isStoryMentionOrShareOnly("[Archivo no disponible]")).toBe(false);
    expect(isStoryMentionOrShareOnly("[Mención en historia]\n¿tienen stock?")).toBe(false);
    expect(isStoryMentionOrShareOnly("hola")).toBe(false);
    expect(isStoryMentionOrShareOnly("")).toBe(false);
    expect(isStoryMentionOrShareOnly(null)).toBe(false);
  });
});
