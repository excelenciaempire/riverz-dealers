import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ChannelConnection } from "@/types";

const ingested: Array<Record<string, unknown>> = [];
vi.mock("../inbox-writer", () => ({
  ingestInboundEvent: vi.fn(async (_db: unknown, e: Record<string, unknown>) => {
    ingested.push(e);
    return { id: "msg-1" };
  }),
}));
vi.mock("./adapter", () => ({
  getFreshMLToken: async () => "token",
  buildPackEvents: vi.fn(async ({ packId }: { packId: string }) => {
    read.push(packId);
    const events = (packEvents[packId] ?? []).map((e) => ({ ...e }));
    return { events, quiet: events.length === 0 };
  }),
}));

import { pollAllMercadoLibreMessages } from "./messages-poll";

const SELLER = "273955834";
/** Hilos con contenido; el resto se comporta como "cerrado y vacío". */
let packEvents: Record<string, Array<Record<string, unknown>>> = {};
let read: string[] = [];
let savedConfig: Record<string, unknown> | null = null;

const connection = {
  id: "conn-1",
  workspace_id: "ws-1",
  channel: "mercadolibre",
  status: "connected",
  config: { seller_id: SELLER },
} as unknown as ChannelConnection;

/** Supabase de mentira: devuelve la conexión y guarda lo que se le actualice. */
function fakeDb(conn: ChannelConnection): SupabaseClient {
  const db = {
    from() {
      const chain: Record<string | symbol, unknown> = new Proxy(
        {},
        {
          get(_t, prop) {
            if (prop === "then") {
              return (resolve: (v: unknown) => unknown) => Promise.resolve({ data: [conn] }).then(resolve);
            }
            if (prop === "maybeSingle") {
              return () => Promise.resolve({ data: { config: conn.config } });
            }
            if (prop === "update") {
              return (patch: Record<string, unknown>) => {
                savedConfig = patch.config as Record<string, unknown>;
                return chain;
              };
            }
            return () => chain;
          },
        }
      );
      return chain;
    },
  };
  return db as unknown as SupabaseClient;
}

vi.mock("../admin-client", () => ({ supabaseAdmin: () => currentDb }));
let currentDb: SupabaseClient;

const ORDERS = ["p1", "p2", "p3"];

/** Responde `/messages/unread` y `/orders/search`. */
function mockMl(unread: string[]) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const json = url.includes("/messages/unread")
        ? { results: unread.map((id) => ({ pack_id: id })) }
        : { results: ORDERS.map((id) => ({ id, pack_id: id })) };
      return { ok: true, json: async () => json } as unknown as Response;
    })
  );
}

describe("pollAllMercadoLibreMessages", () => {
  beforeEach(() => {
    ingested.length = 0;
    read = [];
    packEvents = {};
    savedConfig = null;
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("recuerda los hilos cerrados y no los relee en la corrida siguiente", async () => {
    const conn = {
      ...connection,
      config: { seller_id: SELLER },
    } as ChannelConnection;
    currentDb = fakeDb(conn);
    mockMl([]);

    const first = await pollAllMercadoLibreMessages();
    expect(first.packs).toBe(3);
    expect(read).toEqual(ORDERS);
    expect(Object.keys(savedConfig?.quiet_packs as object)).toEqual(ORDERS);

    // Segunda corrida con lo aprendido: no vuelve a pedir ninguno.
    read = [];
    conn.config = savedConfig as ChannelConnection["config"];
    currentDb = fakeDb(conn);
    const second = await pollAllMercadoLibreMessages();
    expect(second.packs).toBe(0);
    expect(second.skipped).toBe(3);
    expect(read).toEqual([]);
  });

  // La lista de cerrados no puede tapar una novedad: si Mercado Libre lo marca
  // como no leído, se lee igual.
  it("un hilo cerrado con novedad se lee igual y sale de la lista", async () => {
    const conn = {
      ...connection,
      config: {
        seller_id: SELLER,
        quiet_packs: { p1: Date.now(), p2: Date.now(), p3: Date.now() },
      },
    } as ChannelConnection;
    currentDb = fakeDb(conn);
    packEvents = {
      p2: [
        {
          channel: "mercadolibre",
          externalMessageId: "m1",
          receivedAt: new Date().toISOString(),
          text: "hola",
        },
      ],
    };
    mockMl(["p2"]);

    const r = await pollAllMercadoLibreMessages();

    expect(read).toEqual(["p2"]);
    expect(r.ingested).toBe(1);
    expect(Object.keys(savedConfig?.quiet_packs as object)).toEqual(["p1", "p3"]);
  });

  it("un mensaje viejo entra pero no despierta al agente", async () => {
    const conn = {
      ...connection,
      config: { seller_id: SELLER },
    } as ChannelConnection;
    currentDb = fakeDb(conn);
    packEvents = {
      p1: [
        {
          channel: "mercadolibre",
          externalMessageId: "viejo",
          receivedAt: new Date(Date.now() - 3 * 86_400_000).toISOString(),
          text: "mi pedido no llego",
        },
      ],
    };
    mockMl([]);

    await pollAllMercadoLibreMessages();

    expect(ingested).toHaveLength(1);
    expect(ingested[0].suppressAutoReply).toBe(true);
  });

  it("expone el fallo del proveedor para que el cron pueda recuperarlo", async () => {
    currentDb = fakeDb(connection);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 503 }) as Response)
    );

    const result = await pollAllMercadoLibreMessages();

    expect(result.failures).toEqual([{ connectionId: "conn-1", error: "messages/unread HTTP 503" }]);
  });
});
