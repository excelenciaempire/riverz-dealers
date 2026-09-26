import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChannelConnection } from "@/types";
import type { InboundEvent } from "../types";
import { MlRateLimitError } from "./rate-limit";
import { initialBackfillState, type MlMsgBackfillState } from "./history-state";

const h = vi.hoisted(() => ({
  conns: [] as ChannelConnection[],
  ingested: [] as InboundEvent[],
  saved: [] as Array<Record<string, unknown>>,
  packReads: [] as string[],
  packBehavior: {} as Record<string, "ok" | "fail" | "429">,
  claimsPage: { consumed: 0, pageLength: 0, ingested: 0, errors: 0, rateLimited: false } as Record<string, unknown>,
}));

vi.mock("../admin-client", () => ({ supabaseAdmin: () => ({}) }));
vi.mock("../connections", () => ({ listConnections: async () => h.conns }));
vi.mock("../inbox-writer", () => ({
  ingestInboundEvent: async (_db: unknown, e: InboundEvent) => {
    h.ingested.push(e);
    return { id: e.externalMessageId };
  },
}));
vi.mock("../poll-state", () => ({
  savePollState: async (_db: unknown, _id: string, patch: Record<string, unknown>) => {
    h.saved.push(patch);
  },
}));
vi.mock("./adapter", () => ({
  getFreshMLToken: async () => "token",
  resolveMlNickname: async () => "apodo",
  buildPackEvents: async ({ packId }: { packId: string }) => {
    h.packReads.push(packId);
    const behavior = h.packBehavior[packId] ?? "ok";
    if (behavior === "429") throw new MlRateLimitError(`messages/packs/${packId}`);
    if (behavior === "fail") throw new Error(`messages/packs/${packId} HTTP 403`);
    return {
      quiet: false,
      events: [
        { channel: "mercadolibre", externalContactId: "b", externalMessageId: `${packId}-buyer`, text: "hola", receivedAt: "2026-03-01T10:00:00.000Z" },
        { channel: "mercadolibre", externalContactId: "b", externalMessageId: `${packId}-seller`, text: "listo", receivedAt: "2026-03-01T11:00:00.000Z", outbound: true },
      ],
    };
  },
}));
vi.mock("./claims-poll", () => ({
  MAX_CLAIMS: 9_900,
  backfillClaimsPage: async () => h.claimsPage,
}));

import { backfillAllMercadoLibreHistory } from "./history";

/** Pedidos de la cuenta, del más nuevo al más viejo. */
let orders: Array<{ id: number; pack_id: number | null; date_created: string }> = [];
let questions: Array<Record<string, unknown>> = [];

/** Simula `orders/search` respetando `to`, `offset` y `limit`, y `questions/search`. */
function mockMl() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string) => {
      const url = new URL(input);
      const offset = Number(url.searchParams.get("offset") ?? 0);
      const limit = Number(url.searchParams.get("limit") ?? 50);
      if (url.pathname === "/orders/search") {
        const to = Date.parse(url.searchParams.get("order.date_created.to")!.replace("-00:00", "Z"));
        const inRange = orders.filter((o) => Date.parse(o.date_created) <= to);
        return Response.json({ results: inRange.slice(offset, offset + limit) });
      }
      if (url.pathname === "/questions/search") {
        return Response.json({ questions: questions.slice(offset, offset + limit), total: questions.length });
      }
      return new Response("not found", { status: 404 });
    }),
  );
}

function connection(state?: MlMsgBackfillState): ChannelConnection {
  return {
    id: "conn-1",
    workspace_id: "ws-1",
    channel: "mercadolibre",
    status: "connected",
    config: { seller_id: "42", ...(state ? { ml_msg_backfill: state } : {}) },
  } as unknown as ChannelConnection;
}

function lastState(): MlMsgBackfillState {
  return h.saved[h.saved.length - 1].ml_msg_backfill as MlMsgBackfillState;
}

const recent = (daysAgo: number) => new Date(Date.now() - daysAgo * 86_400_000).toISOString();

