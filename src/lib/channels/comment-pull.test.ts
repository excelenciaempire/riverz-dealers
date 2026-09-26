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
vi.mock('./poll-state', () => ({ savePollState: vi.fn() }));
vi.mock("./media-ingest", () => ({
  ingestMetaAttachment: vi.fn(async () => ({
    url: "/api/media/ws-1/cliente-fb/fb-foto.jpg",
    mediaType: "image",
    mediaMime: "image/jpeg",
    mediaSize: 10,
  })),
}));

import {
  commentAttachmentMedia,
  COMMENT_HISTORY_DONE,
  HISTORY_WINDOW_MS,
  historyPassPatch,
  pullCommentsForConnection,
  scheduledWindowMs,
  threadInWindow,
} from "./comment-pull";
import { savePollState } from './poll-state';
import { ingestMetaAttachment } from "./media-ingest";

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
    vi.mocked(savePollState).mockClear();
  });

  it('a scheduled recovery is passive even for a recent comment and retains a page cursor', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const data = url.includes(`/${POST}/comments`) ? {
        data: [{ id: 'recent', text: 'Precio', timestamp: iso(1000), from: { id: 'customer' } }],
        paging: { next: `https://graph.facebook.com/v22.0/${POST}/comments?after=page-two` },
      } : url.includes('/media') ? { data: [{ id: POST, timestamp: iso(0) }] }
        : url.includes('/replies') ? { data: [] } : { username: 'pilaroficial_arg' };
      return new Response(JSON.stringify(data));
    }));
    const result = await pullCommentsForConnection(fakeDb(), connection, {
      suppressAutoReply: true, resumable: true, maxCommentPages: 1,
    });
    expect(ingested[0]).toMatchObject({ historical: true, suppressAutoReply: true });
    expect(result.reason).toBe('partial');
    expect(savePollState).toHaveBeenCalledWith(expect.anything(), connection.id,
      expect.objectContaining({ comment_sync_posts: [POST], comment_sync_cursors: { [POST]: 'page-two' } }),
      null, { complete: false });
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

  // Antes el hilo entero se descartaba si el comentario raíz era más viejo que
  // la ventana, aunque la respuesta fuera de ayer.
  it("una respuesta reciente bajo un comentario viejo entra con su raíz como contexto", async () => {
    vi.stubGlobal(
      "fetch",
      mockGraph([
        {
          id: "c-raiz",
          text: "Tienen envío?",
          timestamp: iso(40 * 24 * 60 * 60_000),
          from: { id: "cliente-4", username: "cliente4" },
          replies: {
            data: [
              {
                id: "r-reciente",
                text: "Sigo esperando",
                timestamp: iso(24 * 60 * 60_000),
                from: { id: "cliente-4", username: "cliente4" },
              },
            ],
          },
        },
      ]),
    );
    const r = await pullCommentsForConnection(fakeDb(), connection);
    expect(r.ingestedInbound).toBe(2);
    const raiz = ingested.find((e) => e.externalMessageId === "c-raiz");
    const respuesta = ingested.find((e) => e.externalMessageId === "r-reciente");
    // La raíz es historia: nunca algo a contestar.
    expect(raiz).toMatchObject({ historical: true, suppressAutoReply: true });
    expect(respuesta?.comment).toMatchObject({ parentCommentId: "c-raiz" });
  });

  it("un hilo entero fuera de la ventana sigue afuera", async () => {
    vi.stubGlobal(
      "fetch",
      mockGraph([
        {
          id: "c-viejo-2",
          text: "Precio?",
          timestamp: iso(40 * 24 * 60 * 60_000),
          from: { id: "cliente-5", username: "cliente5" },
          replies: {
            data: [
              {
                id: "r-vieja",
                text: "Gracias",
                timestamp: iso(39 * 24 * 60 * 60_000),
                from: { id: "cliente-5", username: "cliente5" },
              },
            ],
          },
        },
      ]),
    );
    const r = await pullCommentsForConnection(fakeDb(), connection);
    expect(r.ingestedInbound).toBe(0);
    expect(ingested).toHaveLength(0);
  });

  it("la foto de un comentario de Facebook se pide a Graph y entra re-hospedada", async () => {
    vi.mocked(ingestMetaAttachment).mockClear();
    const request = mockGraph([
      {
        id: "fb-foto",
        message: "",
        created_time: iso(2 * 24 * 60 * 60_000),
        from: { id: "cliente-fb", name: "Claudia Vikario" },
        attachment: {
          type: "photo",
          media: { image: { src: "https://scontent.xx.fbcdn.net/foto.jpg" } },
        },
      },
    ]);
    vi.stubGlobal("fetch", request);
    await pullCommentsForConnection(fakeDb(), fbConnection);

    const commentsCall = request.mock.calls
      .map(([url]) => decodeURIComponent(String(url)))
      .find((url) => url.includes(`/${POST}/comments`));
    expect(commentsCall).toContain("attachment");
    expect(ingestMetaAttachment).toHaveBeenCalledWith(
      expect.objectContaining({
        attachmentUrl: "https://scontent.xx.fbcdn.net/foto.jpg",
        hintedKind: "image",
        externalMessageId: "fb-foto",
        accessToken: "token",
      }),
    );
    expect(ingested[0].attachments).toEqual([
      { url: "/api/media/ws-1/cliente-fb/fb-foto.jpg", mime_type: "image/jpeg", size: 10 },
    ]);
  });

  it("ante un límite de Graph frena sin error y deja la publicación en la cola", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.includes(`/${POST}/comments`)) {
          return new Response(
            JSON.stringify({ error: { code: 32, message: "(#32) Page request limit reached" } }),
            { status: 400 },
          );
        }
        const json = url.includes("/media")
          ? { data: [{ id: POST, timestamp: iso(0) }] }
          : { username: "pilaroficial_arg" };
        return new Response(JSON.stringify(json));
      }),
    );
    const r = await pullCommentsForConnection(fakeDb(), connection, {
      suppressAutoReply: true,
      resumable: true,
    });
    expect(r.rateLimited).toBe(true);
    expect(r.errors).toEqual(["comments_sync_pending"]);
    expect(savePollState).toHaveBeenCalledWith(
      expect.anything(),
      connection.id,
      expect.objectContaining({ comment_sync_posts: [POST] }),
      null,
      { complete: false },
    );
  });

  it("avisa, sin marcarlo como error, que no hay cuenta publicitaria elegida", async () => {
    vi.stubGlobal("fetch", mockGraph([]));
    const r = await pullCommentsForConnection(fakeDb(), connection);
    expect(r.notes).toEqual(["ad_accounts_not_selected"]);
    expect(r.errors).toEqual([]);
  });
});

