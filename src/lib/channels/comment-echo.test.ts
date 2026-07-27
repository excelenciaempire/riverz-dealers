import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ChannelConnection } from "@/types";
import { buildSelfCommentEvent } from "./comment-echo";

/** Supabase de mentira: cada tabla devuelve una fila fija, encadene lo que encadene. */
function fakeDb(tables: Record<string, unknown>): SupabaseClient {
  const db = {
    from(table: string) {
      const data = tables[table] ?? null;
      const chain: Record<string | symbol, unknown> = new Proxy(
        {},
        {
          get(_t, prop) {
            if (prop === "then") {
              return (resolve: (v: unknown) => unknown) => Promise.resolve({ data }).then(resolve);
            }
            if (prop === "maybeSingle") {
              return () =>
                Promise.resolve({ data: Array.isArray(data) ? (data[0] ?? null) : data });
            }
            return () => chain;
          },
        },
      );
      return chain;
    },
  };
  return db as unknown as SupabaseClient;
}

const connection = {
  id: "conn-1",
  workspace_id: "ws-1",
  channel: "ig_comment",
} as unknown as ChannelConnection;

const base = {
  channel: "ig_comment" as const,
  connection,
  commentId: "reply-1",
  parentCommentId: "parent-1",
  postId: "post-1",
  text: "Sí, hay stock",
  receivedAt: "2026-07-27T12:00:00.000Z",
};

describe("buildSelfCommentEvent", () => {
  it("lleva la respuesta del comercio al hilo del comentario padre, como saliente", async () => {
    const db = fakeDb({
      messages: [{ conversation_id: "conv-1" }],
      conversations: [{ id: "conv-1", workspace_id: "ws-1", contact_id: "contact-1" }],
      contacts: { external_id: "ig-user-9" },
    });

    const event = await buildSelfCommentEvent(db, base);

    expect(event).toMatchObject({
      channel: "ig_comment",
      externalContactId: "ig-user-9",
      externalMessageId: "reply-1",
      outbound: true,
      comment: { postId: "post-1", parentCommentId: "parent-1" },
    });
  });

  it("ignora un comentario suelto del negocio (sin padre no hay hilo)", async () => {
    const db = fakeDb({
      messages: [{ conversation_id: "conv-1" }],
      conversations: [{ id: "conv-1", workspace_id: "ws-1", contact_id: "contact-1" }],
      contacts: { external_id: "ig-user-9" },
    });

    expect(await buildSelfCommentEvent(db, { ...base, parentCommentId: null })).toBeNull();
  });

  it("ignora la respuesta cuando el comentario padre no está en la bandeja", async () => {
    const db = fakeDb({ messages: [], conversations: [], contacts: null });

    expect(await buildSelfCommentEvent(db, base)).toBeNull();
  });

  it("no cruza workspaces: el padre de otro comercio no resuelve hilo", async () => {
    const db = fakeDb({
      messages: [{ conversation_id: "conv-otro" }],
      // El filtro por workspace_id corre en la query; aquí el resultado ya viene vacío.
      conversations: [],
      contacts: { external_id: "ig-user-9" },
    });

    expect(await buildSelfCommentEvent(db, base)).toBeNull();
  });
});
