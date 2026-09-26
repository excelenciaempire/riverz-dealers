import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChannelConnection } from "@/types";

const h = vi.hoisted(() => ({
  conns: [] as unknown[],
  saved: [] as Array<{ patch: Record<string, unknown>; error: string | null }>,
  ingested: [] as string[],
}));

vi.mock("../admin-client", () => ({
  supabaseAdmin: () => {
    const chain: Record<string | symbol, unknown> = new Proxy(
      {},
      {
        get(_t, prop) {
          if (prop === "then") {
            return (resolve: (v: unknown) => unknown) =>
              Promise.resolve({ data: [], error: null }).then(resolve);
          }
          if (prop === "maybeSingle") return () => Promise.resolve({ data: null, error: null });
          return () => chain;
        },
      },
    );
    return { from: () => chain };
  },
}));
vi.mock("../connections", () => ({ listConnections: async () => h.conns }));
vi.mock("../poll-state", () => ({
  savePollState: async (_db: unknown, _id: string, patch: Record<string, unknown>, error: string | null) => {
    h.saved.push({ patch, error });
  },
}));
vi.mock("./videos", () => ({ guardarVideos: async () => 0 }));
vi.mock("./adapter", () => ({ getFreshTikTokToken: async () => "tok" }));
vi.mock("../inbox-writer", () => ({
  ingestInboundEvent: async (_db: unknown, e: { externalMessageId: string }) => {
    h.ingested.push(e.externalMessageId);
    return { id: e.externalMessageId };
  },
}));
vi.mock("../comment-sync", () => ({
  applyCommentLifecycle: async () => undefined,
  patchFor: () => null,
}));

import { pollAllTikTokConnections } from "./poll";
import { TIKTOK_DEEP_SWEEP_KEY } from "./sweep-state";

const videoId = (n: number) => `74000000000000${String(n).padStart(5, "0")}`;
/** Video con miles de comentarios: nunca termina dentro de una corrida. */
const BIG = videoId(3);
/** Video que TikTok no deja leer. */
const BROKEN = videoId(5);

const videoListCursors: Array<string | null> = [];
const bigCommentCursors: Array<string | null> = [];

function mockTikTok() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string) => {
      const url = new URL(input);
      const cursor = url.searchParams.get("cursor");
      if (url.pathname.endsWith("/business/video/list/")) {
        videoListCursors.push(cursor);
        // Catálogo sin fin: cada página tiene 20 videos y siempre hay más.
        const page = Number(cursor ?? 0);
        const videos = Array.from({ length: 20 }, (_, i) => ({ item_id: videoId(page * 20 + i) }));
        return Response.json({ code: 0, data: { videos, has_more: true, cursor: page + 1 } });
      }
      if (url.pathname.endsWith("/business/comment/list/")) {
        const video = url.searchParams.get("video_id");
        if (video === BROKEN) return Response.json({ code: 40001, message: "no" });
        if (video !== BIG) return Response.json({ code: 0, data: { comments: [], has_more: false } });
        bigCommentCursors.push(cursor);
        const page = Number(cursor ?? 0);
        return Response.json({
          code: 0,
          data: {
            comments: [{ comment_id: `c${page}`, user_id: "fan", text: "hola", create_time: "1700000000" }],
            has_more: true,
            cursor: page + 1,
          },
        });
      }
      return Response.json({ code: 40000 });
    }),
  );
}

function connection(config: Record<string, unknown> = {}): ChannelConnection {
  return {
    id: "tt-1",
    workspace_id: "ws-1",
    channel: "tiktok_comment",
    status: "connected",
    config: { business_id: "biz", ...config },
  } as unknown as ChannelConnection;
}

describe("barrido profundo de TikTok con topes", () => {
  beforeEach(() => {
    h.saved.length = 0;
    h.ingested.length = 0;
    videoListCursors.length = 0;
    bigCommentCursors.length = 0;
    mockTikTok();
  });
  afterEach(() => vi.unstubAllGlobals());

  it("al llegar a los topes guarda los cursores en vez de fallar, y un video roto no corta el resto", async () => {
    h.conns = [connection()];

    const r = await pollAllTikTokConnections({ deep: true });

    expect(r.connections[0].error).toBeUndefined();
    expect(r.connections[0].videos).toBe(300);
    expect(r.connections[0].video_errors).toBe(1);
    // Se guardó lo que se leyó del video grande: 20 páginas.
    expect(h.ingested).toHaveLength(20);

    const { patch, error } = h.saved[0];
    expect(error).toBeNull();
    expect(patch.last_poll_video_errors).toBe(1);
    expect(patch[TIKTOK_DEEP_SWEEP_KEY]).toEqual({
      video_cursor: 15,
      comment_cursors: { [BIG]: 20 },
    });
  });

  it("la corrida siguiente sigue desde los cursores guardados", async () => {
    h.conns = [
      connection({
        [TIKTOK_DEEP_SWEEP_KEY]: { video_cursor: 15, comment_cursors: { [BIG]: 20 } },
      }),
    ];

    await pollAllTikTokConnections({ deep: true });

    expect(videoListCursors[0]).toBe("15");
    // El video grande no está en esta tanda de videos: su cursor se conserva.
    const sweep = h.saved[0].patch[TIKTOK_DEEP_SWEEP_KEY] as Record<string, unknown>;
    expect(sweep.video_cursor).toBe(30);
    expect(sweep.comment_cursors).toEqual({ [BIG]: 20 });
  });

  it("retoma los comentarios de un video desde su cursor", async () => {
    h.conns = [connection({ [TIKTOK_DEEP_SWEEP_KEY]: { video_cursor: null, comment_cursors: { [BIG]: 20 } } })];

    await pollAllTikTokConnections({ deep: true });

    expect(bigCommentCursors[0]).toBe("20");
    const sweep = h.saved[0].patch[TIKTOK_DEEP_SWEEP_KEY] as Record<string, unknown>;
    expect(sweep.comment_cursors).toEqual({ [BIG]: 40 });
  });

  it("el sondeo liviano no toca el estado del barrido profundo", async () => {
    h.conns = [connection()];

    const r = await pollAllTikTokConnections();

    expect(r.connections[0].error).toBeUndefined();
    expect(videoListCursors).toEqual([null]);
    expect(h.saved[0].patch).not.toHaveProperty(TIKTOK_DEEP_SWEEP_KEY);
  });
});