describe("commentAttachmentMedia", () => {
  it("baja la foto, el sticker y el video o GIF del comentario", () => {
    expect(
      commentAttachmentMedia({ attachment: { type: "photo", media: { image: { src: "https://x/f.jpg" } } } }),
    ).toEqual({ url: "https://x/f.jpg", kind: "image" });
    expect(
      commentAttachmentMedia({ attachment: { type: "sticker", media: { image: { src: "https://x/s.png" } } } }),
    ).toEqual({ url: "https://x/s.png", kind: "image" });
    expect(
      commentAttachmentMedia({
        attachment: {
          type: "animated_image_share",
          media: { image: { src: "https://x/p.jpg" }, source: "https://x/g.mp4" },
        },
      }),
    ).toEqual({ url: "https://x/g.mp4", kind: "video" });
  });

  it("un enlace compartido no se baja: su imagen es de un sitio ajeno", () => {
    expect(
      commentAttachmentMedia({
        attachment: { type: "share", url: "https://tienda.com", media: { image: { src: "https://x/prev.jpg" } } },
      }),
    ).toBeNull();
    expect(commentAttachmentMedia({})).toBeNull();
  });
});

describe("threadInWindow", () => {
  const enVentana = (c: { id?: string; t: number }) => c.t >= 10;

  it("la raíz en la ventana entra con sus respuestas en la ventana", () => {
    const r = threadInWindow({ id: "a", t: 12 }, [{ id: "b", t: 5 }, { id: "c", t: 15 }], enVentana);
    expect(r).toEqual({ rootIsContext: false, replies: [{ id: "c", t: 15 }] });
  });

  it("la raíz vieja entra como contexto si alguna respuesta está en la ventana", () => {
    const r = threadInWindow({ id: "a", t: 1 }, [{ id: "b", t: 15 }], enVentana);
    expect(r).toEqual({ rootIsContext: true, replies: [{ id: "b", t: 15 }] });
  });

  it("un hilo sin nada en la ventana no entra", () => {
    expect(threadInWindow({ id: "a", t: 1 }, [{ id: "b", t: 2 }], enVentana)).toBeNull();
  });
});

describe("ventana de la pasada programada", () => {
  it("la primera pasada cubre 90 días y después vuelve a 14", () => {
    expect(scheduledWindowMs({})).toBe(HISTORY_WINDOW_MS);
    expect(HISTORY_WINDOW_MS).toBe(90 * 24 * 60 * 60 * 1000);
    expect(scheduledWindowMs({ [COMMENT_HISTORY_DONE]: true })).toBe(14 * 24 * 60 * 60 * 1000);
  });

  it("sólo cierra la historia la vuelta que se descubrió con la ventana larga", () => {
    // Vuelta nueva que termina en una corrida.
    expect(historyPassPatch({}, true)).toEqual({
      comment_history_complete: true,
      comment_history_started: null,
    });
    // Vuelta nueva a medias.
    expect(historyPassPatch({}, false)).toEqual({ comment_history_started: true });
    // Cola heredada de antes: al vaciarse no cuenta como pasada histórica.
    expect(historyPassPatch({ comment_sync_posts: ["p1"] }, true)).toEqual({});
    // Cola armada ya con la ventana larga.
    expect(
      historyPassPatch({ comment_sync_posts: ["p1"], comment_history_started: true }, true),
    ).toEqual({ comment_history_complete: true, comment_history_started: null });
    // Historia cerrada: nada más que anotar.
    expect(historyPassPatch({ [COMMENT_HISTORY_DONE]: true }, true)).toEqual({});
  });
});