describe("importación histórica de Mercado Libre", () => {
  beforeEach(() => {
    h.ingested.length = 0;
    h.saved.length = 0;
    h.packReads.length = 0;
    h.packBehavior = {};
    h.claimsPage = { consumed: 0, pageLength: 0, ingested: 0, errors: 0, rateLimited: false };
    const sameSecond = recent(1);
    orders = [
      { id: 1, pack_id: 100, date_created: sameSecond },
      { id: 2, pack_id: 100, date_created: sameSecond },
      { id: 3, pack_id: null, date_created: recent(10) },
      { id: 4, pack_id: 400, date_created: recent(40) },
    ];
    questions = [
      { id: 7, text: "¿tiene stock?", date_created: recent(2), from: { id: 9 }, answer: { text: "sí", date_created: recent(2) } },
      { id: 8, text: "¿envían?", date_created: recent(3), from: { id: 9 } },
    ];
    mockMl();
  });
  afterEach(() => vi.unstubAllGlobals());

  it("importa hilos, preguntas y reclamos y sólo al final se marca completa", async () => {
    h.conns = [connection()];

    const r = await backfillAllMercadoLibreHistory();

    // Un hilo por paquete: los dos pedidos del paquete 100 comparten hilo.
    expect(h.packReads).toEqual(["100", "3", "400"]);
    expect(r.packs).toBe(3);
    expect(r.questions).toBe(2);
    expect(r.completed).toBe(1);
    const s = lastState();
    expect(s.orders).toBeNull();
    expect(s.questions).toBeNull();
    expect(s.claims).toBeNull();
    expect(s.completed_at).not.toBeNull();

    // Las respuestas del vendedor entran como salientes; lo contestado, como historia.
    const answer = h.ingested.find((e) => e.externalMessageId === "a:7");
    expect(answer?.outbound).toBe(true);
    expect(h.ingested.find((e) => e.externalMessageId === "q:7")?.historical).toBe(true);
    // Pregunta reciente sin contestar: pendiente, pero sin respuesta automática.
    const pending = h.ingested.find((e) => e.externalMessageId === "q:8");
    expect(pending?.historical).toBeUndefined();
    expect(pending?.suppressAutoReply).toBe(true);
    expect(pending?.contactName).toBe("apodo");
    expect(h.ingested.find((e) => e.externalMessageId === "100-buyer")?.historical).toBe(true);
  });

  it("un 429 corta la corrida sin pasar por encima del hilo que no se leyó", async () => {
    h.conns = [connection()];
    h.packBehavior = { "3": "429" };

    const r = await backfillAllMercadoLibreHistory();

    expect(r.rateLimited).toBe(true);
    expect(h.packReads).toEqual(["100", "3"]);
    const s = lastState();
    // El cursor queda en el último pedido completo: el 3 se vuelve a pedir.
    expect(Date.parse(s.orders!.before)).toBe(Date.parse(orders[1].date_created));
    // Nada más corrió después del 429.
    expect(s.questions).toEqual({ offset: 0 });
    expect(s.completed_at).toBeNull();

    // La corrida siguiente retoma justo ahí.
    h.packReads.length = 0;
    h.packBehavior = {};
    h.conns = [connection(s)];
    await backfillAllMercadoLibreHistory();
    expect(h.packReads).toEqual(["100", "3", "400"]);
    expect(lastState().completed_at).not.toBeNull();
  });

  it("un hilo roto se saltea y la corrida sigue", async () => {
    h.conns = [connection()];
    h.packBehavior = { "3": "fail" };

    const r = await backfillAllMercadoLibreHistory();

    expect(h.packReads).toEqual(["100", "3", "400"]);
    expect(r.errors).toEqual([]);
    const s = lastState();
    expect(s.errors).toBe(1);
    expect(s.last_error).toContain("pack 3");
    expect(s.orders).toBeNull();
  });

  it("no vuelve a mirar una conexión con la importación terminada", async () => {
    const done = { ...initialBackfillState(Date.now()), orders: null, questions: null, claims: null, completed_at: new Date().toISOString() };
    h.conns = [connection(done)];

    const r = await backfillAllMercadoLibreHistory();

    expect(r.sellers).toBe(0);
    expect(fetch).not.toHaveBeenCalled();
    expect(h.saved).toEqual([]);
  });

  it("no da por terminada la historia mientras quedan reclamos", async () => {
    h.conns = [connection()];
    h.claimsPage = { consumed: 20, pageLength: 20, total: 45, ingested: 3, errors: 0, rateLimited: false };

    await backfillAllMercadoLibreHistory();

    const s = lastState();
    expect(s.claims).toEqual({ offset: 20 });
    expect(s.completed_at).toBeNull();
  });
});
