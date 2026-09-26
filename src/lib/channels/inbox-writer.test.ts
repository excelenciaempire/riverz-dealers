import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ChannelConnection } from "@/types";
import type { InboundEvent } from "./types";
import { ingestInboundEvent, missingMediaPatch } from "./inbox-writer";

const image = { url: "https://storage/x.jpg", mime_type: "image/jpeg" };

describe("missingMediaPatch", () => {
  const placeholder = { content_text: "[unsupported message type: media_placeholder]", media_url: null };

  it("completa el mensaje que quedó como marcador cuando llega su archivo", () => {
    expect(missingMediaPatch("whatsapp", placeholder, { attachments: [image], text: "[Imagen]" })).toEqual({
      content_type: "image",
      media_url: image.url,
      media_type: "image",
      media_mime: "image/jpeg",
      media_size: null,
      attachments: [image],
      content_text: "[Imagen]",
    });
  });

  it("reemplaza los rótulos de tipo y el texto vacío, pero conserva el de la persona", () => {
    for (const stored of ["[Imagen]", "[Audio]", "[Documento]", "[adjunto]", ""]) {
      const patch = missingMediaPatch("instagram", { content_text: stored, media_url: null }, {
        attachments: [image],
        text: "foto",
      });
      expect(patch?.content_text).toBe("foto");
    }
    const kept = missingMediaPatch("messenger", { content_text: "Hola", media_url: null }, {
      attachments: [image],
      text: "",
    });
    expect(kept).toMatchObject({ media_url: image.url, attachments: [image] });
    expect(kept).not.toHaveProperty("content_text");
  });

  it("toma las columnas del primer adjunto que sí trae archivo", () => {
    const sinArchivo = { url: "", mime_type: "application/pdf" };
    const patch = missingMediaPatch("gmail", { content_text: "Adjunto", media_url: null }, {
      attachments: [sinArchivo, image],
      text: "Adjunto",
    });
    // El correo sigue siendo correo; el archivo es el que tiene URL.
    expect(patch).toMatchObject({ content_type: "email", media_url: image.url, attachments: [sinArchivo, image] });
  });

  it("no toca un mensaje que ya tiene archivo ni uno repetido sin archivo", () => {
    expect(
      missingMediaPatch("whatsapp", { ...placeholder, media_url: "https://storage/y.jpg" }, { attachments: [image], text: "" }),
    ).toBeNull();
    expect(missingMediaPatch("whatsapp", placeholder, { attachments: [], text: "" })).toBeNull();
    expect(missingMediaPatch("whatsapp", placeholder, { text: "" })).toBeNull();
  });
});

interface Call {
  table: string;
  ops: Array<[string, unknown[]]>;
  update?: unknown;
}

/** Supabase de mentira: registra cada consulta y deja que el test la conteste. */
function fakeDb(answer: (call: Call) => { data?: unknown; error?: unknown }) {
  const calls: Call[] = [];
  const db = {
    from(table: string) {
      const call: Call = { table, ops: [] };
      calls.push(call);
      const builder: Record<string, unknown> = new Proxy(
        {},
        {
          get(_target, prop: string) {
            if (prop === "then") {
              return (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
                Promise.resolve(answer(call)).then(resolve, reject);
            }
            if (prop === "update") {
              return (patch: unknown) => {
                call.update = patch;
                return builder;
              };
            }
            return (...args: unknown[]) => {
              call.ops.push([prop, args]);
              return builder;
            };
          },
        },
      );
      return builder;
    },
  };
  return { db: db as unknown as SupabaseClient, calls };
}

const has = (call: Call, op: string, ...args: unknown[]) =>
  call.ops.some(([name, a]) => name === op && args.every((v, i) => a[i] === v));

describe("ingestInboundEvent con un mensaje repetido", () => {
  const connection = {
    id: "conn-ig",
    workspace_id: "ws-1",
    channel: "instagram",
    status: "connected",
    external_account_id: "ig-negocio",
    config: {},
  } as unknown as ChannelConnection;

  const event = {
    channel: "instagram",
    connection,
    externalContactId: "cliente",
    externalMessageId: "mid-1",
    text: "",
    attachments: [image],
    receivedAt: new Date().toISOString(),
  } as InboundEvent;

  function db(stored: Record<string, unknown>) {
    return fakeDb((call) => {
      if (call.table === "channel_connections") return { data: { status: "connected" }, error: null };
      if (call.table === "messages" && !call.update) return { data: stored, error: null };
      return { data: null, error: null };
    });
  }

  it("completa el archivo que le faltaba a la fila, sin insertar otra", async () => {
    const { db: fake, calls } = db({ id: "row-1", content_text: "Hola", media_url: null });

    expect(await ingestInboundEvent(fake, event)).toBeNull();

    const lookup = calls.find((c) => c.table === "messages" && !c.update);
    expect(lookup && has(lookup, "eq", "conversations.workspace_id", "ws-1")).toBe(true);
    const write = calls.find((c) => c.update);
    expect(write?.update).toMatchObject({ media_url: image.url, attachments: [image] });
    expect(write?.update).not.toHaveProperty("content_text");
    expect(write && has(write, "eq", "id", "row-1")).toBe(true);
    expect(calls.some((c) => c.table === "conversations")).toBe(false);
  });

  it("si la fila ya tiene su archivo no escribe nada", async () => {
    const { db: fake, calls } = db({ id: "row-1", content_text: "", media_url: "https://storage/y.jpg" });
    expect(await ingestInboundEvent(fake, event)).toBeNull();
    expect(calls.some((c) => c.update)).toBe(false);
  });
});
