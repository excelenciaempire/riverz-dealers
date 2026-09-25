import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ChannelConnection } from "@/types";

// Lo que decide si el cliente recibe una respuesta es con qué banderas entra
// cada mensaje, así que se intercepta la ingesta y se mira eso.
const ingested: Array<Record<string, unknown>> = [];
vi.mock("../inbox-writer", () => ({
  ingestInboundEvent: vi.fn(async (_db: unknown, event: Record<string, unknown>) => {
    ingested.push(event);
    return { message: { id: "m" } };
  }),
}));

// El adaptador real baja media de Meta; acá alcanza con ver qué le llega.
const parsed: unknown[] = [];
vi.mock("../registry", () => ({
  getAdapter: () => ({
    parseWebhook: vi.fn(async (ctx: { payload: unknown }) => {
      parsed.push(ctx.payload);
      const body = ctx.payload as {
        entry: Array<{ changes: Array<{ value: { messages?: Array<{ id: string }> } }> }>;
      };
      return body.entry.flatMap((entry) =>
        entry.changes.flatMap((change) =>
          (change.value.messages ?? []).map((m) => ({
            channel: "whatsapp",
            externalMessageId: m.id,
            receivedAt: new Date().toISOString(),
          })),
        ),
      );
    }),
  }),
}));

import {
  WHATSAPP_JOURNAL_PROVIDER,
  backfillWhatsappConnection,
  journalAccounts,
  journalWhatsappDelivery,
  replayablePayload,
} from "./journal";

const PHONE = "1234567890123";
const OTHER_PHONE = "9999999999999";
const HOUR = 60 * 60_000;
const seconds = (msAgo: number) => String(Math.floor((Date.now() - msAgo) / 1000));

const connection = {
  id: "conn-wa",
  workspace_id: "ws-1",
  channel: "whatsapp",
  status: "connected",
  external_account_id: PHONE,
  config: { phone_number_id: PHONE },
  secrets: { access_token: "token" },
} as unknown as ChannelConnection;

type Body = Parameters<typeof replayablePayload>[0];

function delivery(changes: unknown[]): Body {
  return { object: "whatsapp_business_account", entry: [{ id: "waba-1", changes }] } as Body;
}

function messagesChange(phone: string, messages: unknown[], extra: Record<string, unknown> = {}) {
  return {
    field: "messages",
    value: {
      messaging_product: "whatsapp",
      metadata: { phone_number_id: phone, display_phone_number: "5491100000000" },
      contacts: [{ wa_id: "5491155555555", profile: { name: "Ana" } }],
      messages,
      ...extra,
    },
  };
}

interface Call {
  table: string;
  ops: Array<[string, unknown[]]>;
  insert?: unknown;
}

