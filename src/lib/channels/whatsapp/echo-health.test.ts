import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ChannelConnection } from "@/types";
import { checkCoexistenceEchoes, nextEchoAlarm } from "./echo-health";

describe("nextEchoAlarm", () => {
  it("se prende con más de cinco mensajes de clientes y ningún eco", () => {
    expect(nextEchoAlarm(false, { customers: 6, echoes: 0 })).toBe(true);
    expect(nextEchoAlarm(false, { customers: 5, echoes: 0 })).toBe(false);
  });

  it("se apaga sólo cuando aparece un eco; un día tranquilo no la apaga", () => {
    expect(nextEchoAlarm(true, { customers: 6, echoes: 1 })).toBe(false);
    expect(nextEchoAlarm(true, { customers: 0, echoes: 0 })).toBe(true);
  });
});

interface Call {
  ops: Array<[string, unknown[]]>;
}

function fakeDb(answer: (call: Call) => { data?: unknown; error?: unknown }) {
  const calls: Call[] = [];
  const db = {
    from() {
      const call: Call = { ops: [] };
      calls.push(call);
      const builder: Record<string, unknown> = new Proxy(
        {},
        {
          get(_target, prop: string) {
            if (prop === "then") {
              return (resolve: (v: unknown) => unknown) => Promise.resolve(answer(call)).then(resolve);
            }
            return (...args: unknown[]) => {
              call.ops.push([prop, args]);
              return builder;
            };
          },
        },
      );
      return builder;
    },
  };
  return { db: db as unknown as SupabaseClient, calls };
}

const has = (call: Call, op: string, ...args: unknown[]) =>
  call.ops.some(([name, a]) => name === op && args.every((v, i) => a[i] === v));

const isEchoQuery = (call: Call) => has(call, "eq", "sender_type", "agent");

describe("checkCoexistenceEchoes", () => {
  const now = Date.parse("2026-09-26T12:00:00Z");
  const connectedAt = "2026-09-26T02:00:00.000Z";
  const connection = (config: Record<string, unknown>) =>
    ({
      id: "conn-wa",
      workspace_id: "ws-1",
      channel: "whatsapp",
      config: { coexistence: true, connected_at: connectedAt, ...config },
      created_at: "2026-01-01T00:00:00Z",
    }) as unknown as ChannelConnection;

  it("cuenta sólo lo de esta conexión desde que se conectó y reconoce el eco del teléfono", async () => {
    const { db, calls } = fakeDb((call) => ({
      data: isEchoQuery(call) ? [] : Array.from({ length: 6 }, (_, i) => ({ id: `c${i}` })),
      error: null,
    }));

    const out = await checkCoexistenceEchoes(db, connection({}), now);

    expect(out).toEqual({
      alarm: true,
      counts: { customers: 6, echoes: 0 },
      patch: { echoes_missing_since: new Date(now).toISOString() },
    });
    for (const call of calls) {
      expect(has(call, "eq", "conversations.workspace_id", "ws-1")).toBe(true);
      expect(has(call, "eq", "conversations.connection_id", "conn-wa")).toBe(true);
      // La conexión es más nueva que 24 h: lo anterior es historial importado.
      expect(has(call, "gt", "created_at", connectedAt)).toBe(true);
    }
    const echo = calls.find(isEchoQuery);
    expect(echo && has(echo, "is", "sender_id", null)).toBe(true);
    expect(echo && has(echo, "is", "origin", null)).toBe(true);
    expect(echo && has(echo, "like", "message_id", "wamid%")).toBe(true);
  });

  it("conserva desde cuándo falta, y se limpia al llegar un eco", async () => {
    const since = "2026-09-25T09:00:00.000Z";
    const quiet = fakeDb(() => ({ data: [], error: null }));
    expect(await checkCoexistenceEchoes(quiet.db, connection({ echoes_missing_since: since }), now)).toMatchObject({
      alarm: true,
      patch: { echoes_missing_since: since },
    });
    const echoed = fakeDb((call) => ({ data: isEchoQuery(call) ? [{ id: "e" }] : [], error: null }));
    expect(await checkCoexistenceEchoes(echoed.db, connection({ echoes_missing_since: since }), now)).toMatchObject({
      alarm: false,
      patch: { echoes_missing_since: null },
    });
  });

  it("una lectura fallida deja la alarma como estaba; sin coexistencia no aplica", async () => {
    const broken = fakeDb(() => ({ data: null, error: { code: "57014" } }));
    expect(await checkCoexistenceEchoes(broken.db, connection({}), now)).toMatchObject({ alarm: false, counts: null });
    expect(
      await checkCoexistenceEchoes(broken.db, connection({ echoes_missing_since: "2026-09-25T09:00:00.000Z" }), now),
    ).toMatchObject({ alarm: true, counts: null });
    expect(await checkCoexistenceEchoes(broken.db, connection({ coexistence: false }), now)).toBeNull();
  });
});
