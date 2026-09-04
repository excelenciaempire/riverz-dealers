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
    const parent = comments.find((comment) => {
      const row = comment as { id?: string };
      return row.id && (url.includes(`/${row.id}/replies`) || url.includes(`/${row.id}/comments`));
    }) as { replies?: { data?: unknown[] }; comments?: { data?: unknown[] } } | undefined;
    const json = parent
      ? { data: parent.replies?.data ?? parent.comments?.data ?? [] }
      : url.includes("/comments")
      ? { data: comments }
      : url.includes("/media") || url.includes("/posts")
        ? { data: [{ id: POST, timestamp: iso(0), created_time: iso(0) }] }
        : { username: "pilaroficial_arg" };
    return { ok: true, json: async () => json } as unknown as Response;
  });
}

const PAGE = "662811686925997";
const fbConnection = {
  id: "conn-fb",
  workspace_id: "ws-1",
  channel: "fb_comment",
  config: { page_id: PAGE },
  secrets: { access_token: "token" },
} as unknown as ChannelConnection;

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

  // Facebook habla otro dialecto de Graph: `message` en vez de `text`,
  // `created_time` en vez de `timestamp`, `comments` en vez de `replies` y el
  // nombre real en vez del @usuario. Hasta el 2026-08-08 no tenía rescate: si
  // Meta perdía una entrega, ese comentario no volvía nunca.
  it("rescata un comentario de Facebook con su dialecto", async () => {
    vi.stubGlobal(
      "fetch",
      mockGraph([
        {
          id: "fb-1",
          message: "Perdon pero a mi no me hizo nada",
          created_time: iso(5 * 60_000),
          from: { id: "cliente-fb", name: "Claudia Vikario" },
        },
      ]),
    );
    const r = await pullCommentsForConnection(fakeDb(), fbConnection);
    expect(r.channel).toBe("fb_comment");
    expect(r.ingestedInbound).toBe(1);
    expect(ingested[0].channel).toBe("fb_comment");
    expect(ingested[0].text).toBe("Perdon pero a mi no me hizo nada");
    // Facebook da el nombre real: no se le pone arroba como al @usuario de IG.
    expect(ingested[0].contactName).toBe("Claudia Vikario");
    expect(ingested[0].suppressAutoReply).toBe(false);
  });

  it("en Facebook, un comentario ya contestado por la pagina no se contesta solo", async () => {
    vi.stubGlobal(
      "fetch",
      mockGraph([
        {
          id: "fb-2",
          message: "Cuanto sale?",
          created_time: iso(5 * 60_000),
          from: { id: "cliente-fb2", name: "Otra Persona" },
          comments: {
            data: [
              {
                id: "fb-r1",
                message: "Te escribimos al privado",
                created_time: iso(60_000),
                from: { id: PAGE, name: "Pilar Skin" },
              },
            ],
          },
        },
      ]),
    );
    await pullCommentsForConnection(fakeDb(), fbConnection);
    const customer = ingested.find((e) => e.externalMessageId === "fb-2");
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

  it("ignora como normal una publicación histórica que Meta ya eliminó", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.includes(`/${POST}/comments`)) {
          return new Response(
            JSON.stringify({
              error: { code: 100, error_subcode: 33, type: "GraphMethodException" },
            }),
            { status: 400, headers: { "content-type": "application/json" } },
          );
        }
        const json = url.includes("/media")
          ? { data: [{ id: POST, timestamp: iso(0) }] }
          : { username: "pilaroficial_arg" };
        return new Response(JSON.stringify(json), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }),
    );

    const result = await pullCommentsForConnection(fakeDb(), connection);
    expect(result.reason).toBe("ok");
    expect(result.errors).toEqual([]);
  });

  it("mantiene en error un rechazo real de Graph", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.includes(`/${POST}/comments`)) {
          return new Response(JSON.stringify({ error: { code: 190 } }), {
            status: 401,
            headers: { "content-type": "application/json" },
          });
        }
        const json = url.includes("/media")
          ? { data: [{ id: POST, timestamp: iso(0) }] }
          : { username: "pilaroficial_arg" };
        return new Response(JSON.stringify(json), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }),
    );

    const result = await pullCommentsForConnection(fakeDb(), connection);
    expect(result.reason).toBe("partial");
    expect(result.errors).toContain("comments_graph_failed");
  });
});
