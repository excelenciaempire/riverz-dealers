import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ChannelConnection } from "@/types";
import {
  CHANNEL_DISCONNECTED_CODE,
  assertConnectionCanSend,
  isChannelDisconnectedError,
  storedConnectionCanSend,
} from "./send-guard";

function connection(status: ChannelConnection["status"]): ChannelConnection {
  return { status } as ChannelConnection;
}

function dbWithStoredStatus(status: ChannelConnection["status"] | null) {
  const maybeSingle = vi.fn().mockResolvedValue({
    data: status ? { status } : null,
    error: null,
  });
  const eq = vi.fn(() => ({ maybeSingle }));
  const select = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ select }));
  return { from } as unknown as SupabaseClient;
}

describe("compuerta de canales desconectados", () => {
  it("permite una conexión activa", () => {
    expect(() => assertConnectionCanSend(connection("connected"))).not.toThrow();
  });

  it("bloquea una conexión desconectada con un código estable", () => {
    let thrown: unknown;
    try {
      assertConnectionCanSend(connection("disconnected"));
    } catch (error) {
      thrown = error;
    }

    expect(isChannelDisconnectedError(thrown)).toBe(true);
    expect((thrown as { code: string }).code).toBe(CHANNEL_DISCONNECTED_CODE);
  });

  it("vuelve a consultar la conexión antes de un trabajo en curso", async () => {
    await expect(storedConnectionCanSend(dbWithStoredStatus("connected"), "c1"))
      .resolves.toBe(true);
    await expect(
      storedConnectionCanSend(dbWithStoredStatus("disconnected"), "c1"),
    ).resolves.toBe(false);
  });

  it("bloquea también si la conexión ya no existe", async () => {
    await expect(storedConnectionCanSend(dbWithStoredStatus(null), "c1"))
      .resolves.toBe(false);
  });
});
