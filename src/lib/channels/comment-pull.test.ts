import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ChannelConnection } from "@/types";

// El pull escribe a través de ingestInboundEvent; lo interceptamos para mirar
// con qué banderas entra cada comentario, que es lo único que decide si el
// agente habla o no.
const ingested: Array<Record<string, unknown>> = [];
vi.mock("./inbox-writer", () => ({
  ingestInboundEvent: vi.fn(async (_db: unknown, event: Record<string, unknown>) => {
    ingested.push(event);
    return { id: "msg-1" };
  }),
}));
vi.mock("./encryption", () => ({ decrypt: (v: string) => v }));
vi.mock("./comment-echo", () => ({ buildSelfCommentEvent: async () => null }));

import { pullCommentsForConnection } from "./comment-pull";

const IG_ID = "17841471409531708";
const POST = "post-1";

const connection = {
  id: "conn-1",
  workspace_id: "ws-1",
  channel: "ig_comment",
  config: { ig_user_id: IG_ID, page_id: "page-1" },
  secrets: { access_token: "token" },
} as unknown as ChannelConnection;

/** Supabase de mentira: el pull sólo lo usa para buscar publicaciones ya
 *  guardadas, y acá alcanza con que no devuelva ninguna. */
function fakeDb(): SupabaseClient {
  const chain: Record<string | symbol, unknown> = new Proxy(
    {},
    {
      get(_t, prop) {
        if (prop === "then") {
          return (resolve: (v: unknown) => unknown) =>
            Promise.resolve({ data: [] }).then(resolve);
        }
        if (prop === "maybeSingle") return () => Promise.resolve({ data: null });
        return () => chain;
      },
    },
  );
  return { from: () => chain } as unknown as SupabaseClient;
}

const iso = (msAgo: number) =>
  new Date(Date.now() - msAgo).toISOString().replace(/\.\d{3}Z$/, "+0000");

/** Responde las tres llamadas a Graph que hace el pull. */
function mockGraph(comments: unknown[]) {
  return vi.fn(async (url: string) => {
    const json = url.includes("/comments")
      ? { data: comments }
      : url.includes("/media")
        ? { data: [{ id: POST, timestamp: iso(0) }] }
        : { username: "pilaroficial_arg" };
    return { ok: true, json: async () => json } as unknown as Response;
  });
}

describe("pullCommentsForConnection", () => {
  beforeEach(() => {
    ingested.length = 0;
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("un comentario reciente sin responder entra en vivo (el agente lo atiende)", async () => {
    vi.stubGlobal(
      "fetch",
      mockGraph([
        {
          id: "c-1",
          text: "Cuanto sale?",
          timestamp: iso(5 * 60_000),
          from: { id: "cliente-1", username: "cliente" },
        },
      ]),
    );
    const r = await pullCommentsForConnection(fakeDb(), connection);
    expect(r.ingestedInbound).toBe(1);
    expect(ingested[0].externalMessageId).toBe("c-1");
    expect(ingested[0].suppressAutoReply).toBe(false);
    expect(ingested[0].contactName).toBe("@cliente");
  });

  // El caso que rompió en producción: seis días de comentarios rescatados de
  // golpe, respondidos en diferido a gente que ya había sido atendida a mano.
  it("un comentario viejo entra como rescate y nadie lo contesta solo", async () => {
    vi.stubGlobal(
      "fetch",
      mockGraph([
        {
          id: "c-viejo",
          text: "Cuanto sale?",
          timestamp: iso(6 * 24 * 60 * 60_000),
          from: { id: "cliente-2", username: "cliente2" },
        },
      ]),
    );
    await pullCommentsForConnection(fakeDb(), connection);
    expect(ingested[0].suppressAutoReply).toBe(true);
  });

  it("un comentario reciente YA respondido por el comercio tampoco se contesta", async () => {
    vi.stubGlobal(
      "fetch",
      mockGraph([
        {
          id: "c-2",
          text: "Cuanto sale?",
          timestamp: iso(5 * 60_000),
          from: { id: "cliente-3", username: "cliente3" },
          replies: {
            data: [
              {
                id: "r-1",
                text: "Te respondimos al privado",
                timestamp: iso(60_000),
                from: { id: IG_ID, username: "pilaroficial_arg" },
              },
            ],
          },
        },
      ]),
    );
    await pullCommentsForConnection(fakeDb(), connection);
    const customer = ingested.find((e) => e.externalMessageId === "c-2");
    expect(customer?.suppressAutoReply).toBe(true);
  });

  it("no ingiere como cliente un comentario de la propia cuenta", async () => {
    vi.stubGlobal(
      "fetch",
      mockGraph([
        {
          id: "c-propio",
          text: "Gracias por comentar",
          timestamp: iso(60_000),
          from: { id: IG_ID, username: "pilaroficial_arg" },
        },
      ]),
    );
    const r = await pullCommentsForConnection(fakeDb(), connection);
    expect(r.ingestedInbound).toBe(0);
    expect(ingested).toHaveLength(0);
  });
});
