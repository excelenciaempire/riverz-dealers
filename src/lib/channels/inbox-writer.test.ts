import { describe, expect, it } from "vitest";
import { fillsMediaPlaceholder } from "./inbox-writer";

describe("fillsMediaPlaceholder", () => {
  const placeholder = { content_text: "[unsupported message type: media_placeholder]", media_url: null };
  const withFile = { attachments: [{ url: "https://storage/x.jpg", mime_type: "image/jpeg" }] };

  it("completa el mensaje que quedó como marcador cuando llega su archivo", () => {
    expect(fillsMediaPlaceholder(placeholder, withFile)).toBe(true);
  });

  it("no toca un mensaje que ya tiene archivo o que no es un marcador", () => {
    expect(fillsMediaPlaceholder({ ...placeholder, media_url: "https://storage/y.jpg" }, withFile)).toBe(false);
    expect(fillsMediaPlaceholder({ content_text: "Hola", media_url: null }, withFile)).toBe(false);
  });

  it("sin archivo en la segunda entrega no hay nada que completar", () => {
    expect(fillsMediaPlaceholder(placeholder, { attachments: [] })).toBe(false);
    expect(fillsMediaPlaceholder(placeholder, {})).toBe(false);
  });
});
