import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChannelConnection } from "@/types";

let row: { secrets: Record<string, unknown>; config: Record<string, unknown> };
const updates: Array<Record<string, unknown>> = [];
vi.mock("../admin-client", () => ({
  supabaseAdmin: () => ({
    rpc: async (_name:string, args:Record<string,unknown>) => {
      updates.push({config:{...row.config,...args.p_config as object},secrets:args.p_secrets});
      return {error:null};
    },
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: row }) }) }),
      update: (patch: Record<string, unknown>) => {
        updates.push(patch);
        return { eq: async () => ({ error: null }) };
      },
    }),
  }),
}));

import { encrypt } from "../encryption";
import { buildPackEvents, claimAttachmentName, getFreshMLToken, nextPackOffset } from "./adapter";
import { MlRateLimitError } from "./rate-limit";

describe("claimAttachmentName", () => {
  it("accepts the current file_name response from Mercado Libre", () => {
    expect(claimAttachmentName({ file_name: "seller_proof.jpg", user_id: 12 })).toBe(
      "seller_proof.jpg",
    );
  });

  it("keeps compatibility with filename and id responses", () => {
    expect(claimAttachmentName({ filename: "proof.png" })).toBe("proof.png");
    expect(claimAttachmentName({ id: "legacy-id" })).toBe("legacy-id");
  });

  it("rejects empty or malformed responses", () => {
    expect(claimAttachmentName({ file_name: "  " })).toBeUndefined();
    expect(claimAttachmentName(null)).toBeUndefined();
  });
});

describe("getFreshMLToken", () => {
  const fetchMock = vi.fn<typeof fetch>(
    async () => new Response(JSON.stringify({ access_token: "new-token", refresh_token: "rotated", expires_in: 21600 })),
  );

  beforeEach(() => {
    updates.length = 0;
    vi.stubEnv("MERCADOLIBRE_CLIENT_ID", "111");
    vi.stubEnv("MERCADOLIBRE_CLIENT_SECRET", "riverz-secret");
    vi.stubEnv("MERCADOLIBRE_LEGACY_CLIENT_ID", "222");
    vi.stubEnv("MERCADOLIBRE_LEGACY_CLIENT_SECRET", "legacy-secret");
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  async function refresh(config: Record<string, unknown>) {
    row = {
      secrets: { access_token: encrypt("expired"), refresh_token: encrypt("refresh") },
      config: { seller_id: "42", token_expires_at: "2020-01-01T00:00:00Z", ...config },
    };
    const token = await getFreshMLToken({ id: "conn-1", ...row } as unknown as ChannelConnection);
    const body = fetchMock.mock.calls[0][1]?.body as URLSearchParams;
    return { token, clientId: body.get("client_id"), secret: body.get("client_secret") };
  }

  it("refreshes with the app that authorized the connection", async () => {
    const { token, clientId, secret } = await refresh({ app_id: "111" });
    expect(token).toBe("new-token");
    expect([clientId, secret]).toEqual(["111", "riverz-secret"]);
  });

  it("keeps connections from the previous app alive and records their app", async () => {
    const { clientId, secret } = await refresh({});
    expect([clientId, secret]).toEqual(["222", "legacy-secret"]);
    expect(updates[0].config).toMatchObject({ seller_id: "42", app_id: "222" });
  });
});

describe("nextPackOffset", () => {
  it("pide la página siguiente mientras falten mensajes", () => {
    expect(nextPackOffset(0, 10, 25)).toBe(10);
    expect(nextPackOffset(10, 10, 25)).toBe(20);
  });

  it("termina al completar el total o con una página vacía", () => {
    expect(nextPackOffset(20, 5, 25)).toBeNull();
    expect(nextPackOffset(0, 0, 25)).toBeNull();
  });

  it("sin total legible asume una sola página, como antes", () => {
    expect(nextPackOffset(0, 10, undefined)).toBeNull();
    expect(nextPackOffset(0, 10, "x")).toBeNull();
  });
});

describe("buildPackEvents", () => {
  const SELLER = "42";
  const BUYER = "77";
  const msg = (id: string, fromSeller: boolean, minute: number) => ({
    id,
    text: id,
    from: { user_id: fromSeller ? SELLER : BUYER },
    to: { user_id: fromSeller ? BUYER : SELLER },
    message_date: { created: `2026-09-01T10:0${minute}:00.000Z` },
  });
  const pages: Record<string, unknown> = {
    "": { paging: { limit: 2, offset: 0, total: 5 }, messages: [msg("m5", true, 5), msg("m4", false, 4)] },
    "2": { paging: { limit: 2, offset: 2, total: 5 }, messages: [msg("m3", true, 3), msg("m2", false, 2)] },
    "4": { paging: { limit: 2, offset: 4, total: 5 }, messages: [msg("m1", false, 1)] },
  };
  const connection = { id: "conn-1", workspace_id: "ws-1", config: { seller_id: SELLER } } as unknown as ChannelConnection;

  afterEach(() => vi.unstubAllGlobals());

  it("lee el hilo entero, con las respuestas del vendedor como salientes", async () => {
    const urls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string) => {
        urls.push(input);
        const url = new URL(input);
        if (url.pathname.startsWith("/users/")) return Response.json({ nickname: "comprador" });
        return Response.json(pages[url.searchParams.get("offset") ?? ""]);
      }),
    );

    const { events, quiet } = await buildPackEvents({ connection, packId: "900", sellerId: SELLER, token: "t" });

    expect(quiet).toBe(false);
    expect(events.map((e) => e.externalMessageId)).toEqual(["m1", "m2", "m3", "m4", "m5"]);
    expect(events.filter((e) => e.outbound).map((e) => e.externalMessageId)).toEqual(["m3", "m5"]);
    expect(events.every((e) => e.externalContactId === BUYER && e.externalThreadId === "pack:900")).toBe(true);
    // Las páginas siguientes repiten el tamaño que informa Mercado Libre.
    expect(urls.filter((u) => u.includes("offset="))).toEqual([
      expect.stringContaining("limit=2&offset=2"),
      expect.stringContaining("limit=2&offset=4"),
    ]);
  });

  it("un 429 corta la lectura con un error propio", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 429 })));

    await expect(
      buildPackEvents({ connection, packId: "900", sellerId: SELLER, token: "t" }),
    ).rejects.toBeInstanceOf(MlRateLimitError);
  });
});
