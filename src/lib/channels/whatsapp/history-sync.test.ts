import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ChannelConnection } from "@/types";

vi.mock("../poll-state", () => ({ savePollState: vi.fn(async () => undefined) }));
vi.mock("../encryption", () => ({ decrypt: (value: string) => `plain-${value}` }));

import { savePollState } from "../poll-state";
import {
  ensureCoexistenceHistorySync,
  historyWebhookLive,
  requestCoexistenceHistorySync,
} from "./history-sync";

const db = {} as SupabaseClient;
const PHONE = "1234567890123";
const HOUR = 60 * 60_000;

function coexistence(
  config: Record<string, unknown>,
  createdAt = new Date(Date.now() - 400 * HOUR).toISOString(),
): ChannelConnection {
  return {
    id: "conn-wa",
    workspace_id: "ws-1",
    channel: "whatsapp",
    status: "connected",
    external_account_id: PHONE,
    created_at: createdAt,
    config: { phone_number_id: PHONE, coexistence: true, ...config },
    secrets: { access_token: "enc" },
  } as unknown as ChannelConnection;
}

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const syncTypes = () =>
  fetchMock.mock.calls.map(([, init]) => JSON.parse(String((init as RequestInit).body)).sync_type);

describe("requestCoexistenceHistorySync", () => {
  it("pide contactos y después historial, y anota el pedido", async () => {
    fetchMock.mockResolvedValue(new Response("{}", { status: 200 }));

    const ok = await requestCoexistenceHistorySync(db, {
      connectionId: "conn-wa",
      phoneNumberId: PHONE,
      token: "tok",
    });

    expect(ok).toBe(true);
    expect(syncTypes()).toEqual(["smb_app_state_sync", "history"]);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain(`/${PHONE}/smb_app_data`);
    expect(url).toContain("appsecret_proof=");
    expect(init.method).toBe("POST");
    expect(savePollState).toHaveBeenCalledWith(
      db,
      "conn-wa",
      { history_sync_requested_at: expect.any(String), history_sync_error: null },
      null,
      { complete: false },
    );
  });

  it("si Meta rechaza el historial lo anota como error", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response("{}", { status: 200 }))
      .mockResolvedValueOnce(new Response('{"error":{"code":100}}', { status: 400 }));

    const ok = await requestCoexistenceHistorySync(db, {
      connectionId: "conn-wa",
      phoneNumberId: PHONE,
      token: "tok",
    });

    expect(ok).toBe(false);
    expect(savePollState).toHaveBeenCalledWith(
      db,
      "conn-wa",
      { history_sync_error: expect.stringContaining("400") },
      null,
      { complete: false },
    );
  });
});

describe("historyWebhookLive", () => {
  const sub = (fields: string[], active = true) => ({
    whatsapp_business_account: { active, fields, callbackUrl: "https://riverz.co/x" },
  });

  it("sólo con el campo history suscrito y activo", () => {
    expect(historyWebhookLive(sub(["messages", "history"]))).toBe(true);
    expect(historyWebhookLive(sub(["messages", "smb_message_echoes"]))).toBe(false);
    expect(historyWebhookLive(sub(["history"], false))).toBe(false);
    expect(historyWebhookLive(null)).toBe(false);
  });
});

describe("ensureCoexistenceHistorySync", () => {
  beforeEach(() => {
    fetchMock.mockResolvedValue(new Response("{}", { status: 200 }));
  });

  it("pide el historial dentro de las 24 horas si todavía no salió", async () => {
    const out = await ensureCoexistenceHistorySync(
      db,
      coexistence({ connected_at: new Date(Date.now() - HOUR).toISOString() }),
    );
    expect(out).toBe(true);
    expect(syncTypes()).toEqual(["smb_app_state_sync", "history"]);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer plain-enc");
  });

  it("sin connected_at usa el alta de la conexión", async () => {
    const recent = new Date(Date.now() - 2 * HOUR).toISOString();
    expect(await ensureCoexistenceHistorySync(db, coexistence({}, recent))).toBe(true);
    fetchMock.mockClear();
    expect(await ensureCoexistenceHistorySync(db, coexistence({}))).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("no pide nada fuera de la ventana, ya pedido o sin coexistencia", async () => {
    const connectedAt = new Date(Date.now() - HOUR).toISOString();
    const cases = [
      coexistence({ connected_at: new Date(Date.now() - 25 * HOUR).toISOString() }),
      coexistence({ connected_at: connectedAt, history_sync_requested_at: new Date().toISOString() }),
      coexistence({ connected_at: connectedAt, coexistence: false }),
    ];
    for (const connection of cases) {
      expect(await ensureCoexistenceHistorySync(db, connection)).toBeNull();
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("un pedido de una conexión anterior no cuenta para la nueva", async () => {
    const out = await ensureCoexistenceHistorySync(
      db,
      coexistence({
        connected_at: new Date(Date.now() - HOUR).toISOString(),
        history_sync_requested_at: new Date(Date.now() - 48 * HOUR).toISOString(),
      }),
    );
    expect(out).toBe(true);
    expect(syncTypes()).toEqual(["smb_app_state_sync", "history"]);
  });
});
