import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ChannelConnection } from "@/types";

const order: string[] = [];
vi.mock("../poll-state", () => ({
  savePollState: vi.fn(async (_db: unknown, _id: string, patch: unknown) => {
    order.push(typeof patch === "function" ? "patch-fn" : `save:${Object.keys(patch as object).join(",")}`);
  }),
}));
vi.mock("./journal", () => ({
  backfillWhatsappConnection: vi.fn(async () => {
    order.push("backfill");
    return { ingested: 4 };
  }),
}));

import { savePollState } from "../poll-state";
import { backfillWhatsappConnection } from "./journal";
import {
  historyProgressPatch,
  historyReplayDue,
  readHistoryDelivery,
  recordHistoryProgress,
  replayHistoryOnce,
} from "./history-progress";

const PHONE = "1234567890123";
const HOUR = 60 * 60_000;
const db = {} as SupabaseClient;

function history(phone: string, chunks: unknown[]) {
  return {
    object: "whatsapp_business_account",
    entry: [{ id: "waba", changes: [{ field: "history", value: { metadata: { phone_number_id: phone }, history: chunks } }] }],
  };
}

const chunk = (phase: number, progress: number, chunkOrder: number, messages: number) => ({
  metadata: { phase, chunk_order: chunkOrder, progress },
  threads: [{ id: "5491155555555", messages: Array.from({ length: messages }, (_, i) => ({ id: `m${i}` })) }],
});

describe("readHistoryDelivery", () => {
  it("cuenta tandas y mensajes de este número y se queda con el avance más alto", () => {
    const out = readHistoryDelivery(history(PHONE, [chunk(1, 30, 4, 2), chunk(0, 100, 1, 3)]), PHONE);
    expect(out).toEqual({ chunks: 2, messages: 5, phase: 1, progress: 30, chunkOrder: 4, error: null });
  });

  it("anota el error de Meta cuando el comercio no comparte el historial", () => {
    const out = readHistoryDelivery(
      history(PHONE, [{ errors: [{ code: 2593109, title: "History sync is turned off by the business" }] }]),
      PHONE,
    );
    expect(out).toMatchObject({ chunks: 0, error: { code: 2593109, text: "2593109: History sync is turned off by the business" } });
  });

  it("ignora otros números y entregas sin historial", () => {
    expect(readHistoryDelivery(history("999", [chunk(0, 10, 1, 1)]), PHONE)).toBeNull();
    expect(readHistoryDelivery({ entry: [{ changes: [{ field: "messages", value: {} }] }] }, PHONE)).toBeNull();
    expect(readHistoryDelivery(null, PHONE)).toBeNull();
  });
});

describe("historyProgressPatch", () => {
  const now = "2026-09-26T10:00:00.000Z";

  it("suma sobre lo que ya había y no retrocede si la tanda llega desordenada", () => {
    const current = { history_chunks_received: 3, history_messages_received: 40, history_phase: 1, history_progress: 60 };
    const delivery = { chunks: 1, messages: 5, phase: 1, progress: 20, chunkOrder: 2, error: null };
    expect(historyProgressPatch(current, delivery, now)).toEqual({
      last_history_at: now,
      history_chunks_received: 4,
      history_messages_received: 45,
    });
  });

  it("sólo da por completo el historial al terminar la última fase", () => {
    const base = { chunks: 1, messages: 1, chunkOrder: 9, error: null };
    expect(historyProgressPatch({}, { ...base, phase: 0, progress: 100 }, now)).not.toHaveProperty("history_complete");
    expect(historyProgressPatch({}, { ...base, phase: 2, progress: 100 }, now)).toMatchObject({
      history_phase: 2,
      history_progress: 100,
      history_chunk_order: 9,
      history_complete: true,
    });
  });

  it("guarda el error de Meta sin tocar los contadores", () => {
    const patch = historyProgressPatch(
      { history_chunks_received: 2 },
      { chunks: 0, messages: 0, phase: null, progress: null, chunkOrder: null, error: { code: 2593109, text: "2593109: off" } },
      now,
    );
    expect(patch).toEqual({ last_history_at: now, history_sync_error: "2593109: off", history_sync_error_code: 2593109 });
  });
});