/** Supabase de mentira: registra cada consulta y deja que el test la conteste. */
function fakeDb(answer: (call: Call) => { data?: unknown; error?: unknown }) {
  const calls: Call[] = [];
  const db = {
    from(table: string) {
      const call: Call = { table, ops: [] };
      calls.push(call);
      const builder: Record<string, unknown> = new Proxy(
        {},
        {
          get(_target, prop: string) {
            if (prop === "then") {
              return (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
                Promise.resolve(answer(call)).then(resolve, reject);
            }
            if (prop === "insert") {
              return (rows: unknown) => {
                call.insert = rows;
                return builder;
              };
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

describe("journalAccounts", () => {
  it("anota sólo entregas con mensajes o ecos, una vez por número", () => {
    const payload = delivery([
      messagesChange(PHONE, [{ id: "a", type: "text", timestamp: seconds(0) }]),
      messagesChange(PHONE, [{ id: "b", type: "text", timestamp: seconds(0) }]),
      {
        field: "smb_message_echoes",
        value: { metadata: { phone_number_id: OTHER_PHONE }, message_echoes: [{ id: "c" }] },
      },
    ]);
    expect(journalAccounts(payload)).toEqual([PHONE, OTHER_PHONE]);
  });

  it("anota también el historial de coexistencia", () => {
    const payload = delivery([
      {
        field: "history",
        value: { metadata: { phone_number_id: PHONE }, history: [{ threads: [{ id: "5491155555555", messages: [] }] }] },
      },
    ]);
    expect(journalAccounts(payload)).toEqual([PHONE]);
  });

  it("ignora los acuses de entrega", () => {
    const payload = delivery([
      {
        field: "messages",
        value: { metadata: { phone_number_id: PHONE }, statuses: [{ id: "s", status: "read" }] },
      },
    ]);
    expect(journalAccounts(payload)).toEqual([]);
  });
});

describe("journalWhatsappDelivery", () => {
  it("guarda la entrega ya procesada y con el número", async () => {
    const { db, calls } = fakeDb(() => ({ error: null }));
    const payload = delivery([messagesChange(PHONE, [{ id: "a", type: "text" }])]);
    await journalWhatsappDelivery(db, { rawBody: JSON.stringify(payload), payload, signature: "sha256=x" });
    expect(calls).toHaveLength(1);
    expect(calls[0].table).toBe("webhook_events_raw");
    expect(calls[0].insert).toEqual([
      expect.objectContaining({
        provider: WHATSAPP_JOURNAL_PROVIDER,
        account_id: PHONE,
        signature: "sha256=x",
        processed_at: expect.any(String),
      }),
    ]);
  });

  it("no escribe nada para un acuse y nunca lanza", async () => {
    const { db, calls } = fakeDb(() => ({ error: { message: "column does not exist" } }));
    const statuses = delivery([
      { field: "messages", value: { metadata: { phone_number_id: PHONE }, statuses: [{ id: "s" }] } },
    ]);
    await journalWhatsappDelivery(db, { rawBody: "{}", payload: statuses, signature: null });
    expect(calls).toHaveLength(0);

    const payload = delivery([messagesChange(PHONE, [{ id: "a", type: "text" }])]);
    await expect(
      journalWhatsappDelivery(db, { rawBody: "{}", payload, signature: null }),
    ).resolves.toBeUndefined();
  });
});

describe("replayablePayload", () => {
  it("deja sólo los mensajes de este número y saca acuses, reacciones y ediciones", () => {
    const body = delivery([
      messagesChange(
        PHONE,
        [
          { id: "keep", type: "text", timestamp: seconds(0) },
          { id: "react", type: "reaction", timestamp: seconds(0) },
        ],
        { statuses: [{ id: "s", status: "read" }] },
      ),
      messagesChange(OTHER_PHONE, [{ id: "other", type: "text", timestamp: seconds(0) }]),
      {
        field: "smb_message_echoes",
        value: {
          metadata: { phone_number_id: PHONE },
          message_echoes: [
            { id: "echo", type: "text", timestamp: seconds(0) },
            { id: "edit", type: "edit", timestamp: seconds(0) },
          ],
        },
      },
    ]);
    const out = replayablePayload(body, PHONE, () => true);
    expect(out?.object).toBe("whatsapp_business_account");
    const changes = out?.entry?.[0].changes ?? [];
    expect(changes).toHaveLength(2);
    expect(changes[0].value?.messages?.map((m) => m.id)).toEqual(["keep"]);
    expect(changes[0].value).not.toHaveProperty("statuses");
    expect(changes[0].value?.contacts).toBeDefined();
    expect(changes[1].value?.message_echoes?.map((m) => m.id)).toEqual(["echo"]);
  });

  it("recorta el historial por hilo y devuelve null si no queda nada", () => {
    const body = delivery([
      {
        field: "history",
        value: {
          metadata: { phone_number_id: PHONE },
          history: [
            {
              threads: [
                { id: "5491155555555", messages: [{ id: "h1", type: "text" }, { id: "h2", type: "text" }] },
                { id: "5491166666666", messages: [{ id: "h3", type: "text" }] },
              ],
            },
          ],
        },
      },
    ]);
    const out = replayablePayload(body, PHONE, (item) => item.id !== "h3");
    const threads = out?.entry?.[0].changes?.[0].value?.history?.[0].threads ?? [];
    expect(threads.map((t) => t.id)).toEqual(["5491155555555"]);
    expect(replayablePayload(body, PHONE, () => false)).toBeNull();
  });
});

describe("backfillWhatsappConnection", () => {
  beforeEach(() => {
    ingested.length = 0;
    parsed.length = 0;
  });

  const window = {
    sinceIso: new Date(Date.now() - 24 * HOUR).toISOString(),
    untilIso: new Date().toISOString(),
  };
  const msg = (id: string, from: string, hoursAgo: number, type = "text") => ({
    id,
    from,
    type,
    timestamp: seconds(hoursAgo * HOUR),
  });

  /** La bandeja: qué contactos existen y si tienen mensajes anteriores. */
  function inbox(call: Call, opts: { contacts?: string[]; earlier?: boolean } = {}) {
    if (call.table === "contacts") {
      return { data: (opts.contacts ?? []).map((c) => ({ id: `id-${c}`, external_id: c })), error: null };
    }
    if (call.table === "conversations") {
      return { data: (opts.contacts ?? []).map((c) => ({ id: `conv-${c}`, contact_id: `id-${c}` })), error: null };
    }
    if (call.table === "messages") {
      // Mensaje anterior al rango en la bandeja / ids ya guardados.
      if (has(call, "lt")) return { data: opts.earlier ? [{ id: "viejo" }] : [], error: null };
      return { data: [], error: null };
    }
    return null;
  }

  it("entra completa la conversación que empezó en el rango, y no la que empezó antes", async () => {
    const hasta12 = { ...window, untilIso: new Date(Date.now() - 12 * HOUR).toISOString() };
    const rows = [
      JSON.stringify(delivery([messagesChange(PHONE, [msg("a-1", "ana", 20), msg("b-1", "beto", 30)])])),
      JSON.stringify(
        delivery([
          messagesChange(
            PHONE,
            [msg("a-2", "ana", 2), msg("b-2", "beto", 2), msg("a-react", "ana", 2, "reaction")],
            { statuses: [{ id: "s", status: "read" }] },
          ),
        ]),
      ),
    ];
    const { db, calls } = fakeDb((call) => {
      const bandeja = inbox(call, { contacts: ["ana"] });
      if (bandeja) return bandeja;
      if (has(call, "eq", "provider", WHATSAPP_JOURNAL_PROVIDER)) {
        return { data: rows.map((raw_body, i) => ({ id: `r${i}`, raw_body })), error: null };
      }
      return { data: [], error: null };
    });

    const result = await backfillWhatsappConnection(db, connection, hasta12);

    // Ana empezó en el rango: entra entera, también lo posterior al "hasta".
    // Beto empezó antes: no entra nada suyo aunque escribió en el rango.
    expect(result).toEqual({ ingested: 2 });
    expect(ingested.map((e) => e.externalMessageId)).toEqual(["a-1", "a-2"]);
    expect(ingested.every((e) => e.historical === true && e.suppressAutoReply === true)).toBe(true);
    for (const payload of parsed) {
      const value = (payload as { entry: Array<{ changes: Array<{ value: Record<string, unknown> }> }> })
        .entry[0].changes[0].value;
      expect(value).not.toHaveProperty("statuses");
    }
    // El diario se busca por número y la captura de fallas por el cuerpo.
    const journalRead = calls.find((c) => has(c, "eq", "provider", WHATSAPP_JOURNAL_PROVIDER));
    expect(journalRead && has(journalRead, "eq", "account_id", PHONE)).toBe(true);
    const failuresRead = calls.find((c) => has(c, "is", "processed_at", null));
    expect(failuresRead && has(failuresRead, "ilike", "raw_body", `%${PHONE}%`)).toBe(true);
  });

  it("no entra la conversación que la bandeja ya tenía desde antes del rango", async () => {
    const row = JSON.stringify(delivery([messagesChange(PHONE, [msg("a-1", "ana", 5)])]));
    const { db } = fakeDb((call) => {
      const bandeja = inbox(call, { contacts: ["ana"], earlier: true });
      if (bandeja) return bandeja;
      if (has(call, "eq", "provider", WHATSAPP_JOURNAL_PROVIDER)) {
        return { data: [{ id: "r1", raw_body: row }], error: null };
      }
      return { data: [], error: null };
    });

    expect(await backfillWhatsappConnection(db, connection, window)).toEqual({ ingested: 0 });
    expect(parsed).toHaveLength(0);
  });

  it("sin el diario sigue con las fallas capturadas y avisa que quedó incompleto", async () => {
    const failureBody = JSON.stringify(delivery([messagesChange(PHONE, [msg("lost", "ana", 1)])]));
    const { db } = fakeDb((call) => {
      const bandeja = inbox(call);
      if (bandeja) return bandeja;
      if (has(call, "eq", "provider", WHATSAPP_JOURNAL_PROVIDER)) {
        return { data: null, error: { code: "42703", message: "column account_id does not exist" } };
      }
      return { data: [{ id: "f1", raw_body: failureBody }, { id: "f2", raw_body: "{\"entry\":[" }], error: null };
    });

    const result = await backfillWhatsappConnection(db, connection, window);

    expect(result).toEqual({ ingested: 1, error: "journal_unavailable" });
    expect(ingested.map((e) => e.externalMessageId)).toEqual(["lost"]);
  });

  it("una entrega repetida en el diario y en las fallas entra una sola vez", async () => {
    const body = JSON.stringify(delivery([messagesChange(PHONE, [msg("dup", "ana", 1)])]));
    const { db } = fakeDb((call) => {
      const bandeja = inbox(call);
      if (bandeja) return bandeja;
      return { data: [{ id: "row", raw_body: body }, { id: "row-2", raw_body: body }], error: null };
    });

    const result = await backfillWhatsappConnection(db, connection, window);

    expect(result).toEqual({ ingested: 1 });
    expect(parsed).toHaveLength(1);
    expect(ingested.map((e) => e.externalMessageId)).toEqual(["dup"]);
  });

  it("no hace nada sin phone_number_id", async () => {
    const { db, calls } = fakeDb(() => ({ data: [], error: null }));
    const bare = { ...connection, external_account_id: null, config: {} } as unknown as ChannelConnection;
    expect(await backfillWhatsappConnection(db, bare, window)).toEqual({
      ingested: 0,
      error: "missing_config",
    });
    expect(calls).toHaveLength(0);
  });
});