const connection = (config: Record<string, unknown>) =>
  ({
    id: "conn-wa",
    workspace_id: "ws-1",
    channel: "whatsapp",
    status: "connected",
    external_account_id: PHONE,
    config: { phone_number_id: PHONE, coexistence: true, ...config },
  }) as unknown as ChannelConnection;

describe("recordHistoryProgress", () => {
  beforeEach(() => {
    order.length = 0;
    vi.mocked(savePollState).mockClear();
  });

  it("suma sobre el config actual de la fila, no sobre la foto de la conexión", async () => {
    await recordHistoryProgress(db, connection({ history_chunks_received: 0 }), history(PHONE, [chunk(0, 50, 1, 2)]));
    const patch = vi.mocked(savePollState).mock.calls[0][2] as (c: Record<string, unknown>) => Record<string, unknown>;
    expect(patch({ history_chunks_received: 7 })).toMatchObject({ history_chunks_received: 8, history_messages_received: 2 });
  });

  it("no escribe nada para una entrega sin historial", async () => {
    await recordHistoryProgress(db, connection({}), { entry: [] });
    expect(savePollState).not.toHaveBeenCalled();
  });
});

describe("historyReplayDue", () => {
  const now = Date.parse("2026-09-26T12:00:00Z");
  const ago = (ms: number) => new Date(now - ms).toISOString();

  it("corre una hora después del pedido, con las tandas quietas, una sola vez", () => {
    const requested = ago(2 * HOUR);
    expect(historyReplayDue({ coexistence: true, history_sync_requested_at: requested }, now)).toBe(true);
    expect(historyReplayDue({ coexistence: true, history_sync_requested_at: ago(30 * 60_000) }, now)).toBe(false);
    expect(
      historyReplayDue({ coexistence: true, history_sync_requested_at: requested, last_history_at: ago(10 * 60_000) }, now),
    ).toBe(false);
    expect(
      historyReplayDue({ coexistence: true, history_sync_requested_at: requested, history_replay_at: ago(HOUR) }, now),
    ).toBe(false);
  });

  it("un pedido nuevo vuelve a habilitarla; sin pedido, sin coexistencia o sin diario, no", () => {
    expect(
      historyReplayDue({ coexistence: true, history_sync_requested_at: ago(2 * HOUR), history_replay_at: ago(48 * HOUR) }, now),
    ).toBe(true);
    expect(historyReplayDue({ coexistence: true }, now)).toBe(false);
    expect(historyReplayDue({ coexistence: false, history_sync_requested_at: ago(2 * HOUR) }, now)).toBe(false);
    expect(historyReplayDue({ coexistence: true, history_sync_requested_at: ago(15 * 24 * HOUR) }, now)).toBe(false);
  });
});

describe("replayHistoryOnce", () => {
  beforeEach(() => {
    order.length = 0;
    vi.mocked(savePollState).mockClear();
    vi.mocked(backfillWhatsappConnection).mockClear();
  });

  it("marca la relectura antes de correrla y relee todo el diario como histórico", async () => {
    const now = Date.now();
    const conn = connection({ history_sync_requested_at: new Date(now - 2 * HOUR).toISOString() });

    expect(await replayHistoryOnce(db, conn, now)).toEqual({ ingested: 4 });

    expect(order).toEqual(["save:history_replay_at", "backfill", "save:history_replay_result"]);
    expect(backfillWhatsappConnection).toHaveBeenCalledWith(db, conn, {
      sinceIso: new Date(0).toISOString(),
      untilIso: new Date(now).toISOString(),
    });
  });

  it("no hace nada cuando no corresponde", async () => {
    expect(await replayHistoryOnce(db, connection({}), Date.now())).toBeNull();
    expect(order).toEqual([]);
  });
});
